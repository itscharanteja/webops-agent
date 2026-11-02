# WebOps Agent — implementation instructions

Build a web application that audits websites the user is authorized to test. A scan crawls pages with Playwright, runs reproducible checks, and produces an editable issues board. Every issue must link to stored proof. Users can watch scan progress, inspect past reports, and download any issue as Markdown.

This file is the implementation contract for a coding agent. Implement the phases in order, keep the acceptance tests passing, and document any deliberate deviation in the repository README.

## Product contract

1. A user creates a project with a base URL and explicitly approved origins. A scan cannot visit an unapproved origin.
2. A scan crawls discoverable pages within configured limits and records page URL, final URL, status, title, timing, screenshot, console messages, and failed requests.
3. Deterministic checks create findings with one or more persisted evidence records. A finding without usable proof is not published as an issue.
4. Each issue shows priority, status, title, affected URL, impact, exact observation, reproduction steps, suggested fix, rule/check ID, confidence, scan date, and clickable evidence citations. Clicking a citation opens a proof viewer with the relevant screenshot, DOM excerpt, console message, network event, or URL result.
5. The issues board supports filtering, sorting, priority/status edits, title/description edits, and per-issue `.md` downloads. Edits survive later scans. Issue changes are audited.
6. A live console-style view shows ordered scan events and resumes after refresh without losing earlier lines.
7. Each completed scan creates an immutable historical report. Users can reopen it and see the issues and evidence as they appeared at scan completion, even if current board entries have since changed.

## Stack and repository layout

Use a TypeScript monorepo with `pnpm` and Python managed with `uv`:

```text
apps/web/                 Next.js App Router, TypeScript, Mantine components, Tailwind utilities
apps/api/                 Fastify, TypeScript, authenticated REST and SSE
apps/worker/              BullMQ consumer and scan orchestration, TypeScript
services/scanner/         Python 3.12, Playwright, FastMCP tools, deterministic checks
packages/contracts/       Zod schemas, generated OpenAPI types, shared enums
supabase/migrations/      SQL schema, indexes, RLS policies
infra/                    Cloud Run deployment files and configuration examples
tests/fixtures/site/      Local site with known defects and safe form test fixtures
```

Supabase provides Auth, Postgres, and private Storage. Redis provides BullMQ and short-lived event fan-out. Postgres is the source of truth for scans, issues, evidence metadata, and event history. Deploy web, API, and worker as separate GCP Cloud Run services; keep at least one worker instance warm with CPU allocated while idle so BullMQ can consume jobs. Package the Python scanner and Chromium with the worker, and launch the scanner as a supervised subprocess per job. Use newline-delimited JSON over stdout for progress/results and stderr for process diagnostics. The scanner's FastMCP server exposes only the bounded tools below to its agent runtime; neither the UI nor public API can call browser tools directly. Set per-job process, browser, page, and network timeouts.

Keep each boundary typed: Zod for public API payloads, Pydantic for scanner inputs/outputs, and a versioned JSON protocol between worker and scanner. Pin dependencies and Playwright browser version.

Use these shared enums from day one: scan status `queued | running | completed | partial | failed | cancelled`; issue status `open | in_progress | resolved | wont_fix`; priority `P0 | P1 | P2 | P3`; event level `debug | info | warn | error`; evidence kind `screenshot | dom | console | network | url`. Default priorities: site-wide outage or major broken flow `P0`, broken page/link or repeatable JavaScript failure `P1`, accessibility defect or first-party request failure `P2`, metadata/low-impact defect `P3`. These are initial values that editors can change. Store a separate detected severity in each observation so edits do not rewrite scan facts.

## Core workflow

```text
Create project → approve exact origins → request scan → BullMQ job
→ validate policy → Playwright crawl → deterministic checks
→ persist evidence and observations → attach/upsert board issues
→ snapshot report → mark scan complete
```

The API creates a `queued` scan and enqueues only its ID. The worker loads the saved policy, starts the scanner, persists each emitted event with a monotonically increasing scan sequence, and publishes it to Redis for SSE subscribers. On worker retry, reuse the scan ID and make page, evidence, and observation writes idempotent. At completion, commit the report snapshot and scan status together in a transaction. On cancellation, timeout, or failure, preserve collected events/evidence and mark the scan accordingly; never label a partial scan complete.

