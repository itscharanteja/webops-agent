# WebOps Agent

WebOps is an autonomous website security and quality audit application for sites the user is authorized to test. Architecture is 100% AWS Cloud-Native as defined in [AGENTS.md](AGENTS.md).

## Architecture (100% AWS Cloud-Native)

- **Authentication**: Amazon Cognito User Pool (Email signup/login, verification codes, standard OIDC JWTs with JWKS verification).
- **Proof Artifact Storage**: Amazon S3 (Private bucket, SSE-S3 encryption, presigned short-lived URLs, 90-day retention cleanup).
- **Generative AI Reasoning**: Amazon Bedrock (Anthropic Claude 3.5 Sonnet & Nova via Converse API with deterministic fallback).
- **Database**: PostgreSQL (Amazon RDS PostgreSQL in production, local Postgres in Docker Compose).
- **Queuing & Event Fan-out**: Redis (Amazon ElastiCache in production, local Redis in Docker Compose).
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

Deploy the complete infrastructure to AWS using the automated script:

```sh
./scripts/deploy-aws.sh
```

This automates:
1. Creating Amazon ECR repositories (`webops-api`, `webops-worker`, `webops-web`).
2. Building and pushing Docker container images.
3. Deploying the CloudFormation template in `infra/aws/cloudformation.yaml` provisioning VPC, ECS Fargate cluster, S3 bucket, Amazon Cognito User Pool, and Application Load Balancer.
4. Outputting the public Application Load Balancer DNS URL.

## AWS Teardown (Remove All Cloud Resources)

Whenever you want to delete all provisioned AWS resources to stop any credit usage:

```sh
./scripts/destroy-aws.sh
```

This will cleanly empty and remove the S3 proof bucket, terminate the CloudFormation stack (RDS PostgreSQL, ElastiCache Redis, ALB, ECS Fargate, Cognito, VPC), and delete all Amazon ECR repositories and container images.

## Environment Variables

| Variable | Use |
| --- | --- |
| `DATABASE_URL` | API connection as the RLS-constrained `webops_app` role / RDS |
| `WORKER_DATABASE_URL` | Worker connection as the scan-scoped `webops_worker` role |
| `REDIS_URL` | Redis / ElastiCache connection string for BullMQ |
| `AWS_REGION` | AWS Region (default: `ap-south-1`) |
| `S3_BUCKET_NAME` | Private S3 bucket for scan proof artifacts |
| `COGNITO_USER_POOL_ID` | Amazon Cognito User Pool ID for JWT token verification |
| `COGNITO_CLIENT_ID` | Amazon Cognito User Pool Web App Client ID |
| `AWS_BEDROCK_REGION` | AWS Region for Bedrock AI model invocations (default: `us-east-1`) |
| `BEDROCK_MODEL_ID` | Bedrock inference profile (default: `us.anthropic.claude-3-5-sonnet-20241022-v2:0`) |
