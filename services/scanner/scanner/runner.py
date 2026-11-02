"""Single-job, bounded Playwright crawler. Stdout is protocol JSON only."""

from __future__ import annotations

import asyncio
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
                                pending.append((link, result.depth + 1))
                                self.emitter.event("crawl", "debug", f"Discovered {safe_url(link)}", key("discover", link),
                                                   {"source": safe_url(result.url), "destination": safe_url(link)})
                if pending:
                    self.complete = False
                    for url, _ in pending:
                        self.skip(url, "Page budget reached")
            finally:
                await context.close()
                await browser.close()
        self.emitter.send("done", "done", {"visited_urls": self.visited[:100], "skipped": self.skipped[:500],
                                           "failed_count": self.failed_count, "limitations": self.limitations[:100],
                                           "complete": self.complete})

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