Define scanner stdout as one JSON object per line: `{ "v": 1, "type": "event|page|candidate|finding|done", "scan_id": "uuid", "idempotency_key": "string", "payload": {} }`. Reject malformed/oversized lines, unknown protocol versions, and mismatched scan IDs. A `done` message includes visited/skipped/failed counts and limitations. The worker acknowledges the BullMQ job only after the terminal scan status and event are committed. A stalled job may restart, but unique keys and database constraints prevent duplicate observations.

The crawler uses breadth-first traversal of links found in rendered pages. Normalize URLs (remove fragments, canonicalize host/port, resolve relative URLs), deduplicate, and enforce exact approved origins on every navigation, redirect, request, WebSocket, frame, and discovered link. Defaults: 25 pages, depth 3, two concurrent pages, 10 seconds navigation timeout, 60 seconds per page, 15 minutes per scan, and 2 requests/second per origin. Make limits configurable downward/upward by an administrator, with hard server caps. Respect `robots.txt` by default and record skipped URLs. Treat login, CAPTCHA, and blocked pages as scan limitations, not defects.

Run initial checks on desktop (1440×900) and mobile (375×812). For MVP, implement these rule IDs and keep their output deterministic:

| Rule ID | Trigger | Required proof |
| --- | --- | --- |
| `HTTP_PAGE_ERROR` | Approved page returns 4xx/5xx or navigation fails | URL, status/error, final URL, timestamp |
| `BROKEN_INTERNAL_LINK` | A visible internal link resolves to 4xx/5xx or fails | source URL, anchor DOM locator/text, destination URL and response/error |
| `JS_CONSOLE_ERROR` | Uncaught page error or console `error` | page URL, message, stack/source location when available |
| `FAILED_FIRST_PARTY_REQUEST` | First-party request fails or returns 5xx | method, redacted URL, status/failure, initiator if available |
| `MISSING_IMAGE_ALT` | Informative image lacks alt text | image DOM locator, sanitized HTML excerpt, screenshot crop |
| `UNLABELED_FORM_CONTROL` | Interactive input lacks an accessible name | control DOM locator, sanitized HTML excerpt, screenshot crop |
| `MISSING_PAGE_TITLE` | HTML page has no nonblank title | page URL and sanitized head excerpt |
| `HORIZONTAL_OVERFLOW` | Document width exceeds viewport by more than 8 px | viewport dimensions, measured widths, full screenshot |

Suppress duplicate console/network events and known browser noise. Tag third-party failures separately as informational observations until the user includes that origin in the scan policy. Record check version and browser version so results are reproducible. A scan may report `0 issues` only when the scan finished successfully; otherwise show incomplete coverage.

## Data model

Use UUID primary keys, `timestamptz`, foreign keys, indexes on project/scan/status/fingerprint, and JSONB only for versioned rule-specific details. Minimum tables:

| Table | Required fields and purpose |
| --- | --- |
| `projects` | `id`, `owner_id`, `name`, `base_url`, `approved_origins[]`, crawl defaults, `created_at` |
| `project_members` | `project_id`, `user_id`, `role` (`owner`, `editor`, `viewer`) |
| `scans` | `id`, `project_id`, `status`, config snapshot, timestamps, page counts, error, scanner/check versions |
| `scan_pages` | `id`, `scan_id`, normalized URL, final URL, depth, HTTP status, title, timing, `visited_at`; unique `(scan_id, normalized_url)` |
| `scan_events` | `scan_id`, integer `seq`, `at`, `level`, `phase`, `message`, safe structured payload; unique `(scan_id, seq)` |
| `evidence` | `id`, `scan_id`, `page_id`, `kind`, `captured_at`, `locator`, redacted `payload`, private Storage `object_key`, checksum, MIME type |
| `issues` | `id`, `project_id`, stable `fingerprint`, current title/description/priority/status, `version`, first/last seen, timestamps; unique `(project_id, fingerprint)` |
| `issue_observations` | `id`, `issue_id`, `scan_id`, `page_id`, rule ID/version, detected severity, confidence, observed facts, explanation snapshot, `created_at`; unique `(scan_id, fingerprint, page_id)` |
| `observation_evidence` | `observation_id`, `evidence_id`, citation order and label |
| `issue_revisions` | `issue_id`, editor ID, timestamp, old/new values, change reason, version |
| `reports` | `id`, `scan_id`, immutable summary, coverage, issue snapshot JSON, created timestamp; unique `scan_id` |

