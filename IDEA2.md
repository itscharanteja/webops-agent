# 🧠 IDEA-002: Transforming WebOps from Deterministic Crawler to Autonomous Visual Agent

> **Document ID:** IDEA-002  
> **Classification:** Core Architecture Evolution  
> **Status:** Strategic Proposal  
> **Urgency:** High — This is the defining architectural decision for the product.  
> **Date:** November 2026

---

## 1. The Problem: Why the Current System Isn't an Agent

The current WebOps scanner follows a **scripted pipeline**:

```text
Hardcoded BFS Queue → Fixed DOM Selectors → Fixed Rule Triggers → Post-hoc LLM Text Decoration
```

The AI model (Amazon Bedrock) is called **after** all decisions have been made. It receives pre-structured finding data and generates a prettier explanation. If you removed Bedrock entirely, the scan would produce identical findings with slightly less polished descriptions.

**This is not an agent. This is a web crawler with a copywriter attached.**

A true autonomous agent has a **perception → reasoning → action** loop where the AI is the primary decision-maker:

```text
Observe rendered page → Reason about what matters → Decide next action → Execute → Observe result → Repeat
```

---

## 2. The Three Transformations Required

### Transformation 1: Multimodal Visual Perception (Give the Agent Eyes)

**Current:** The scanner extracts structured DOM properties (`element.alt`, `element.tagName`, `document.scrollWidth`) and evaluates them with `if/else` rules. It never "sees" the page.

**Target:** The agent receives the **full rendered screenshot** of every page and viewport, and uses a **multimodal vision model** (Claude 3.5 Sonnet, Gemini 2.5 Pro, or Amazon Nova) to perceive the page the way a human expert would.

#### What Vision Unlocks That DOM Rules Cannot:

| Issue Category                        | Why Fixed Rules Fail                                                                                       | What Vision Detects                                                                                                                 |
| :------------------------------------ | :--------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| **Visual Overlap & Clipping**         | CSS `overflow: hidden` makes the element "correct" in DOM but clips visible content.                       | Agent sees that the CTA button text is cut off at the edge of its container.                                                        |
| **True Color Contrast**               | Text on a CSS gradient or background image has no single `background-color` to compare.                    | Agent evaluates actual pixel contrast in the rendered frame and flags unreadable text.                                              |
| **Layout & Hierarchy Quality**        | DOM order doesn't reflect visual priority. A `<div>` with `position: absolute` could be anywhere.          | Agent sees that the sign-up button is buried below the fold while a decorative banner dominates the viewport.                       |
| **Broken Visual States**              | A spinner stuck forever, a skeleton screen that never resolves, or an error toast that's partially hidden. | Agent recognizes loading failures, empty states, and visual anomalies that aren't DOM errors.                                       |
| **Decorative vs. Informative Images** | Fixed rule flags every `<img>` without `alt`. But decorative spacer images _should_ have empty alt.        | Agent distinguishes: "This is a hero product photo (needs alt)" vs. "This is a decorative gradient divider (empty alt is correct)." |

#### Implementation:

```python
# After Playwright captures the screenshot, send it to the vision model
async def visual_audit(page_screenshot: bytes, page_url: str, viewport: str) -> list[VisualFinding]:
    """Ask the multimodal model to audit the rendered page visually."""
    response = bedrock.converse(
        modelId="anthropic.claude-sonnet-4-20250514",
        messages=[{
            "role": "user",
            "content": [
                {"image": {"format": "jpeg", "source": {"bytes": page_screenshot}}},
                {"text": f"""You are an expert web auditor examining a {viewport} screenshot of {page_url}.

Analyze this rendered page for:
1. Visual accessibility issues (contrast, text readability, touch target sizes)
2. Layout problems (overlapping elements, clipped text, broken alignment)
3. UX friction (buried CTAs, confusing hierarchy, overwhelming density)
4. Broken visual states (stuck loaders, empty sections, error messages)

For each issue found, provide:
- category: "visual_accessibility" | "layout_defect" | "ux_friction" | "broken_state"
- severity: "critical" | "major" | "minor"
- location: describe where on the page (top-left, hero section, footer, etc.)
- observation: exactly what you see
- impact: why this hurts users or business
- suggested_fix: specific actionable remediation

Respond ONLY with issues you can visually confirm in this screenshot.
Do NOT hallucinate issues you cannot see. If the page looks clean, say so.
Return valid JSON array."""}
            ]
        }],
        inferenceConfig={"maxTokens": 2000, "temperature": 0.1},
    )
    # Parse, validate, and filter findings...
```

