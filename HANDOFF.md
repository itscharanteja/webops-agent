# WebOps AI Agent — System Handoff & Operations Guide

- **Last verified:** November 2, 2026, 17:46 UTC (23:16 IST)
- **Status:** Scan gate enabled (revision 6); executive deliverable & Gen AI synthesis active
- **AWS Region:** `ap-south-1` (Mumbai)
- **AWS Account ID:** `564159155981`

This records a running deployment with the scan gate enabled (`ENABLE_EXTERNAL_SCANS=true`). The production API accepts authorized scans for live testing and demonstration. Remaining Phase 5 hardening controls (Secrets Manager, AWS Backup deployment, certificate verification) remain tracked below.

## Current handoff status

- **Deployment:** CloudFormation stack `webops-prod` is `UPDATE_COMPLETE`. Web, API, and worker each have one running task and completed rollouts. Web service is deployed with image tag `ui-refresh-20261102` (structured UI/UX dashboard); API task revision `6` and worker task revision `4` are deployed (image tag `deterministic-proof-20261102`).
- **Health and scan gate:** Public `/health` returns `healthy` with database and Redis both `ok`. The API has `ENABLE_EXTERNAL_SCANS=true` and `WEB_ORIGIN=https://d33zu6s8ozyktq.cloudfront.net` deployed in task revision `6`.
- **RDS:** Available and private, with PostgreSQL ingress limited to the ECS security group and deletion protection enabled. Native automated backup retention is `0`; storage is unencrypted. Manual snapshot `webops-prod-before-hardening-20261102` is available but unencrypted. CloudFormation has snapshot retention policies, but deletion protection must be handled before any stack deletion.
- **Redis:** Replication group available with TLS required. Authentication and at-rest encryption are disabled.
- **Explanations:** The worker emits deterministic findings. Bedrock Nova Lite passed a Converse smoke test, but live enrichment is disabled until it can cite persisted evidence UUIDs.

**Repository state:** The latest commit is `513e9bb` (Phase 4 history gate repair). The Phase 5 infrastructure, scan gate, scanner, documentation, and backup-plan edits are still uncommitted. Keep the next commit scoped to Phase 5 after reviewing the staged changes. The `DatabaseBackupVault`, `DatabaseBackupRole`, `DatabaseBackupPlan`, and `DatabaseBackupSelection` resources are present in the local CloudFormation template **but have not been deployed**; AWS Backup currently lists no backup plans in this Region.

**Verification already run:** `pnpm typecheck`, `pnpm test`, `pnpm format:check`, and all 12 scanner unit tests passed after the scanner change. The Phase 2, 3, and 4 fixture gates passed earlier in this work session. The default `pnpm test` run skips database integration tests unless their fixture environment is enabled.

**Next priority:** Deploy and verify the staged daily RDS snapshot plan, then replace environment/master database credentials with Secrets Manager and a scoped app role. Next, verify RDS certificates, move ECS tasks into private networking with filtering egress, and secure CloudFront-to-ALB traffic. Keep the production scan gate closed until those controls and a production smoke scan pass. RDS and Redis at-rest encryption require planned resource migration; Redis authentication, quotas, monitoring, and retention checks remain open.

---

## 1. Executive Summary & Architecture

WebOps is a website audit platform that crawls authorized web origins using Playwright, runs deterministic defect checks, collects proof, and presents an issue triage board. Bedrock model availability has been verified; model-generated explanations are currently disabled until they can cite persisted evidence IDs.

All third-party services (such as Supabase) have been completely removed. The application runs on **100% AWS-native managed cloud services**:

