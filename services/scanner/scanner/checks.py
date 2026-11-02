"""Deterministic browser checks. Only fixed scanner code executes in pages."""

from __future__ import annotations

import base64
import re
from typing import Any

from playwright.async_api import Page

from .policy import safe_text, safe_url

CHECK_VERSION = "1"
VIEWPORTS = {"desktop": (1440, 900), "mobile": (375, 812)}
LOCATOR_JS = """el => { let p=[]; for(let n=el;n&&n.nodeType===1&&n.tagName!=='HTML';n=n.parentElement){let i=1;for(let s=n.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===n.tagName)i++;p.unshift(n.tagName.toLowerCase()+':nth-of-type('+i+')');if(n.tagName==='BODY')break;}return p.join(' > '); }"""


def screenshot_proof(image: bytes, viewport: str, width: int, height: int,
                     locator: str | None = None, box: dict | None = None) -> dict | None:
    encoded = base64.b64encode(image).decode("ascii")
    if len(encoded) > 700_000:
        return None
    return {"kind": "screenshot", "locator": locator,
            "payload": {"v": 1, "viewport": viewport, "width": width, "height": height,
                        "boundingBox": box},
            "artifact_base64": encoded, "mime_type": "image/jpeg"}


def sanitized_html(raw: str) -> str:
    text = re.sub(r"(?is)\s(?:value|srcdoc|on[a-z]+)\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+)", "", raw)
    text = re.sub(r"(?is)\s(?:href|src|action)\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+)", "", text)
    return safe_text(text, 1200)


def finding(url: str, rule: str, target: str, title: str, priority: str,
            observed: str, impact: str, steps: list[str], fix: str,
            evidence: list[dict], facts: dict[str, Any], confidence: float = 1) -> dict:
    return {"page_url": safe_url(url), "rule_id": rule, "rule_version": CHECK_VERSION,
            "target": target, "title": title, "description": observed,
            "priority": priority, "confidence": confidence, "observed": observed,
            "impact": impact, "reproduction_steps": steps, "suggested_fix": fix,
            "facts": {"v": 1, **facts}, "evidence": evidence}


async def run_dom_checks(page: Page, url: str, viewport: str) -> tuple[list[dict], dict | None]:
    width, height = VIEWPORTS[viewport]
    await page.set_viewport_size({"width": width, "height": height})
    results: list[dict] = []
    full = await page.screenshot(type="jpeg", quality=40, full_page=True, timeout=10_000)
    page_shot = screenshot_proof(full, viewport, width, height)

    for element in await page.locator("img:not([alt])").all():
        if not await element.is_visible():
            continue
        locator = await element.evaluate(LOCATOR_JS)
        excerpt = sanitized_html(await element.evaluate("el => el.outerHTML"))
        box = await element.bounding_box()
        image = await element.screenshot(type="jpeg", quality=40, timeout=10_000)
        shot = screenshot_proof(image, viewport, width, height, locator, box)
        if not shot:
            continue
        results.append(finding(url, "MISSING_IMAGE_ALT", locator, "Image missing alt text", "P2",
            f"Visible image at {locator} has no alt attribute in the {viewport} viewport.",
            "Screen reader users cannot identify the image's content or purpose.",
            [f"Open {safe_url(url)} at {width}×{height}.", f"Inspect the image at {locator}."],
            "Add meaningful alt text, or alt=\"\" if the image is purely decorative.",
            [{"kind": "dom", "locator": locator, "payload": {"v": 1, "excerpt": excerpt, "viewport": viewport}}, shot],
            {"url": safe_url(url), "locator": locator, "viewport": viewport}))

    for element in await page.locator("input, select, textarea").all():
        if not await element.is_visible():
            continue
        unnamed = await element.evaluate("""el => {
          const type=(el.getAttribute('type')||'').toLowerCase();
          if(['hidden','submit','button','reset','image'].includes(type)) return false;
          const ids=(el.getAttribute('aria-labelledby')||'').trim().split(/\\s+/).filter(Boolean);
          return !((el.getAttribute('aria-label')||'').trim() || (el.getAttribute('title')||'').trim() ||
            (el.labels&&el.labels.length) || ids.some(id => (document.getElementById(id)?.textContent||'').trim()));
        }""")
        if not unnamed:
            continue
        locator = await element.evaluate(LOCATOR_JS)
        excerpt = sanitized_html(await element.evaluate("el => el.outerHTML"))
        box = await element.bounding_box()
        image = await element.screenshot(type="jpeg", quality=40, timeout=10_000)
        shot = screenshot_proof(image, viewport, width, height, locator, box)
        if not shot:
            continue
        results.append(finding(url, "UNLABELED_FORM_CONTROL", locator, "Form control has no accessible name", "P2",
            f"Visible control at {locator} has no associated label or accessible name in the {viewport} viewport.",
            "Assistive technology users may not know what information the control expects.",
            [f"Open {safe_url(url)} at {width}×{height}.", f"Focus the control at {locator}."],
            "Associate a visible label with the control or provide an accurate aria-label.",
            [{"kind": "dom", "locator": locator, "payload": {"v": 1, "excerpt": excerpt, "viewport": viewport}}, shot],
            {"url": safe_url(url), "locator": locator, "viewport": viewport}))

    title = await page.title()
    if not title.strip():
        head = await page.locator("head").evaluate(
            "el => '<head>'+Array.from(el.children).map(n => '<'+n.tagName.toLowerCase()+'>').join('')+'</head>'")
        results.append(finding(url, "MISSING_PAGE_TITLE", "head>title", "Page title is missing", "P3",
            f"The HTML page has no nonblank title in the {viewport} viewport.",
            "Browser tabs, search results, and assistive technology lack a useful page name.",
            [f"Open {safe_url(url)}.", "Inspect the document title."],
            "Add a concise, descriptive title element to the document head.",
            [{"kind": "dom", "locator": "head", "payload": {"v": 1, "excerpt": sanitized_html(head), "viewport": viewport}}],
            {"url": safe_url(url), "viewport": viewport}))

    measured = await page.evaluate("() => ({documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth})")
    if measured["documentWidth"] > measured["viewportWidth"] + 8 and page_shot:
        results.append(finding(url, "HORIZONTAL_OVERFLOW", "document", "Page overflows horizontally", "P2",
            f"Document width {measured['documentWidth']}px exceeds the {viewport} viewport width {measured['viewportWidth']}px by more than 8px.",
            "Content can be clipped or require horizontal scrolling.",
            [f"Open {safe_url(url)} at {width}×{height}.", "Compare document scrollWidth with viewport innerWidth."],
            "Make wide content responsive and constrain fixed-width elements.",
            [page_shot], {"url": safe_url(url), "viewport": viewport, **measured}))
    return results, page_shot
