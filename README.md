# WebOps Agent

Phase 2 adds a BullMQ worker, bounded Playwright crawler, scan pages and ordered events, SSE replay, cancellation, and a live console. Project creation and Supabase JWT authorization come from Phase 1. The API publishes OpenAPI at `/openapi.json`.

## Local setup

Copy `.env.example` to `.env` and `apps/web/.env.local.example` to `apps/web/.env.local`, then configure Supabase Auth. Run `docker compose up -d postgres redis fixture`, `corepack pnpm install --frozen-lockfile`, and in `services/scanner` run `uv sync --frozen` plus `uv run playwright install chromium`. Run `corepack pnpm dev` from the root. Open `http://localhost:3000/login`, create a project using `http://localhost:8080/index.html` and approved origin `http://localhost:8080`, then start a scan.

A fresh Postgres volume applies migrations 0001 and 0002. For a Phase 1 volume, apply `supabase/migrations/0002_scans.sql` as owner and enable the `webops_worker` role with the local password from `.env.example`.

## Verification

Run `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm format:check`, `corepack pnpm --filter @webops/web build`, and `corepack pnpm openapi:generate`. With Compose and the worker running, set `TEST_PHASE2=1` and the variables from `.env` before `corepack pnpm --filter @webops/api test`. The fixture gate verifies six approved pages, ordered SSE replay, cancellation, blocked-origin requests, form safety, and cross-project access.

## Limits

Findings and proof are Phase 3. Reports contain coverage only. Real external scans remain blocked until Phase 5 filtering egress and production controls. Local Compose uses hosted Supabase Auth. The web build uses Next's webpack path in this sandbox.