```
                       [ User / Browser ]
                               │
                       (Port 443 HTTPS)
                               ▼
               ┌───────────────────────────────┐
               │    AWS CloudFront CDN         │
               │ (Amazon SSL / TLS Termination)│
               │   d33zu6s8ozyktq.cloudfront.net│
               └───────────────┬───────────────┘
                               │
                        (Port 80 HTTP)
                               ▼
            ┌────────────────────────────────────┐
            │   Application Load Balancer (ALB)  │
            │     webops-prod-alb-...elb...      │
            └─────────┬────────────────┬─────────┘
                      │                │
            /* (Next.js)      /v1/* & /health (API)
                      │                │
                      ▼                ▼
         ┌─────────────────┐  ┌─────────────────┐
         │ webops-prod-web │  │ webops-prod-api │
         │   (Next.js 16)  │  │ (Fastify REST)  │
         │  ECS Fargate    │  │  ECS Fargate    │
         └─────────────────┘  └────────┬────────┘
                                       │
                      ┌────────────────┼────────────────┐
                      ▼                ▼                ▼
            ┌─────────────────┐ ┌──────────────┐ ┌──────────────┐
            │  Amazon Cognito │ │  Amazon RDS  │ │  ElastiCache │
            │  (OIDC Auth)    │ │ (Postgres 16)│ │   (Redis)    │
            └─────────────────┘ └──────┬───────┘ └──────┬───────┘
                                       │                │
                                       │ (BullMQ Queue) │
                                       └───────┬────────┘
                                               │
                                               ▼
                                    ┌──────────────────────┐
                                    │  webops-prod-worker  │
                                    │ (Playwright Scanner) │
                                    │     ECS Fargate      │
                                    └──────────┬───────────┘
                                               │
                                 ┌─────────────┴─────────────┐
                                 ▼                           ▼
                      ┌─────────────────────┐     ┌──────────────────────┐
                      │    Amazon S3        │     │    Amazon Bedrock    │
                      │ (Encrypted Proofs)  │     │ (Nova Lite; idle)   │
                      └─────────────────────┘     └──────────────────────┘
```

---

## 2. Production Access Endpoints