**Key constraint:** Every visual finding must reference the screenshot it came from. The screenshot is the proof. If the model claims an issue but the screenshot doesn't show it, the finding is rejected.

---

### Transformation 2: Agentic Interactive Exploration (Give the Agent Hands)

**Current:** The scanner loads a page with `page.goto()`, waits for `domcontentloaded`, reads the static DOM, and moves on. It never clicks, scrolls, types, or interacts.

**Target:** The agent autonomously interacts with the page to discover content and issues hidden behind dynamic UI states.

#### What Interaction Unlocks:

| Hidden Content                   | How It's Locked                                                           | What the Agent Does                                                                                             |
| :------------------------------- | :------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------- |
| **Cookie Consent Banners**       | Modal overlay blocks the entire viewport.                                 | Agent identifies the "Accept" or "Reject" button and dismisses it to see the actual page content.               |
| **Mobile Navigation**            | Links are hidden inside a hamburger menu (`display: none` until toggled). | Agent locates the menu icon, clicks it open, and discovers all navigation links inside the drawer.              |
| **Accordion / FAQ Sections**     | Content is collapsed by default.                                          | Agent expands each section to check for broken links, missing images, or formatting issues inside.              |
| **Lazy-Loaded Content**          | Images and sections below the fold load only on scroll.                   | Agent scrolls the page to trigger lazy loading, then audits the newly rendered content.                         |
| **Form Validation Quality**      | Validation errors only appear after interaction.                          | Agent focuses on required fields, submits empty, and evaluates whether error messages are accessible and clear. |
| **Infinite Scroll / Pagination** | More content loads dynamically on scroll or "Load More" click.            | Agent scrolls or clicks to load additional content within budget limits.                                        |

#### Implementation Pattern:

```python
async def interactive_exploration(page: Page, agent_model) -> list[InteractionResult]:
    """Let the agent decide what to interact with on the page."""

    # 1. Take initial screenshot
    screenshot = await page.screenshot(type="jpeg", full_page=True)

    # 2. Ask the agent what interactive elements it sees
    plan = await agent_model.plan_interactions(screenshot, page.url)
    # Returns: [
    #   {"action": "dismiss", "target": "cookie banner", "selector_hint": "button with 'Accept'"},
    #   {"action": "click", "target": "hamburger menu", "selector_hint": "nav toggle button"},
    #   {"action": "scroll", "target": "below fold content", "distance": "full_page"},
    # ]

    results = []
    for step in plan[:MAX_INTERACTIONS]:  # Budget cap: max 5 interactions per page
        if step["action"] == "dismiss":
            # Find and click the dismiss button
            await safe_click(page, step["selector_hint"])
            await page.wait_for_timeout(500)
        elif step["action"] == "click":
            await safe_click(page, step["selector_hint"])
            await page.wait_for_timeout(800)
        elif step["action"] == "scroll":
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(1000)

        # 3. Capture post-interaction screenshot and re-audit
        post_screenshot = await page.screenshot(type="jpeg", full_page=True)
        new_findings = await visual_audit(post_screenshot, page.url, viewport)
        results.extend(new_findings)

    return results
```

**Safety boundaries (critical):**

- **Never submit forms** (no `form.submit()`, no clicking "Purchase", "Delete", "Send").
- **Never type credentials** or personal data.
- **Max 5 interactions per page** to prevent infinite loops.
- **Allowlist interaction types:** dismiss, expand, scroll, hover. No destructive actions.

---

### Transformation 3: Reasoning-Driven Crawl Strategy (Give the Agent a Brain for Navigation)

**Current:** The crawler uses a blind Breadth-First Search (BFS). Every discovered link gets equal priority. The "About Us" page gets the same treatment as the "Checkout" page.

**Target:** The agent **reasons about which pages matter most** and prioritizes its limited crawl budget intelligently.

#### How Intelligent Prioritization Works:

```text
Current BFS (Blind):
  Depth 0: /           → finds 12 links
  Depth 1: /about, /blog, /careers, /terms, /privacy, /pricing, /docs, /login, /features, /contact, /changelog, /press
  (Visits all 12 in arbitrary order, wastes budget on /terms and /press)

Agent-Driven Priority Queue:
  Depth 0: /           → agent sees 12 links, reasons about which matter
  Priority 1 (Critical): /pricing, /features, /login    → "Core conversion & product pages"
  Priority 2 (Important): /docs, /contact               → "User trust & support paths"
  Priority 3 (Low):       /about, /blog, /careers        → "Content pages, lower business risk"
  Skipped:                /terms, /privacy, /press, /changelog → "Boilerplate, audit if budget remains"
```

