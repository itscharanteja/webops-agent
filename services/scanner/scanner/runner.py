"""Single-job, bounded Playwright crawler. Stdout is protocol JSON only."""

from __future__ import annotations

import asyncio
import base64
from collections import deque
from dataclasses import dataclass, field
from hashlib import sha256
import json
import sys
import time
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

from playwright.async_api import async_playwright, BrowserContext, Page, Route, WebSocketRoute

from .policy import PolicyError, UrlPolicy, normalize_url, origin_of, safe_text, safe_url
from .protocol import DonePayload, EventPayload, FindingPayload, PagePayload, PageScreenshotPayload, ProtocolMessage, ScanInput
from .checks import CHECK_VERSION, VIEWPORTS, finding, run_dom_checks, screenshot_proof
from .taxonomy import classify_site_context
from .visual_agent import run_visual_audit
from .interaction_agent import explore_page_interactions
from .crawl_prioritizer import prioritize_links


def key(prefix: str, value: str) -> str:
    return f"{prefix}:{sha256(value.encode()).hexdigest()}"


class Emitter:
    def __init__(self, scan_id: str):
        self.scan_id = scan_id

    def send(self, kind: str, idempotency_key: str, payload: dict) -> None:
        payload_model = {"event": EventPayload, "page": PagePayload, "candidate": PageScreenshotPayload,
                         "finding": FindingPayload, "done": DonePayload}.get(kind)
        if payload_model is not None:
            payload = payload_model.model_validate(payload).model_dump(mode="json")
        message = ProtocolMessage.model_validate({
            "v": 1, "type": kind, "scan_id": self.scan_id,
            "idempotency_key": idempotency_key, "payload": payload,
        })
        sys.stdout.write(json.dumps(message.model_dump(mode="json"), separators=(",", ":")) + "\n")
        sys.stdout.flush()

    def event(self, phase: str, level: str, message: str, idempotency_key: str, data: dict | None = None) -> None:
        self.send("event", idempotency_key, {"phase": phase, "level": level,
                                             "message": safe_text(message), "data": data or {}})


@dataclass
class PageResult:
    url: str
    depth: int
    final_url: str | None = None
    status: int | None = None
    title: str | None = None
    timing_ms: int | None = None
    visited_at: str = ""
    links: list[dict[str, str]] = field(default_factory=list)
    console: list[str] = field(default_factory=list)
    failed_requests: list[dict[str, str]] = field(default_factory=list)
    network_events: list[dict[str, str]] = field(default_factory=list)
    findings: list[dict] = field(default_factory=list)
    screenshots: list[tuple[str, dict]] = field(default_factory=list)
    limitation: str | None = None