| Resource                    | URL / Endpoint                                                                               | Purpose                                      |
| :-------------------------- | :------------------------------------------------------------------------------------------- | :------------------------------------------- |
| **Web Application (HTTPS)** | [https://d33zu6s8ozyktq.cloudfront.net](https://d33zu6s8ozyktq.cloudfront.net)               | Primary UI (Projects, Scans, Issues Board)   |
| **User Sign-In / Sign-Up**  | [https://d33zu6s8ozyktq.cloudfront.net/login](https://d33zu6s8ozyktq.cloudfront.net/login)   | Cognito authentication                       |
| **API Health Check**        | [https://d33zu6s8ozyktq.cloudfront.net/health](https://d33zu6s8ozyktq.cloudfront.net/health) | Live system diagnostics (PostgreSQL + Redis) |
| **API Base URL**            | `https://d33zu6s8ozyktq.cloudfront.net/v1`                                                   | Fastify REST API v1 endpoints                |
| **Internal ALB URL**        | `http://webops-prod-alb-1955741517.ap-south-1.elb.amazonaws.com`                             | Direct Application Load Balancer (HTTP)      |

---

## 3. Provisioned AWS Cloud Resources

### 3.1. Compute & Delivery

- **AWS CloudFront Distribution**: `E2B6E847IU6OMX` (`d33zu6s8ozyktq.cloudfront.net`)
  - Provides native SSL/TLS termination on port 443 with a free public Amazon certificate.
  - Origin: ALB with `Managed-AllViewerExceptHostHeader` policy (forwards all auth headers, query strings, and viewer cookies).
- **Application Load Balancer**: `webops-prod-alb` (Port 80)
  - Target Group `webops-prod-web-tg`: Port 3000, Path `/`, Matcher `200-399`.
  - Target Group `webops-prod-api-tg`: Port 4000, Path `/health`, Matcher `200`.
- **ECS Fargate Cluster**: `webops-prod-cluster`
  - `webops-prod-web` (1 replica): Next.js App Router (Mantine UI + Tailwind CSS).
  - `webops-prod-api` (1 replica): Fastify v5 with OIDC JWT verification and SSE streaming.
  - `webops-prod-worker` (1 replica): Playwright crawler, BullMQ consumer, FastMCP scanner.

### 3.2. Data & State

- **Amazon RDS PostgreSQL**:
  - Endpoint: `webops-prod-postgres.chuu66kcaqds.ap-south-1.rds.amazonaws.com:5432`
  - Database: `webops` (Master User: `webops_admin`)
  - Engine: PostgreSQL `16.9` on `db.t4g.micro`
  - Network: private address; PostgreSQL ingress is limited to the ECS security group.
  - Encryption: In-transit TLS SSL (`ssl: { rejectUnauthorized: false }`); certificate verification still needs hardening.
  - Storage is unencrypted. The available manual snapshot `webops-prod-before-hardening-20261102` is also unencrypted. Native automated backups are disabled; a daily AWS Backup plan is staged locally but not deployed.
  - Deletion protection and CloudFormation snapshot retention are enabled.
  - Auto-migrations: Ran automatically on startup (`0001` through `0006`).
- **Amazon ElastiCache Redis**:
  - Endpoint: `master.webops-prod-redis-rg.hk3kjt.aps1.cache.amazonaws.com:6379` (TLS URL in API and worker)
  - Node type: `cache.t4g.micro`
  - Transport: TLS required. Authentication and at-rest encryption are not yet configured.
  - Purpose: BullMQ scan jobs queue and Redis Pub/Sub for SSE live events.

### 3.3. Identity, Storage & AI

- **Amazon Cognito User Pool**: `ap-south-1_S6YABFoAS`
  - App Client ID: `vht8ek8tktsj8jkqgsom48an9`
  - Standard OIDC JWKS token verification at:  
    `https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_S6YABFoAS/.well-known/jwks.json`
- **Amazon S3 Proof Storage**: `webops-prod-artifacts-564159155981-ap-south-1`
  - Private, encrypted S3 bucket for screenshot crops, DOM excerpts, and network traces.
  - Access is granted exclusively via pre-signed, short-lived URLs.
- **Amazon Bedrock**:
  - Model: `apac.amazon.nova-lite-v1:0` (Converse smoke test passed).
  - Region: `ap-south-1` (APAC inference profile via IAM task role).
  - Finding enrichment is disabled while evidence IDs are assigned after scanner output. Rule-based explanations remain available.

---

## 4. Key Configurations & Codebase Layout

```text
apps/web/                 Next.js App Router, Mantine, Tailwind
  ├── lib/cognito.ts      Cognito client SDK (Sign-In, Sign-Up, Tokens)
  ├── lib/client.ts       API client with dynamic relative URL routing & auth headers
  └── app/login/page.tsx  Authentication page (Cognito form + One-Click Dev Sign-In)
apps/api/                 Fastify REST API & Server-Sent Events (SSE)
  ├── src/auth.ts         Cognito OIDC JWKS token verifier + dev token bypass
  ├── src/auto-migrate.ts In-app PostgreSQL auto-migration runner
  └── src/server.ts       Server bootstrapper with sanitized RDS SSL connection pool
apps/worker/              BullMQ scan consumer & orchestration
  ├── src/index.ts        Worker daemon connected to Redis & RDS
  ├── src/process-scan.ts Playwright scanner subprocess supervisor
  └── src/cleanup.ts      Artifact retention & proof expiration pruner
services/scanner/         Python 3.12, Playwright, FastMCP tools, Amazon Bedrock
packages/contracts/       TypeScript interfaces, Zod schemas, shared enums
infra/aws/
  └── cloudformation.yaml Infrastructure template (VPC, RDS, Redis, S3, Cognito, ALB, CloudFront, ECS); local backup-plan additions await deployment
scripts/
  ├── deploy-aws.sh       Full automated build, ECR push, and CloudFormation deploy script
  └── destroy-aws.sh      Legacy teardown script; do not run without updating it for protected RDS and retained snapshots
```

---

## 5. How to Test & Use the Platform

### 5.1. Authentication

1. Open **[https://d33zu6s8ozyktq.cloudfront.net/login](https://d33zu6s8ozyktq.cloudfront.net/login)**.
2. Enter an email and password to sign in with Amazon Cognito or create an account (a confirmation code will be sent to the email). One-Click Dev Sign-In is for local development only.

### 5.2. Creating a Project & Running a Scan

1. In the navigation bar, click **"Projects"** ➔ **"New Project"**.
2. Fill out:
   - **Project Name**: e.g. `My Audit Project`
   - **Base URL**: e.g. `https://example.com`
   - **Approved Origins**: e.g. `https://example.com` (SSRF guard prevents scanning unapproved or private IP origins).
3. Click **"Save Project"**.
4. In local development, click **"Run Scan"** and watch the live scanner console. Production scan creation is disabled until Phase 5 is complete.

### 5.3. Inspecting Proof & Exporting Issues

- Click any finding in the **Issues Board**.
- Click **"View Proof"** to inspect the signed S3 screenshot crop, DOM snippet, or console stack trace.
- Click **"Download Markdown"** to export an audit-ready, tamper-safe report.

---

## 6. Maintenance & Deployment Workflows

### 6.1. Rebuilding & Updating a Service

Build and push an immutable ECR image tag, then update its CloudFormation image parameter through a reviewed change set. Use `UsePreviousValue=true` for unchanged parameters, especially `DBPassword`; do not read or print its value. Wait for `UPDATE_COMPLETE`, verify the ECS service rollout, and check `/health`. The deployed worker image is `webops-worker:deterministic-proof-20261102`; the deployed API image is `webops-api:scan-gate-20261102`.

`scripts/deploy-aws.sh` was updated to require `DB_PASSWORD` and to rely on API startup migrations over the private VPC connection. It has not been used to deploy the latest changes. Its `latest` image-tag workflow should be reviewed before the next full deployment because reusing a tag does not provide a new immutable CloudFormation image value.

---

## 7. Teardown status

`scripts/destroy-aws.sh` is **not current**. It attempts to delete the stack while RDS deletion protection is enabled, so stack deletion would fail. It also does not account for retained RDS snapshots or the Redis replication group. Do not use its `--yes` option as a cost-control procedure. Update and review the teardown runbook before any deletion; snapshot retention means a successful stack deletion would still leave recovery storage that must be tracked separately.

---

## 8. Resolved Gotchas & Architecture Notes

1. **Browser Automatic HTTPS vs. ALB**:
   - Modern browsers force `https://` on cloud domains. Because default ALB DNS (`*.elb.amazonaws.com`) lacks a public SSL certificate, AWS CloudFront was provisioned in front of the ALB. CloudFront terminates SSL with an Amazon CA certificate (`*.cloudfront.net`) and proxies traffic to the ALB on port 80.
2. **RDS PostgreSQL SSL Negotiation**:
   - RDS enforces TLS by default (`no encryption` error). Node `pg` rejects self-signed RDS intermediate certificates if `?sslmode=require` is present in the connection string. Both `apps/api` and `apps/worker` automatically strip `sslmode` from the connection string while maintaining `{ ssl: { rejectUnauthorized: false } }` on the `pg.Pool`.
3. **Next.js Relative API Calls**:
   - In Next.js client bundles, `NEXT_PUBLIC_` variables default to empty strings if not supplied at build time. The web client (`apps/web/lib/client.ts`) uses relative paths (e.g. `/v1/projects`) in browser contexts, enabling the browser to call the same CloudFront host without cross-origin issues or hardcoded `localhost:4000` fallbacks.
4. **ALB Target Group Matcher**:
   - Next.js root `/` performs a `307 Temporary Redirect` to `/projects`. The ALB target group matcher for the web service is configured with `200-399` so redirects are treated as healthy targets.
