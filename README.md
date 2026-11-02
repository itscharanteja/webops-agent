# WebOps Agent

WebOps is a website audit application for sites the user is authorized to test. Development is proceeding in the order in [AGENTS.md](AGENTS.md).

## Current state

**Phases 1–4 are implemented for the local fixture.** The repository has the pnpm/uv monorepo, shared contracts, Postgres schema and RLS, Supabase JWT verification, project CRUD and origin approval, a BullMQ worker, a bounded Playwright crawler, persistent scan pages/events, SSE replay, cancellation, deterministic checks, stored proof, an editable issues board, Markdown exports, immutable historical report snapshots with DB-level triggers, `not_seen` tracking across rescans, reports history list and snapshots viewer, and bounded FastMCP tools with citation validation fallback. The API publishes OpenAPI at `/openapi.json`.

**Do not use this build to scan real external sites.** Filtering egress, quotas, and production hardening are Phase 5 work.

## Local setup

Requirements: Node 22+, pnpm 10.34.9 via Corepack, Docker Compose, Python 3.12, uv 0.8.17, and a Supabase Auth project with an asymmetric JWT signing key.

1. Run `cp .env.example .env` and `cp apps/web/.env.local.example apps/web/.env.local`. Set the Supabase URL and anon key in those files. Keep service credentials out of the web file.
2. Configure the Supabase Auth site URL and email redirect allowlist to include `http://localhost:3000/projects`.
3. Run `docker compose up -d postgres redis fixture`. A fresh Postgres volume applies all three migrations and creates the local API and worker roles. Compose maps Postgres to host port **55433** to avoid a local Postgres instance on 5432. For an existing volume, apply any missing migrations as the database owner.
4. Run `corepack pnpm install --frozen-lockfile`. In `services/scanner`, run `uv sync --frozen` and `uv run playwright install chromium`.
5. Run `corepack pnpm dev` from the repository root. This starts the web app, API, and worker. The worker needs `WORKER_DATABASE_URL`, `REDIS_URL`, and `SCANNER_PYTHON` in `.env`.
6. Open `http://localhost:3000/login`, sign in, and create a project with base URL `http://localhost:8080/index.html` and approved origin `http://localhost:8080`. Confirm authorization, open the project, and start a scan. The live page shows ordered events, coverage, and pages; the issues board links each finding to proof. The API runs on port 4000.

If a previously initialized Compose volume has no `webops_app` role, run `docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d webops -f /docker-entrypoint-initdb.d/01-init.sql` once. Restart `corepack pnpm dev` after changing `.env`; the API reads it at startup.

For a Phase 1 volume that already has `webops_app`, apply Phase 2 with `docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d webops -f /migrations/0002_scans.sql`, then run `docker compose exec -T postgres psql -U postgres -d webops -c "alter role webops_worker login password 'webops_worker_dev_password'"`. These credentials are for local Compose only.

For a Phase 2 volume, apply Phase 3 with `docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d webops -f /migrations/0003_findings.sql`. Proof images use the private local `.artifacts/` directory by default. For a private Supabase Storage bucket, set `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_STORAGE_BUCKET` on the API and worker only. Create the bucket as private before scanning. The UI receives only short-lived signed artifact URLs.

For a Phase 3 volume, apply Phase 4 with `docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d webops -f /migrations/0004_history.sql` and `docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d webops -f /migrations/0005_not_seen.sql`.

For a Phase 4 volume, apply Phase 5 with `docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d webops -f /migrations/0006_retention_cleanup.sql`.

To seed the local fixture after signing in, find your Supabase Auth user UUID, then run:

```sh
docker compose exec -T postgres psql -U postgres -d webops -v owner_id=YOUR_AUTH_USER_UUID < tests/fixtures/seed_project.sql
```

The fixture is at `http://localhost:8080/index.html`. The API and scanner accept that exact local origin only when `WEBOPS_LOCAL_FIXTURE_ORIGIN` is set and `NODE_ENV` is not `production`. All other local/private destinations remain blocked. The fixture has a harmless form endpoint; `http://localhost:8080/_form_submissions` shows its submission count. Its second origin on port 8081 counts blocked requests at `http://localhost:8081/_hits`.