Use a fingerprint based on `(rule_id, normalized page URL, stable target locator or destination)`; do not include volatile message text, timestamps, or screenshot IDs. A repeated finding updates `last_seen` and creates a new observation. Do not overwrite user-edited issue fields. Mark issues absent from a *successful, sufficiently covered* repeat scan as `not_seen` in a derived field; never auto-close them. Capture the title, priority, status, explanation, and evidence IDs inside `reports.issue_snapshot` so history does not drift. Store screenshots and large artifacts in a private Storage bucket using generated object keys, not public URLs.

Persist an observation only after its required proof is stored. Use a database transaction for the observation, evidence links, issue upsert, and revision metadata; uploaded objects orphaned by a failed transaction are removed by cleanup. Store each report's coverage as counts plus the exact set of visited URLs and skip reasons. A historical report reads only its snapshot and observation/evidence records, never current issue fields.

## Proof and citation contract

Every rendered citation has an evidence ID and stable in-app route:

`/projects/{projectId}/scans/{scanId}/evidence/{evidenceId}`

The proof viewer must enforce project access before showing metadata or issuing a short-lived signed Storage URL. Show the source page URL, capture time, rule, and proof type. For screenshot proof, display the image and highlight the stored bounding box when available. For DOM proof, show escaped, sanitized HTML/text plus locator. For console proof, show message and stack/source. For network proof, show redacted method, URL, status/failure, and timing. For URL proof, show source/destination/final URL and status. Include links back to the issue and scan. If an artifact has expired or failed to upload, show a clear `proof unavailable` state; do not present an unverified citation.

Redact credentials, cookies, authorization headers, query keys commonly carrying tokens, and user-entered form values before persisting logs, URLs, DOM, or network data. Never store raw HAR files by default. Render DOM as text, never executable HTML. Use short signed URL lifetimes and a configurable artifact retention policy (default 90 days); report metadata remains available after artifact expiry and states that proof is no longer retained.

## API and UI

All endpoints use Supabase JWT authentication, project membership authorization, pagination, and structured errors. The API uses service credentials only server-side. Generate OpenAPI from Fastify schemas.

| Method and path | Behavior |
| --- | --- |
| `POST /v1/projects`, `GET /v1/projects`, `GET /v1/projects/:id`, `PATCH /v1/projects/:id` | Create/read/update authorized project and scan policy |
| `POST /v1/projects/:id/scans` | Validate policy, create queued scan, enqueue job; return `202` and scan ID |
| `GET /v1/projects/:id/scans`, `GET /v1/scans/:id` | Paginated history and scan status/coverage |
| `POST /v1/scans/:id/cancel` | Request cancellation, record event, end browser job safely |
| `GET /v1/scans/:id/events?after=<seq>` | Replay ordered events; SSE supports `Last-Event-ID`, heartbeat, and reconnect |
| `GET /v1/scans/:id/pages`, `GET /v1/scans/:id/report` | Page coverage and immutable report snapshot |
| `GET /v1/projects/:id/issues`, `GET /v1/issues/:id` | Filter/sort board, read detail and observations |
| `PATCH /v1/issues/:id` | Edit title, description, priority, status using `If-Match` issue version; return `409` on conflict and create revision |
| `GET /v1/issues/:id/markdown` | `text/markdown` attachment with current issue fields, latest observation, reproduction, and evidence links |
| `GET /v1/evidence/:id` | Authorized proof metadata and short-lived signed artifact URL |