#### Implementation:

```python
async def prioritize_links(discovered_links: list[dict], page_context: dict, agent_model) -> list[dict]:
    """Ask the agent to rank discovered links by audit importance."""
    prompt = f"""You are auditing a {page_context['category']} website.
You discovered these {len(discovered_links)} links on {page_context['current_url']}:
{json.dumps([{"text": l["text"], "url": l["url"]} for l in discovered_links[:30]])}

Your remaining page budget is {page_context['remaining_budget']} pages.

Rank these links by audit priority. Pages that handle user money, data,
authentication, or core product functionality should be audited first.
Boilerplate pages (terms, privacy policy, press releases) should be last.

Return a JSON array of URLs in priority order."""

    ranked = await agent_model.invoke(prompt)
    return ranked
```

---

## 3. The New Agent Loop (Replacing the Pipeline)

```text
OLD PIPELINE:
  BFS Queue → Visit Page → Run 8 Fixed Checks → Store Findings → Next Page → Done

NEW AGENT LOOP:
  ┌─→ PERCEIVE: Capture screenshot + DOM telemetry
  │       ↓
  │   REASON: "What do I see? What's wrong? What should I interact with?
  │            What page should I visit next? Is this a portfolio or SaaS?"
  │       ↓
  │   ACT: Dismiss banner → Expand menu → Scroll → Click accordion
  │       ↓
  │   EVALUATE: Run deterministic checks (facts) + Visual audit (perception)
  │       ↓
  │   RECORD: Store findings with screenshot proof → Update crawl priority queue
  │       ↓
  └─← REPEAT until budget exhausted
```

---

## 4. What Stays Deterministic (Non-Negotiable)

Not everything should be handed to the AI. These remain hardcoded because they are **mathematical facts, not judgments:**

| Check                            | Why It Must Stay Deterministic                                  |
| :------------------------------- | :-------------------------------------------------------------- |
| HTTP status codes (404, 500)     | A number. No interpretation needed.                             |
| Uncaught `pageerror` exceptions  | The browser runtime caught a real crash. Indisputable.          |
| DNS/SSRF validation              | Security boundary. Never trust an AI to enforce network policy. |
| Horizontal overflow (pixel math) | `scrollWidth > clientWidth + 8` is arithmetic, not opinion.     |
| robots.txt parsing               | Protocol compliance. Fixed spec.                                |
| Origin policy enforcement        | Authorization boundary. Fixed rule.                             |

---

## 5. Phased Transformation Plan

### Phase A: Multimodal Visual Audit Layer (Highest Impact, Fastest Win)

- After Playwright captures each page screenshot, send it to a vision model for semantic analysis.
- Findings from the vision model are tagged `source: "visual_agent"` and carry their screenshot as proof.
- Deterministic findings continue in parallel, tagged `source: "deterministic_check"`.
- The UI shows both side-by-side with clear provenance labels.
- **Impact:** Immediately discovers visual overlap, contrast issues, clipped text, and broken states that fixed rules miss.

### Phase B: Agentic Interactive Exploration

- After initial page load, the agent plans bounded interactions (dismiss banners, open menus, scroll).
- Each interaction triggers a new screenshot and re-audit cycle.
- Safety guardrails: no form submission, no destructive clicks, max 5 interactions per page.
- **Impact:** Discovers hidden navigation, lazy-loaded content, and dynamic UI states.

### Phase C: Reasoning-Driven Crawl Prioritization

- Replace blind BFS with agent-ranked priority queue.
- The agent evaluates discovered links and allocates the limited page budget to the highest-risk pages first.
- **Impact:** Produces more relevant findings in fewer pages, especially on large sites with 100+ routes.

---

## 6. Rating & Recommendation

| Transformation                 |      Effort       |          Impact on "Feels Like an Agent"          | Priority     |
| :----------------------------- | :---------------: | :-----------------------------------------------: | :----------- |
| **A: Visual Perception**       | Medium (3-5 days) | **Massive** — This is the single biggest upgrade. | **Do First** |
| **B: Interactive Exploration** | Medium (3-5 days) |     **High** — Unlocks dynamic modern web UX.     | Do Second    |
| **C: Smart Crawl Priority**    |  Low (1-2 days)   |    **Moderate** — Optimizer, not transformer.     | Do Third     |

**Overall Transformation Rating: 9.7 / 10**

This is the difference between a tool that runs a script and a product that **thinks, sees, and acts** like an expert human auditor.