## Verification

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm format:check
corepack pnpm --filter @webops/web build
corepack pnpm --filter @webops/api build
corepack pnpm --filter @webops/worker build
corepack pnpm openapi:generate
cd services/scanner && uv run python -m unittest discover -s tests -v
```

For a disposable Postgres database, apply the migration as its owner and run `psql -v ON_ERROR_STOP=1 -f tests/db/rls.sql`. This checks owner access and cross-project isolation. The full Phase 1 gate also requires a browser test with a configured Supabase Auth project; that has not run here.

Set `TEST_DATABASE_URL` to a disposable database's `webops_app` connection string and run `corepack pnpm --filter @webops/api test` to include the Phase 1 database-backed API test. Keep Compose and the worker running, then use `node --env-file=.env scripts/test-gates.mjs phase2` for the crawl gate, `node --env-file=.env scripts/test-gates.mjs phase3` for findings and proof, or `node --env-file=.env scripts/test-gates.mjs phase4` for immutable report snapshots and history. Use `all` to run all gates. The Phase 3 gate checks all seeded defects, authorized proof images, edits and revisions, stale version conflicts, Markdown safety, rescan stability, and cross-project isolation. The Phase 4 gate verifies report immutability, frozen issue snapshots, reports history listing, and `not_seen` issue tracking across repeat scans. The unlinked `untitled.html` fixture covers missing titles and first-party 5xx failures.

## Environment

| Variable                        | Use                                                       |
| ------------------------------- | --------------------------------------------------------- |
| `DATABASE_URL`                  | API connection as the RLS-constrained `webops_app` role   |
| `WORKER_DATABASE_URL`           | Worker connection as the scan-scoped `webops_worker` role |
| `REDIS_URL`                     | BullMQ and event fan-out connection                       |
| `SCANNER_PYTHON`                | Python 3.12 executable in the scanner uv environment      |
| `ARTIFACT_DIR`                  | Private local proof directory, default `.artifacts`       |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server-only key for private Storage uploads and signing   |
| `SUPABASE_STORAGE_BUCKET`       | Private bucket name, default `webops-proofs`              |
| `SUPABASE_URL`                  | Auth issuer and JWKS host                                 |
| `SUPABASE_JWT_AUDIENCE`         | Expected JWT audience, usually `authenticated`            |
| `WEB_ORIGIN`                    | Allowed browser origin for API CORS                       |
| `API_PORT`                      | API HTTP port                                             |
| `WORKER_HEALTH_PORT`            | Worker health check HTTP port, default 4001               |
| `WORKER_CONCURRENCY`            | Worker BullMQ concurrency, default 2                      |
| `NEXT_PUBLIC_SUPABASE_URL`      | Browser Supabase Auth URL                                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser public anon key                                   |
| `NEXT_PUBLIC_API_URL`           | Browser API URL                                           |
| `WEBOPS_LOCAL_FIXTURE_ORIGIN`   | Exact local fixture exception, disabled in production     |

## Deployment

The worker Dockerfile packages the Python scanner and Chromium with the BullMQ consumer. Production deployment is blocked until Phase 5 adds filtering egress, managed Redis, quotas, retention jobs, and smoke tests. At that point, build each image from the repository root with its `apps/<service>/Dockerfile`, pass the public `NEXT_PUBLIC_*` values as web build arguments, configure Supabase/Postgres and secrets through Secret Manager, and deploy each as a separate Cloud Run service. Keep the worker private with an always-allocated CPU and at least one warm instance.

## Deliberate deviations and limits

- Local Compose provides Postgres, Redis, and the fixture; Supabase Auth is a configured hosted project. This avoids claiming a local Auth emulator exists.
- The local fixture is the only development exception to public-origin validation. It is disabled in production and must remain isolated from real-site scanning.
- The web build uses Next's webpack path because Turbopack's CSS worker cannot bind a local port in the current sandbox.
- Phase 1 tests cover API authorization with an in-memory repository and RLS with local Postgres. Browser sign-in and project creation have not been exercised end to end without Supabase credentials.
- The Phase 3 crawler stores redacted page metadata and private screenshots. The current scan report has coverage only; immutable issue snapshots are Phase 4.
- Local artifacts are private files shared by the API and worker. Separate deployed services must use the configured private Supabase bucket. Screenshot retention metadata defaults to 90 days; deletion jobs and expired artifact cleanup are Phase 5.
- The deterministic scanner runs without an LLM. The bounded FastMCP agent tools and optional explanation enrichment are deferred to Phase 4.
- Application-level request guards validate DNS immediately before browser requests, but Phase 5 filtering egress is still required to prevent all network bypasses and DNS rebinding at connection time. Only the local fixture is approved for Phase 3 testing.