Pages: project list/create; project overview with scan action; live scan page with terminal-style event lines and progress; issues board with filters and inline priority/status edits; issue detail with explanation, editable fields, observation timeline, proof citations, and `.md` download; report history list and immutable report detail. Display scan limitations and coverage prominently. Keyboard navigation and accessible labels are required. Use Mantine for complex controls and Tailwind for layout; keep one shared visual theme.

Markdown export must be deterministic, UTF-8, safe to render, and include: title, priority/status, affected URL, latest scan and observation time, exact observation, impact, reproduction steps, suggested fix, rule/check ID, confidence, and proof links. Escape user-edited text where it could break structure. Set a safe filename based on the issue ID and slug.

## Scanner agent and tools

The Python runner may use an LLM to write explanations and suggest fixes, but it must call bounded FastMCP tools to inspect pages. Tool input and output schemas are Pydantic models; each call carries `scan_id` and a server-issued policy context. Implement these tools:

| Tool | Inputs | Output and boundary |
| --- | --- | --- |
| `get_scan_policy` | scan ID | Approved origins, limits, feature flags; no secrets in model-visible output |
| `crawl_next_page` | scan ID | Next validated URL/page ID or done; enforces depth, budget, rate, robots, and origin policy |
| `inspect_page` | page ID, viewport | Structured Playwright observations; no arbitrary URL argument |
| `run_checks` | page ID, viewport | Versioned deterministic candidate findings with exact observations |
| `capture_evidence` | candidate ID, requested proof kinds | Stored evidence IDs and verification status; sanitize and redact before save |
| `record_finding` | candidate ID, evidence IDs, optional explanation | Persist only if rule trigger and proof validate; idempotent fingerprint |
| `emit_progress` | phase, level, safe message/data | Ordered persisted event; reject secrets and excessive payloads |
| `finish_scan` | scan ID | Coverage totals and completion eligibility; only worker commits final report |

The LLM cannot change the approved origins, navigate arbitrary URLs, issue raw HTTP requests, execute page JavaScript, submit forms, invent evidence IDs, or decide that an unverified candidate is a published issue. Run deterministic checks first. Give the LLM only redacted candidate facts and evidence summaries. Require its explanation to cite existing evidence IDs; validate those IDs and reject unsupported claims. On model timeout/error, publish the deterministic finding with a template-based explanation so the scan still completes. Label any future LLM-only discovery as `needs_review` and keep it off the published issues board until a deterministic validator or human confirms it.

## Safety and operational controls

- Require the user to affirm they own or are authorized to test each approved origin. Store approval identity and timestamp. Default to public, unauthenticated pages. Authenticated scans are a later phase and require encrypted credentials, explicit test account scope, and stronger redaction.
- Prevent SSRF at both application and network layers. Reject local, private, link-local, loopback, multicast, reserved, and cloud metadata addresses (IPv4 and IPv6), unusual IP encodings, userinfo URLs, non-HTTP(S) schemes, and unexpected ports. Resolve and validate DNS at each request/redirect; guard against DNS rebinding. Enforce egress through a filtering proxy/firewall so browser subresources and WebSockets cannot bypass application checks. Fail closed when validation fails.
- Use isolated browser contexts with no persistent cookies or filesystem access. Block downloads and file uploads. Do not run arbitrary scripts from agent prompts. Restrict cross-origin requests to the approved policy. Cap response sizes and artifact sizes.
- Safe form testing is off by default. MVP may inspect labels/validation without submitting. A later explicit staging-only option may submit allowlisted, non-destructive forms using test data and test accounts; require a per-form allowlist and dry-run preview. Never click purchase, delete, send, publish, transfer, or other irreversible actions.
- Apply per-user/project scan quotas and concurrency limits. Rate limit the API and crawler. Log job IDs and request IDs, not sensitive page content. Monitor queue age, scan duration, failed jobs, Storage usage, and proof-link failures.
- Apply Postgres RLS for member-scoped reads and writes. Keep Supabase service keys, Redis credentials, and model keys in Secret Manager. Use private Cloud Run ingress for the worker, TLS for Redis, and least-privilege service accounts. Set retention and deletion jobs for screenshots and logs.

