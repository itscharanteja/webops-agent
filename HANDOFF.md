# WebOps AI Agent — System Handoff & Operations Guide

**Generated**: November 2, 2026  
**Status**: 🟢 Production Deployed & Operational (100% AWS Cloud-Native)  
**Target AWS Region**: `ap-south-1` (Mumbai)  
**Bedrock AI Region**: `us-east-1` (N. Virginia, cross-region inference)  
**AWS Account ID**: `564159155981`

---

## 1. Executive Summary & Architecture

WebOps is an autonomous website audit platform that crawls authorized web origins using Playwright, runs deterministic defect checks, collects cryptographic/media proof, generates AI-powered fix explanations using Amazon Bedrock, and presents an interactive issue triage board.

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
                      │ (Encrypted Proofs)  │     │ (Claude 3.5 Sonnet)  │
                      └─────────────────────┘     └──────────────────────┘
```

---

## 2. Production Access Endpoints

| Resource | URL / Endpoint | Purpose |
| :--- | :--- | :--- |
| **Web Application (HTTPS)** | [https://d33zu6s8ozyktq.cloudfront.net](https://d33zu6s8ozyktq.cloudfront.net) | Primary UI (Projects, Scans, Issues Board) |
| **User Sign-In / Sign-Up** | [https://d33zu6s8ozyktq.cloudfront.net/login](https://d33zu6s8ozyktq.cloudfront.net/login) | Cognito authentication & dev sign-in |
| **API Health Check** | [https://d33zu6s8ozyktq.cloudfront.net/health](https://d33zu6s8ozyktq.cloudfront.net/health) | Live system diagnostics (PostgreSQL + Redis) |
| **API Base URL** | `https://d33zu6s8ozyktq.cloudfront.net/v1` | Fastify REST API v1 endpoints |
| **Internal ALB URL** | `http://webops-prod-alb-1955741517.ap-south-1.elb.amazonaws.com` | Direct Application Load Balancer (HTTP) |

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
  - Encryption: In-transit TLS SSL (`ssl: { rejectUnauthorized: false }`)
  - Auto-migrations: Ran automatically on startup (`0001` through `0006`).
- **Amazon ElastiCache Redis**:
  - Endpoint: `webops-prod-redis.hk3kjt.0001.aps1.cache.amazonaws.com:6379`
  - Node type: `cache.t4g.micro`
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
  - Model: `us.anthropic.claude-3-5-sonnet-20241022-v2:0`
  - Region: `us-east-1` (Cross-region inference profile via IAM task role).

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
  └── cloudformation.yaml Complete infrastructure template (VPC, RDS, Redis, S3, Cognito, ALB, CloudFront, ECS)
scripts/
  ├── deploy-aws.sh       Full automated build, ECR push, and CloudFormation deploy script
  └── destroy-aws.sh      One-command teardown script (empties S3, deletes stack, purges ECR)
```

---

## 5. How to Test & Use the Platform

### 5.1. Authentication
1. Open **[https://d33zu6s8ozyktq.cloudfront.net/login](https://d33zu6s8ozyktq.cloudfront.net/login)**.
2. You can either:
   - Click **"⚡ One-Click Dev Sign-In"** for immediate sandbox access.
   - Or enter an email & password to create an Amazon Cognito user account (a confirmation code will be sent to the email).

### 5.2. Creating a Project & Running a Scan
1. In the navigation bar, click **"Projects"** ➔ **"New Project"**.
2. Fill out:
   - **Project Name**: e.g. `My Audit Project`
   - **Base URL**: e.g. `https://example.com`
   - **Approved Origins**: e.g. `https://example.com` (SSRF guard prevents scanning unapproved or private IP origins).
3. Click **"Save Project"**.
4. Inside the project overview, click **"Run Scan"**.
5. Watch the live scanner console stream real-time events over Server-Sent Events (SSE).

### 5.3. Inspecting Proof & Exporting Issues
- Click any finding in the **Issues Board**.
- Click **"View Proof"** to inspect the signed S3 screenshot crop, DOM snippet, or console stack trace.
- Click **"Download Markdown"** to export an audit-ready, tamper-safe report.

---

## 6. Maintenance & Deployment Workflows

### 6.1. Rebuilding & Updating a Service

If you modify code in any of the packages, push the updated container image and trigger an ECS rolling restart:

```bash
# 1. Authenticate Docker with AWS ECR
aws ecr get-login-password --region ap-south-1 | \
  docker login --username AWS --password-stdin 564159155981.dkr.ecr.ap-south-1.amazonaws.com

# 2. Build and push the modified service (e.g. API)
docker build --platform linux/amd64 -f apps/api/Dockerfile \
  -t 564159155981.dkr.ecr.ap-south-1.amazonaws.com/webops-api:latest .
docker push 564159155981.dkr.ecr.ap-south-1.amazonaws.com/webops-api:latest

# 3. Force ECS to pull the latest image with zero downtime
aws ecs update-service \
  --cluster webops-prod-cluster \
  --service webops-prod-api \
  --force-new-deployment \
  --region ap-south-1
```

*(Repeat with `apps/web/Dockerfile` or `apps/worker/Dockerfile` for the web or worker services).*

---

## 7. AWS Teardown & Stopping Credit Consumption

To completely delete all AWS resources and prevent credit exhaustion:

```bash
# Interactive mode (asks for confirmation):
./scripts/destroy-aws.sh

# Or non-interactive immediate teardown:
./scripts/destroy-aws.sh --yes
```

### What `./scripts/destroy-aws.sh` Cleans Up:
1. **Amazon S3**: Recursively deletes all files in `webops-prod-artifacts-*` (allowing CloudFormation to delete the bucket).
2. **CloudFormation Stack**: Deletes `webops-prod`, tearing down:
   - CloudFront Distribution (`d33zu6s8ozyktq.cloudfront.net`)
   - ECS Fargate Cluster, Services, and Tasks
   - Application Load Balancer, Listener Rules, and Target Groups
   - RDS PostgreSQL Database Instance and Subnet Groups
   - ElastiCache Redis Cluster and Subnet Groups
   - VPC, Internet Gateway, Route Tables, and Subnets
   - Cognito User Pool and App Client
3. **Amazon ECR**: Deletes all container repositories (`webops-api`, `webops-worker`, `webops-web`) and images.

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
