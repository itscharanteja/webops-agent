# WebOps Agent

WebOps is an autonomous website security and quality audit application for sites the user is authorized to test. Architecture is 100% AWS Cloud-Native as defined in [AGENTS.md](AGENTS.md).

## Architecture (100% AWS Cloud-Native)

- **Authentication**: Amazon Cognito User Pool (Email signup/login, verification codes, standard OIDC JWTs with JWKS verification).
- **Proof Artifact Storage**: Amazon S3 (Private bucket, SSE-S3 encryption, presigned short-lived URLs, 90-day retention cleanup).
- **Deterministic explanations**: Findings use rule-based explanations. Bedrock enrichment is held until it can cite persisted evidence IDs.
- **Database**: Private Amazon RDS PostgreSQL in production, local Postgres in Docker Compose.
- **Queuing & Event Fan-out**: TLS-only Amazon ElastiCache Redis in production, local Redis in Docker Compose.
- **Compute & Hosting**: AWS ECS Fargate & Application Load Balancer (ALB).

## Local Setup

Requirements: Node 22+, pnpm 10.34.9 via Corepack, Docker Compose, Python 3.12, and uv 0.8.17.

1. Run `cp .env.example .env` and `cp apps/web/.env.local.example apps/web/.env.local`.
2. Run `docker compose up -d postgres redis fixture`. Compose maps Postgres to port **55433** and Redis to port **6379**.
3. Run `corepack pnpm install --frozen-lockfile`. In `services/scanner`, run `uv sync --frozen` and `uv run playwright install chromium`.
4. Run `corepack pnpm dev` from the repository root. This starts the Next.js web app (port 3000), Fastify API (port 4000), and BullMQ worker.
5. Open `http://localhost:3000/login`. You can click "One-Click Dev Sign-In" for local testing or configure AWS Cognito credentials.
6. Create a project with base URL `http://localhost:8080/index.html` and approved origin `http://localhost:8080`. Confirm authorization, open the project, and start a scan.