## Phased build plan

Complete each phase and its gate before the next. Keep a short `README.md` with local setup, environment variables, run commands, and deployment steps.

### Phase 1 — foundation

- [ ] Scaffold monorepo, shared contracts, formatting/type checks, Dockerfiles, and local Compose for Postgres/Supabase-compatible services and Redis.
- [ ] Add migrations, RLS policies, Auth integration, project CRUD, approved-origin validation, and project creation UI.
- [ ] Add fixture site with known defects and a harmless form; seed a test project.
- **Gate:** unauthenticated and cross-project access fail; a project can be created with only valid public origins.

### Phase 2 — bounded crawler and events

- [ ] Add BullMQ job lifecycle, scanner subprocess protocol, Playwright browser install, URL/egress policy, crawl queue, budgets, robots handling, cancellation, and retry idempotency.
- [ ] Persist scan pages and ordered events; stream SSE with replay and reconnect; build live console UI.
- **Gate:** fixture scan visits only approved pages, events remain ordered after refresh, cancel stops navigation, and blocked internal/metadata destinations never receive a request.

### Phase 3 — findings and proof

- [ ] Implement listed deterministic checks, fingerprinting, evidence capture/redaction, private Storage uploads, issue observations, and proof viewer.
- [ ] Add issue board, detail page, editing with version conflict handling, revision audit, and Markdown download.
- **Gate:** each seeded defect produces the expected issue and a working clickable citation; edits persist across rescans and exports.

### Phase 4 — history and explanations

- [ ] Write immutable report snapshots, history pages, coverage/limitations, and `not_seen` tracking.
- [ ] Add optional LLM explanation enrichment with validated citations and deterministic fallback.
- **Gate:** modifying an issue after scan completion does not change the old report; model failure still yields a complete deterministic report.

### Phase 5 — deploy and harden

- [ ] Deploy web/API/worker to Cloud Run, Redis to managed Redis, secrets to Secret Manager, Storage as private bucket, and configure filtering egress.
- [ ] Add quotas, observability, retention jobs, load checks, and deployment/runbook documentation.
- **Gate:** production smoke scan finishes within configured limits, proof links require authorization, and expired artifacts show their retention state.

## Acceptance tests

Automate these as integration/end-to-end tests against the local fixture site, plus unit tests for URL validation and fingerprints:

1. **Crawl:** Given five linked fixture pages, a scan records exactly the reachable approved pages up to its budget and logs each transition in order.
2. **Proof:** A broken link, console error, missing alt text, unlabeled input, and overflow each create a finding whose citation opens the correct stored proof; screenshot evidence shows the relevant page/viewport.
3. **Board:** User changes priority, status, title, and description. Reload and rescan preserve edits; a stale `If-Match` returns `409` and does not overwrite them.
4. **Markdown:** Downloaded issue `.md` includes current edits, reproducible steps, rule ID, and proof links; filename and content do not allow header/script injection.
5. **Live log:** Disconnect during a scan and reconnect with `Last-Event-ID`; every persisted event appears once and in sequence.
6. **History:** Open report A, run report B, edit a current issue, then reopen A; its issue snapshot and evidence links remain as captured, subject to stated artifact retention.
7. **SSRF:** Reject localhost, private IPv4/IPv6, metadata IPs, DNS rebinding, redirect to blocked host, blocked subresources, and unapproved WebSockets before connecting.
8. **Form safety:** Default scan neither submits the fixture form nor triggers its side-effect endpoint.
9. **Failure:** Browser crash, worker retry, model timeout, and artifact upload failure produce accurate scan status, no duplicate issues, and no false proof citations.
10. **Authorization:** A member of project B cannot read project A's issues, scan events, reports, evidence metadata, signed artifacts, or Markdown exports.

## Definition of done

The MVP is done when phases 1–4 pass their gates, all acceptance tests relevant to those phases pass, and a new developer can run the fixture scan from the README. Phase 5 is required before accepting scans of real external sites. Do not claim a completed scan when coverage is partial, and do not show an issue citation unless its proof was persisted and can be opened by an authorized user.
