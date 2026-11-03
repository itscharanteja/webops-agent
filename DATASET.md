# 🌐 WebOps Evaluation & Benchmark Dataset

> **Dataset ID:** DATASET-001  
> **Source Configuration:** [`tests/dataset/benchmark_sites.json`](file:///Users/charansriteja/Documents/WebOps%20-%20Agentic%20Workflow/tests/dataset/benchmark_sites.json)  
> **Target Scope:** 12 Curated Websites Across 4 Strategic Archetypes  
> **Date:** November 2026

---

## 1. Overview & Objective

This dataset provides a balanced, realistic test suite designed to validate the **WebOps Autonomous Agent**, specifically testing:

1. **Taxonomy & Confidence Scoring:** Verifying that Agent 1 accurately distinguishes between personal portfolios, B2B SaaS platforms, and general web applications.
2. **Dynamic Multi-Agent Triggering:** Ensuring commercial product sites trigger **Agent 2 (Market Intelligence)** for competitor benchmarking, while personal portfolios safely bypass commercial comparisons.
3. **Head-to-Head Comparative Auditing:** Validating that competitor comparisons correctly identify winners, rank score differentials, and cite verifiable S3 evidence.
4. **Deterministic Check Integrity:** Stress-testing the 8 core quality gates (broken links, WCAG form labels, image alt text, horizontal overflow, console exceptions, and SSRF boundaries).

---

## 2. Dataset Classification Matrix

| ID                | Target Site          | URL                                  | Site Archetype         | Expected Confidence | Expected Agent Action              | Benchmark Rival           |
| :---------------- | :------------------- | :----------------------------------- | :--------------------- | :-----------------: | :--------------------------------- | :------------------------ |
| **`port-01`**     | **Lee Robinson**     | `https://leerob.io`                  | **Personal Portfolio** |     $\ge 85\%$      | **Bypass Rivals** (Portfolio Mode) | None _(Solo Engineer)_    |
| **`port-02`**     | **Paco Coursey**     | `https://paco.me`                    | **Personal Portfolio** |     $\ge 90\%$      | **Bypass Rivals** (Portfolio Mode) | None _(Solo Designer)_    |
| **`port-03`**     | **Tania Rascia**     | `https://taniarascia.com`            | **Personal Portfolio** |     $\ge 88\%$      | **Bypass Rivals** (Portfolio Mode) | None _(Open-Source Dev)_  |
| **`saas-01`**     | **Resend**           | `https://resend.com`                 | **Commercial SaaS**    |     $\ge 92\%$      | **Spawn Competitor Agent**         | Postmark / SendGrid       |
| **`saas-02`**     | **Dub.co**           | `https://dub.co`                     | **Commercial SaaS**    |     $\ge 94\%$      | **Spawn Competitor Agent**         | Bitly                     |
| **`saas-03`**     | **Cal.com**          | `https://cal.com`                    | **Commercial SaaS**    |     $\ge 95\%$      | **Spawn Competitor Agent**         | Calendly                  |
| **`saas-04`**     | **Supabase**         | `https://supabase.com`               | **Developer Tools**    |     $\ge 96\%$      | **Spawn Competitor Agent**         | Firebase                  |
| **`ecom-01`**     | **Raycast**          | `https://www.raycast.com`            | **Product & Store**    |     $\ge 92\%$      | **Spawn Competitor Agent**         | Alfred / Linear           |
| **`sandbox-01`**  | **The Internet**     | `https://the-internet.herokuapp.com` | **Test Fixture**       |     $\ge 70\%$      | **Standard Audit**                 | None _(Practice App)_     |
| **`sandbox-02`**  | **Quotes to Scrape** | `https://quotes.toscrape.com`        | **Scraping Sandbox**   |     $\ge 75\%$      | **Standard Audit**                 | None _(Bot Friendly)_     |
| **`baseline-01`** | **Example Domain**   | `https://example.com`                | **Baseline Reference** |     $\ge 80\%$      | **Standard Audit**                 | None _(Pristine 100/100)_ |
| **`fixture-01`**  | **Local Fixture**    | `http://localhost:8080/index.html`   | **Defect Testbed**     |     $\ge 85\%$      | **Spawn Competitor Agent**         | Stripe                    |

---

## 3. Detailed Archetype Profiles & Evaluation Criteria

### Category A: Personal Portfolios (Validating Safe Rival Bypass)

#### 1. `https://leerob.io` (Lee Robinson — VP of Product / Tech Leader)

- **Why Selected:** Prominent personal portfolio and engineering blog with first-person writing (_"I'm Lee"_, _"My projects"_), open-source showcase, and zero commercial pricing.
- **Agent Test Expectation:**
  - `archetype`: `personal_portfolio`
  - `confidence`: $\ge 0.85$
  - `agent_action`: **Bypass commercial competitor agent.**
  - **Audit Focus:** Inspects personal link health, blog navigation, and mobile article readability. Prevents embarrassing comparisons to enterprise SaaS giants.

#### 2. `https://paco.me` (Paco Coursey — Interface Designer)

- **Why Selected:** Renowned minimalist design portfolio highlighting craft, case studies, and UI components.
- **Agent Test Expectation:**
  - `archetype`: `personal_portfolio`
  - `confidence`: $\ge 0.90$
  - `agent_action`: **Bypass commercial competitor agent.**
  - **Audit Focus:** Evaluates mobile touch targets, image alt descriptions on design mocks, and font rendering.

#### 3. `https://taniarascia.com` (Tania Rascia — Software Engineer & Writer)

- **Why Selected:** Classic developer portfolio containing an "About Me" bio, resume/CV links, GitHub links, and technical tutorials.
- **Agent Test Expectation:**
  - `archetype`: `personal_portfolio`
  - `confidence`: $\ge 0.88$
  - `agent_action`: **Bypass commercial competitor agent.**
  - **Audit Focus:** Verifies resume download link availability and responsive layout.

---

### Category B: Commercial B2B SaaS & Developer Platforms (Validating Competitor Benchmarking)

#### 4. `https://resend.com` (Email Infrastructure API)

- **Why Selected:** Elite modern developer product with transparent pricing tiers, SDK code snippets, and high-conversion dark-mode hero.
- **Agent Test Expectation:**
  - `archetype`: `commercial_product` (Developer Tools)
  - `confidence`: $\ge 0.92$
  - `agent_action`: **Spawns Agent 2.** Discovers rivals: _Postmark_, _SendGrid_, _Mailgun_.
  - **Audit Focus:** Head-to-Head arena evaluates checkout flow accessibility, mobile code block overflow, and first-party API health.

#### 5. `https://dub.co` (Open-Source Link Management)

- **Why Selected:** Fast-growing B2B SaaS with enterprise features, customer testimonials, pricing plans, and SOC2 badges.
- **Agent Test Expectation:**
  - `archetype`: `commercial_product` (SaaS Productivity)
  - `confidence`: $\ge 0.94$
  - `agent_action`: **Spawns Agent 2.** Benchmark rival: _Bitly_.
  - **Audit Focus:** Head-to-Head arena compares form accessibility and CTA conversion clarity against Bitly.

#### 6. `https://cal.com` (Open-Source Scheduling Infrastructure)

- **Why Selected:** Commercial product platform directly challenging market incumbent Calendly.
- **Agent Test Expectation:**
  - `archetype`: `commercial_product` (SaaS Productivity)
  - `confidence`: $\ge 0.95$
  - `agent_action`: **Spawns Agent 2.** Benchmark rival: _Calendly_.
  - **Audit Focus:** Validates booking modal accessibility and keyboard navigation.

#### 7. `https://supabase.com` (Postgres Developer Platform)

- **Why Selected:** Large-scale commercial platform with complex documentation, pricing calculator, and enterprise SLA links.
- **Agent Test Expectation:**
  - `archetype`: `commercial_product` (Developer Tools)
  - `confidence`: $\ge 0.96$
  - `agent_action`: **Spawns Agent 2.** Benchmark rival: _Firebase_.
  - **Audit Focus:** Evaluates Core Web Vitals, dark-mode color contrast, and docs navigation.

---

### Category C: Public Sandboxes & Fixture Sites (Safe Practice & Stress Testing)

#### 8. `https://the-internet.herokuapp.com` (Heroku Test Fixture)

- **Why Selected:** Industry-standard test app created by Dave Haeffner specifically for browser automation. Contains intentionally broken images, dynamic JavaScript controls, and challenging DOM structures.
- **Audit Focus:** Verifies deterministic rule triggers without crashing the crawler or triggering bot detection.

#### 9. `https://quotes.toscrape.com` (Bot-Friendly Scraping Sandbox)

- **Why Selected:** Built explicitly for scraping and crawler testing with 100% permissive `robots.txt`. Contains pagination, author tags, and clean semantic markup.
- **Audit Focus:** Verifies breadth-first traversal, page budget enforcement, and monotonic event ordering.

#### 10. `https://example.com` (IANA Baseline Reference)

- **Why Selected:** The global standard single-page baseline. Guaranteed 0 console errors, 0 broken links, and 100% compliant HTML.
- **Audit Focus:** Validates that pristine websites receive a flawless **100/100 Quality Score (Grade A+)** and clean deliverable generation.

#### 11. `http://localhost:8080/index.html` (Local WebOps Fixture Testbed)

- **Why Selected:** Local Docker fixture intentionally seeded with the 6 core defects:
  1. _Missing Image Alt Text_ (`<img>` without alt attribute)
  2. _Unlabeled Form Control_ (`<input>` without associated label or aria-label)
  3. _Horizontal Layout Overflow_ (1200px fixed card in mobile viewport)
  4. _JavaScript Console Error_ (`console.error('Simulated script failure')`)
  5. _Broken Internal Link_ (`href="missing.html"` returning HTTP 404)
  6. _Page Request Failure_ (HTTP 500 endpoint)
- **Audit Focus:** Validates that every seeded defect is detected, fingerprinted, and backed by verifiable cryptographic S3 proof.

---

## 4. How to Execute an Audit Against Any Dataset Target

### Method 1: Via the Web Dashboard (Recommended)

1. Open the Web Dashboard at **`http://localhost:3000`** (or `https://d33zu6s8ozyktq.cloudfront.net` in production).
2. Click **"+ New Project"**.
3. Select any URL from the dataset above:
   - Example (Portfolio): `https://leerob.io` (Origin: `https://leerob.io`)
   - Example (SaaS): `https://resend.com` (Origin: `https://resend.com`)
   - Example (Sandbox): `https://the-internet.herokuapp.com` (Origin: `https://the-internet.herokuapp.com`)
4. Click **"Launch Audit"** to watch the multi-agent event stream in real time.

### Method 2: Via the REST API

```bash
# 1. Create the project
curl -s -X POST http://localhost:4000/v1/projects \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-user" \
  -d '{
    "name": "Resend Audit",
    "baseUrl": "https://resend.com",
    "approvedOrigins": ["https://resend.com"],
    "crawlLimits": {
      "maxPages": 10,
      "maxDepth": 2,
      "concurrency": 2,
      "navigationTimeoutMs": 10000,
      "pageTimeoutMs": 30000,
      "scanTimeoutMs": 300000,
      "requestsPerSecond": 2
    }
  }'

# 2. Trigger the scan using returned project ID
curl -s -X POST http://localhost:4000/v1/projects/<PROJECT_ID>/scans \
  -H "Authorization: Bearer dev-user"
```

---

## 5. Security & Rate-Limiting Guardrails

When running audits against external sites:

1. **SSRF Guard:** The crawler automatically resolves DNS and blocks requests to private RFC1918 IPs, AWS metadata (`169.254.169.254`), and loopback addresses.
2. **Politeness & Rate Limits:** Default scan velocity is throttled to **2 requests/second** per origin to prevent load spikes on target servers.
3. **Robots.txt Conformance:** The crawler parses and respects `robots.txt` disallow directives by default.
