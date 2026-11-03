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
