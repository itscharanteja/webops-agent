# WebOps Agent

Phase 1 foundation: pnpm/uv monorepo, shared Zod contracts, Postgres schema and RLS, Supabase JWT verification, member-scoped project CRUD, exact-origin approval, project UI, and local fixture. The API publishes OpenAPI at `/openapi.json`.

## Local setup

Copy `.env.example` to `.env` and `apps/web/.env.local.example` to `apps/web/.env.local`. Configure Supabase Auth and its redirect allowlist for `http://localhost:3000/projects`. Run `docker compose up -d postgres redis fixture`, `corepack pnpm install --frozen-lockfile`, and `corepack pnpm dev`. Sign in at `http://localhost:3000/login` and create a project. The local fixture is `http://localhost:8080/index.html` and is permitted only by `WEBOPS_LOCAL_FIXTURE_ORIGIN` outside production.

For an existing Compose volume without `webops_app`, apply `infra/local/initdb/01-init.sql` as the database owner. Never put service credentials in the web environment file.

## Verification

Run `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm format:check`, `corepack pnpm --filter @webops/web build`, and `corepack pnpm openapi:generate`. With `TEST_DATABASE_URL` set to a disposable `webops_app` database, the API database test checks project isolation. Browser sign-in is not automated without Supabase credentials.

## Deployment and limits

The web, API, and worker Dockerfiles are scaffolds. Real external scans are blocked until filtering egress and Phase 5 production controls are installed. Local Compose provides Postgres and Redis; Supabase Auth is hosted. The web build uses Next's webpack path in the current sandbox.