## Verification & Tests

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm format:check
corepack pnpm --filter @webops/web build
corepack pnpm --filter @webops/api build
corepack pnpm --filter @webops/worker build
cd services/scanner && uv run python -m unittest discover -s tests -v
```

## AWS Production Deployment

Set `DB_PASSWORD` from your secret manager, then deploy the complete infrastructure:

```sh
./scripts/deploy-aws.sh
```

`DB_PASSWORD` is required; the deploy script no longer supplies a shared default. Do not reuse a committed or previously exposed password. The current CloudFormation task definitions still carry the database credential in environment variables; move it to AWS Secrets Manager before accepting scans of real external sites.

This automates:

1. Creating Amazon ECR repositories (`webops-api`, `webops-worker`, `webops-web`).
2. Building and pushing Docker container images.
3. Deploying the CloudFormation template in `infra/aws/cloudformation.yaml` provisioning VPC, ECS Fargate cluster, S3 bucket, Amazon Cognito User Pool, and Application Load Balancer.
4. Outputting the public Application Load Balancer DNS URL.

### Production readiness

The deployed RDS instance is private, Redis requires TLS, and the API health check pings Redis. A manual RDS recovery snapshot exists. Production scan requests return `503 SCANS_DISABLED` until `ENABLE_EXTERNAL_SCANS=true` is deliberately set after the Phase 5 gate. Bedrock model availability was verified, but finding enrichment is disabled until evidence is stored and model citations can be checked against real evidence IDs. Phase 5 is still open: production database credentials are in ECS environment variables and use the master role; RDS and Redis storage encryption, automated RDS backups, Redis authentication, verified RDS certificates, filtering egress, private ECS networking, and TLS between CloudFront and the ALB remain to be implemented.

## AWS Teardown (Remove All Cloud Resources)

Whenever you want to delete all provisioned AWS resources to stop any credit usage:

```sh
./scripts/destroy-aws.sh
```

This will cleanly empty and remove the S3 proof bucket, terminate the CloudFormation stack (RDS PostgreSQL, ElastiCache Redis, ALB, ECS Fargate, Cognito, VPC), and delete all Amazon ECR repositories and container images.

## Environment Variables

| Variable                | Use                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | API connection; local setup uses `webops_app`, production still uses the RDS master role       |
| `WORKER_DATABASE_URL`   | Worker connection; local setup uses `webops_worker`, production still uses the RDS master role |
| `REDIS_URL`             | Redis / ElastiCache connection string for BullMQ                                               |
| `AWS_REGION`            | AWS Region (default: `ap-south-1`)                                                             |
| `S3_BUCKET_NAME`        | Private S3 bucket for scan proof artifacts                                                     |
| `COGNITO_USER_POOL_ID`  | Amazon Cognito User Pool ID for JWT token verification                                         |
| `COGNITO_CLIENT_ID`     | Amazon Cognito User Pool Web App Client ID                                                     |
| `AWS_BEDROCK_REGION`    | AWS Region for Bedrock AI model invocations (default: `ap-south-1`)                            |
| `BEDROCK_MODEL_ID`      | Bedrock inference profile (default: `apac.amazon.nova-lite-v1:0`)                              |
| `ENABLE_EXTERNAL_SCANS` | Production scan gate; keep `false` until the Phase 5 egress and smoke-test gate passes         |

## Frontend design audit

Scan report and activity routes share a compact workspace with Overview, Issues,
Pages, Skipped URLs, Events, Checks, and Limitations. Issues, pages, skips, and limitations replace rows when paging. Events use a
bounded, scrolling developer terminal with sequence ordering, search, level
filtering, copy, and follow-latest controls. The report drawer and exports read the saved issue snapshot.
Scores, grades, speculative risk summaries, decorative emojis, and cryptographic
verification claims have been removed from the frontend. Classification appears
only in optional scan details when a classifier event actually recorded it.

Use **Export** to choose a discipline and Markdown or Print / Save as PDF. PDF
output uses the browser print dialog. Discord configuration, test messages, and
explicit scan dispatch are available under project **Integrations**. Historical
stored deliverable content is not rewritten by this presentation change.

Validate the frontend with `pnpm --filter @webops/web typecheck` and
`pnpm --filter @webops/web test`. This change affects presentation only; it does
not change scan policy, deterministic checks, evidence authorization, or stored
scan facts.

The scan overview also provides discipline-specific Download menus
(`frontend.md`, `backend.md`, `design-ux.md`, `content-seo.md`), a Push to Discord
menu, and an inline webhook settings modal. The AI audited summary presents
saved cited explanations; when none exist it explicitly falls back to recorded
scan facts. Raw summary JSON is truncated with an expand/collapse control.
The check table and scan details remain available directly in the overview.

### Running scans and AI drafts

Queued/running scans display only the developer terminal, with a spinner by the
Scan activity heading and disabled result tabs. Once the scan ends the tabs
unlock, including collected results for partial, failed, or cancelled runs;
those runs always retain the incomplete-coverage label.

The overview's **Draft AI summary** button calls the authenticated
`POST /v1/scans/:id/summary-draft` endpoint. The API uses `BEDROCK_MODEL_ID` and
`AWS_BEDROCK_REGION` (falling back to `AWS_REGION`) with its server IAM credentials.
Bedrock prioritizes up to three existing findings from bounded, redacted facts;
the API composes the draft from saved observations/fixes and existing evidence IDs.
Model output cannot add new claims or citations. Errors, missing configuration,
and the 12-second timeout return a clearly labeled deterministic fallback.

Drafts are separate from immutable reports. The API coalesces repeated requests
and caches up to 100 drafts in memory for 15 minutes (fallbacks for 30 seconds).
No report, observation, or issue is rewritten. See the official
[Bedrock Converse examples](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_bedrock-runtime_code_examples.html)
for the SDK invocation pattern. CloudFormation passes model configuration to the
API task; deployment remains a separate operation.