class Crawler:
    def __init__(self, request: ScanInput):
        self.request = request
        self.scan_id = str(request.scan_id)
        self.emitter = Emitter(self.scan_id)
        self.policy = UrlPolicy(request.approved_origins, request.local_fixture_origin)
        self.visited: list[str] = []
        self.skipped: list[dict[str, str]] = []
        self.limitations: list[str] = []
        self.failed_count = 0
        self.complete = True
        self.robots: dict[str, RobotFileParser | None] = {}
        self.rate_locks: dict[str, asyncio.Lock] = {}
        self.next_request_at: dict[str, float] = {}
        self.results: dict[str, PageResult] = {}
        self.context_info: dict | None = None

    def send_finding(self, key_str: str, item: dict) -> None:
        # Proof IDs are assigned by the worker after storage. The scanner must not
        # ask a model to cite positional placeholders before those IDs exist.
        self.emitter.send("finding", key_str, item)

    def skip(self, url: str, reason: str) -> None:
        if len(self.skipped) < 500:
            self.skipped.append({"url": safe_url(url)[:2048], "reason": reason[:200]})
        self.emitter.event("crawl", "warn", f"Skipped {safe_url(url)}: {reason}", key("skip", url + reason),
                           {"url": safe_url(url)[:2048], "reason": reason[:200]})

    async def rate_limit(self, origin: str) -> None:
        lock = self.rate_locks.setdefault(origin, asyncio.Lock())
        async with lock:
            now = time.monotonic()
            wait = max(0.0, self.next_request_at.get(origin, now) - now)
            if wait:
                await asyncio.sleep(wait)
            self.next_request_at[origin] = time.monotonic() + 1 / self.request.limits.requestsPerSecond

    async def guard(self, route: Route) -> None:
        request = route.request
        raw = request.url
        if request.method not in ("GET", "HEAD"):
            self.skip(raw, "Non-read request blocked")
            await route.abort("blockedbyclient")
            return
        try:
            url = await self.policy.validate(raw)
            await self.rate_limit(origin_of(url))
        except PolicyError as error:
            self.skip(raw, str(error))
            await route.abort("blockedbyclient")
            return
        await route.continue_()

    async def block_websocket(self, ws: WebSocketRoute) -> None:
        self.skip(ws.url, "WebSocket blocked during read-only scan")
        await ws.close(code=1008, reason="Scan policy")

    async def robots_for(self, origin: str, context: BrowserContext) -> RobotFileParser | None:
        if origin in self.robots:
            return self.robots[origin]
        robots_url = origin + "/robots.txt"
        try:
            await self.policy.validate(robots_url)
            page = await context.new_page()
            try:
                response = await page.goto(robots_url, wait_until="commit", timeout=self.request.limits.navigationTimeoutMs)
                if response is None or response.status >= 500:
                    raise PolicyError("robots.txt unavailable")
                if response.status in (401, 403):
                    raise PolicyError("robots.txt denies access")
                if response.status == 404:
                    parser = RobotFileParser()
                    parser.parse([])
                else:
                    body = await response.text()
                    if len(body) > 64_000:
                        raise PolicyError("robots.txt too large")
                    parser = RobotFileParser()
                    parser.parse(body.splitlines())
            finally:
                await page.close()
            self.robots[origin] = parser
        except Exception as error:
            self.robots[origin] = None
            self.complete = False
            self.limitations.append(f"Could not verify robots.txt for {origin}: {safe_text(str(error), 200)}")
        return self.robots[origin]

    async def inspect(self, context: BrowserContext, url: str, depth: int) -> PageResult:
        started = time.monotonic()
        result = PageResult(url=url, depth=depth,
                            visited_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        page: Page = await context.new_page()
        page.set_default_timeout(self.request.limits.pageTimeoutMs)
        page.set_default_navigation_timeout(self.request.limits.navigationTimeoutMs)
        def console_seen(msg):
            if len(result.console) >= 100:
                return
            location = msg.location or {}
            source = safe_url(location["url"]) if location.get("url") else ""
            suffix = f" at {source}:{location.get('lineNumber', 0)}:{location.get('columnNumber', 0)}" if source else ""
            result.console.append(safe_text(f"{msg.type}: {msg.text}{suffix}"))
        def page_error(error):
            if len(result.console) < 100:
                result.console.append(safe_text(f"pageerror: {getattr(error, 'stack', None) or error}"))
        page.on("console", console_seen)
        page.on("pageerror", page_error)
        def failed(req):
            try:
                if origin_of(req.url) not in self.policy.origins or "blockedbyclient" in str(req.failure):
                    return
                item = {"url": safe_url(req.url)[:2048], "error": safe_text(str(req.failure or "Request failed"), 500)}
                if len(result.failed_requests) < 100:
                    result.failed_requests.append(item)
                if len(result.network_events) < 100:
                    result.network_events.append({**item, "method": req.method})
            except PolicyError:
                return
        def response_seen(response):
            try:
                if response.status >= 500 and origin_of(response.url) in self.policy.origins and len(result.network_events) < 100:
                    result.network_events.append({"url": safe_url(response.url), "method": response.request.method,
                                                  "error": f"HTTP {response.status}", "status": str(response.status)})
            except PolicyError:
                return
        page.on("requestfailed", failed)
        page.on("response", response_seen)
        try:
            response = await asyncio.wait_for(
                page.goto(url, wait_until="domcontentloaded", timeout=self.request.limits.navigationTimeoutMs),
                timeout=self.request.limits.pageTimeoutMs / 1000,
            )
            result.status = response.status if response else None
            try:
                final = normalize_url(page.url)
                if origin_of(final) in self.policy.origins:
                    result.final_url = safe_url(final)
            except PolicyError:
                pass
            result.title = safe_text(await page.title(), 500)
            result.links = await page.locator("a[href]").evaluate_all(
                "els => els.filter(e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden').map((e,i) => ({url:e.href,text:(e.textContent||'').trim().slice(0,200),locator:'a[href] index '+i})).slice(0,1000)"
            )
            if result.status is not None and result.status < 400:
                for viewport in VIEWPORTS:
                    try:
                        # 1. Interactive Exploration Agent (dismiss banners, expand mobile nav, scroll)
                        interaction_res = await explore_page_interactions(page, url, viewport, emitter=self.emitter)
                        for rev_link in interaction_res.get("revealed_links", []):
                            result.links.append({"url": rev_link, "text": "Discovered via interaction", "locator": "dynamic interaction"})

                        # 2. Run Deterministic DOM Checks
                        findings, screenshot = await run_dom_checks(page, url, viewport)
                        result.findings.extend(findings)
                        if screenshot:
                            result.screenshots.append((viewport, screenshot))
                            # 3. Multimodal Visual Agent Audit on Rendered Screenshot
                            try:
                                raw_bytes = base64.b64decode(screenshot["artifact_base64"])
                                visual_findings = await run_visual_audit(page, url, viewport, raw_bytes, emitter=self.emitter)
                                result.findings.extend(visual_findings)
                            except Exception as v_err:
                                sys.stderr.write(f"Visual audit skipped: {safe_text(str(v_err), 150)}\n")
                    except Exception as error:
                        self.complete = False
                        self.limitations.append(f"Checks incomplete for {safe_url(url)} ({viewport}): {safe_text(str(error), 180)}")
            elif result.status is not None:
                for viewport, (width, height) in VIEWPORTS.items():
                    await page.set_viewport_size({"width": width, "height": height})
                    image = await page.screenshot(type="jpeg", quality=40, full_page=True, timeout=10_000)
                    shot = screenshot_proof(image, viewport, width, height)
                    if shot:
                        result.screenshots.append((viewport, shot))
        except Exception as error:
            result.limitation = safe_text(str(error), 300)
            result.failed_requests.append({"url": safe_url(url)[:2048], "error": result.limitation})
        finally:
            result.timing_ms = max(0, int((time.monotonic() - started) * 1000))
            await page.close()
        return result

    async def run(self) -> None:
        base = await self.policy.validate(self.request.base_url)
        self.emitter.event("crawl", "info", "Crawl started", "crawl-start", {"baseUrl": safe_url(base)})
        pending = deque([(base, 0)])
        seen = {base}
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True, args=["--disable-background-networking", "--disable-features=Prerender2"])
            self.emitter.event("runtime", "info", "Browser ready", "browser-ready", {"browserVersion": browser.version, "checkVersion": CHECK_VERSION})
            context = await browser.new_context(viewport={"width": 1440, "height": 900},
                                                service_workers="block", accept_downloads=False)
            await context.route("**/*", self.guard)
            await context.route_web_socket("**/*", self.block_websocket)
            try:
                while pending and len(self.visited) < self.request.limits.maxPages:
                    batch: list[tuple[str, int]] = []
                    while pending and len(batch) < self.request.limits.concurrency and len(self.visited) + len(batch) < self.request.limits.maxPages:
                        url, depth = pending.popleft()
                        try:
                            await self.policy.validate(url)
                        except PolicyError as error:
                            self.skip(url, str(error))
                            continue
                        robots = await self.robots_for(origin_of(url), context)
                        if robots is None:
                            self.skip(url, "robots.txt could not be verified")
                            continue
                        if not robots.can_fetch("WebOpsAgent", url):
                            self.skip(url, "Disallowed by robots.txt")
                            continue
                        batch.append((url, depth))
                    if not batch:
                        continue
                    results = await asyncio.gather(*(self.inspect(context, url, depth) for url, depth in batch))
                    new_pending_links: list[tuple[str, int, str]] = []
                    for result in results:
                        self.visited.append(safe_url(result.url))
                        self.results[result.url] = result
                        if result.status is None or result.status >= 400:
                            self.failed_count += 1
                        if result.limitation:
                            self.complete = False
                            self.limitations.append(f"Could not fully inspect {safe_url(result.url)}: {result.limitation}")
                        self.emitter.send("page", key("page", result.url), {
                            "normalized_url": safe_url(result.url), "final_url": result.final_url,
                            "depth": result.depth, "http_status": result.status, "title": result.title,
                            "timing_ms": result.timing_ms, "visited_at": result.visited_at,
                            "console_messages": result.console[:100], "failed_requests": result.failed_requests[:100],
                        })
                        for viewport, shot in result.screenshots:
                            self.emitter.send("candidate", key("screenshot", result.url + viewport), {
                                "page_url": safe_url(result.url), "viewport": viewport,
                                "artifact_base64": shot["artifact_base64"], "mime_type": "image/jpeg",
                                "width": VIEWPORTS[viewport][0], "height": VIEWPORTS[viewport][1]})
                        for item in result.findings:
                            self.send_finding(key("finding", result.url + item["rule_id"] + item["target"] + str(item["facts"].get("viewport"))), item)
                        self.emit_page_findings(result)
                        if result.depth == 0 and self.context_info is None:
                            self.context_info = classify_site_context(result.url, result.title, links=result.links)
                            confidence_pct = int(self.context_info["confidence"] * 100)
                            if self.context_info["archetype"] == "personal_portfolio":
                                self.emitter.event(
                                    "taxonomy", "info",
                                    f"[Taxonomy Classifier] Identified site as 'Personal Portfolio / Resume' (Confidence: {confidence_pct}%).",
                                    key("agent:tax", result.url),
                                    {
                                        "archetype": "personal_portfolio",
                                        "confidence": self.context_info["confidence"],
                                        "signals": self.context_info.get("detected_signals", []),
                                    },
                                )
                            elif self.context_info["is_product_or_service"]:
                                self.emitter.event(
                                    "taxonomy", "info",
                                    f"[Taxonomy Classifier] Classified site as '{self.context_info['category_label']}' (Confidence: {confidence_pct}%).",
                                    key("agent:tax", result.url),
                                    {
                                        "archetype": self.context_info["archetype"],
                                        "confidence": self.context_info["confidence"],
                                        "category": self.context_info["category_label"],
                                    },
                                )
                        for link_item in result.links:
                            raw_link = link_item["url"]
                            try:
                                link = normalize_url(raw_link, result.final_url or result.url)
                                await self.policy.validate(link)
                            except PolicyError as error:
                                self.skip(raw_link, str(error))
                                continue
                            if link in seen:
                                continue
                            seen.add(link)
                            if result.depth >= self.request.limits.maxDepth:
                                self.skip(link, "Depth limit")
                                self.complete = False
                            else:
                                new_pending_links.append((link, result.depth + 1, safe_text(link_item.get("text", ""), 100)))
                                self.emitter.event("crawl", "debug", f"Discovered {safe_url(link)}", key("discover", link),
                                                   {"source": safe_url(result.url), "destination": safe_url(link)})
                    if new_pending_links:
                        all_pending = [(item[0], item[1], "") for item in pending] + new_pending_links
                        ranked = prioritize_links(all_pending, self.request.limits.maxPages - len(self.visited))
                        pending = deque([(url, depth) for url, depth, _ in ranked])
                        top_route = pending[0][0] if pending else ""
                        self.emitter.event(
                            "agent:navigation", "info",
                            f"[Navigation Agent] Prioritized {len(pending)} pending routes. Next target: {safe_url(top_route)}",
                            key("agent:nav", top_route + str(len(pending))),
                            {"nextTarget": safe_url(top_route), "queueSize": len(pending)},
                        )
                if pending:
                    self.complete = False
                    for url, _ in pending:
                        self.skip(url, "Page budget reached")
                self.emit_broken_links()
            finally:
                await context.close()
                await browser.close()
        self.emitter.send("done", "done", {"visited_urls": self.visited[:100], "skipped": self.skipped[:500],
                                           "failed_count": self.failed_count, "limitations": self.limitations[:100],
                                           "complete": self.complete})

    def emit_page_findings(self, result: PageResult) -> None:
        url = safe_url(result.url)
        if (result.status is None and result.limitation and "blockedbyclient" not in result.limitation) or (result.status is not None and result.status >= 400):
            observed = f"Navigation to {url} returned HTTP {result.status}." if result.status is not None else f"Navigation to {url} failed: {result.limitation}."
            item = finding(result.url, "HTTP_PAGE_ERROR", "page", "Page request failed", "P1", observed,
                "Visitors cannot access this page reliably.", [f"Open {url} in a browser.", "Inspect the response or navigation error."],
                "Restore the page or fix the link and server response.",
                [{"kind": "url", "locator": None, "payload": {"v": 1, "sourceUrl": url, "finalUrl": result.final_url,
                   "status": result.status, "error": result.limitation, "capturedAt": result.visited_at}}],
                {"url": url, "status": result.status, "error": result.limitation})
            self.send_finding(key("finding", result.url + "HTTP_PAGE_ERROR"), item)
        errors = sorted({message for message in result.console if message.startswith(("error:", "pageerror:"))
                         and "Failed to load resource" not in message})
        if errors:
            item = finding(result.url, "JS_CONSOLE_ERROR", "console", "JavaScript console error", "P1",
                f"The page emitted {len(errors)} JavaScript error(s): {errors[0]}",
                "A repeatable script error can break page behavior.", [f"Open {url}.", "Inspect the browser console."],
                "Fix the script failure and verify the console is clear.",
                [{"kind": "console", "locator": None, "payload": {"v": 1, "url": url, "messages": errors[:20]}}],
                {"url": url, "messages": errors[:20]})
            self.send_finding(key("finding", result.url + "JS_CONSOLE_ERROR"), item)
        unique_network = {(item["method"], item["url"]): item for item in result.network_events}
        for (method, destination), network in unique_network.items():
            item = finding(result.url, "FAILED_FIRST_PARTY_REQUEST", method + " " + destination,
                "First-party request failed", "P2", f"{method} {destination} failed: {network['error']}.",
                "A first-party resource or API request did not complete successfully.",
                [f"Open {url}.", f"Inspect the {method} request to {destination}."],
                "Fix the failing first-party endpoint or resource reference.",
                [{"kind": "network", "locator": None, "payload": {"v": 1, "sourceUrl": url,
                  "method": method, "url": destination, "status": network.get("status"), "failure": network["error"]}}],
                {"url": url, "method": method, "destination": destination, "failure": network["error"]})
            self.send_finding(key("finding", result.url + "FAILED_FIRST_PARTY_REQUEST" + method + destination), item)

    def emit_broken_links(self) -> None:
        for source in self.results.values():
            for link in source.links:
                try:
                    destination = normalize_url(link["url"], source.final_url or source.url)
                except PolicyError:
                    continue
                target = self.results.get(destination)
                if not target or (target.status is not None and target.status < 400):
                    continue
                if target.status is None and target.limitation and "blockedbyclient" in target.limitation:
                    continue
                dest_safe = safe_url(destination)
                source_safe = safe_url(source.url)
                observed = f"Visible link '{safe_text(link['text'], 200)}' on {source_safe} points to {dest_safe}, which returned HTTP {target.status}." if target.status is not None else f"Visible link on {source_safe} points to {dest_safe}, which failed to load."
                item = finding(source.url, "BROKEN_INTERNAL_LINK", dest_safe, "Broken internal link", "P1",
                    observed, "Visitors following this link reach an error instead of the intended content.",
                    [f"Open {source_safe}.", f"Activate the link to {dest_safe}."],
                    "Update the link destination or restore the target page.",
                    [{"kind": "dom", "locator": link["locator"], "payload": {"v": 1, "anchorText": safe_text(link["text"], 200), "sourceUrl": source_safe}},
                     {"kind": "url", "locator": link["locator"], "payload": {"v": 1, "sourceUrl": source_safe,
                      "destinationUrl": dest_safe, "finalUrl": target.final_url, "status": target.status,
                      "error": target.limitation, "capturedAt": target.visited_at}}],
                    {"url": source_safe, "destination": dest_safe, "status": target.status})
                self.send_finding(key("finding", source.url + "BROKEN_INTERNAL_LINK" + destination), item)



async def main() -> None:
    raw = sys.stdin.buffer.readline(65_537)
    if not raw or len(raw) > 65_536:
        raise ValueError("Missing or oversized scanner input")
    request = ScanInput.model_validate_json(raw)
    crawler = Crawler(request)
    try:
        await asyncio.wait_for(crawler.run(), timeout=max(1, request.limits.scanTimeoutMs / 1000 - 2))
    except asyncio.TimeoutError:
        crawler.complete = False
        crawler.limitations.append("Scan time limit reached")
        crawler.emitter.send("done", "done", {"visited_urls": crawler.visited[:100], "skipped": crawler.skipped[:500],
                                               "failed_count": crawler.failed_count, "limitations": crawler.limitations[:100],
                                               "complete": False})


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(f"scanner failed: {safe_text(str(exc), 500)}", file=sys.stderr)
        raise SystemExit(1)
