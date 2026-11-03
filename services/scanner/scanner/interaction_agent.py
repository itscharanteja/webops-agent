"""Interactive Exploration Agent for dynamic page states.

Autonomously identifies and interacts with modern web UI states:
- Dismisses cookie consent banners and blocking overlays
- Expands collapsed mobile hamburger navigation menus to discover hidden links
- Scrolls below-the-fold to trigger lazy-loading and dynamic hydration

All actions are strictly non-destructive, bounded (max 3 actions per page),
and never submit forms or trigger irreversible actions.
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any

from playwright.async_api import Page

from .policy import safe_text, safe_url


COOKIE_DISMISS_SELECTORS = [
    "button:has-text('Accept all')",
    "button:has-text('Accept All')",
    "button:has-text('Accept Cookies')",
    "button:has-text('I accept')",
    "button:has-text('Allow all')",
    "button:has-text('Agree')",
    "button:has-text('Got it')",
    "button:has-text('Dismiss')",
    "button[id*='cookie' i][id*='accept' i]",
    "button[class*='cookie' i][class*='accept' i]",
]

MOBILE_MENU_SELECTORS = [
    "button[aria-label*='menu' i]",
    "button[aria-label*='navigation' i]",
    "button[aria-expanded='false']",
    "button.hamburger",
    "button.navbar-toggler",
    "[data-testid*='mobile-menu' i]",
]


async def explore_page_interactions(
    page: Page,
    url: str,
    viewport: str,
    emitter: Any = None,
) -> dict[str, Any]:
    """Execute bounded, safe dynamic interactions to reveal hidden UI states."""
    actions_taken: list[str] = []
    revealed_links: list[str] = []

    # 1. Cookie Consent Banner Dismissal
    for selector in COOKIE_DISMISS_SELECTORS:
        try:
            btn = page.locator(selector).first
            if await btn.is_visible(timeout=500):
                await btn.click(timeout=1000)
                await page.wait_for_timeout(300)
                action_msg = f"Dismissed cookie consent banner using '{selector}'"
                actions_taken.append(action_msg)
                if emitter:
                    emitter.event(
                        "agent:action", "info",
                        f"[Interaction Agent] {action_msg} — unblocked viewport",
                        f"act-cookie-{viewport}",
                        {"action": "dismiss_cookie", "selector": selector},
                    )
                break
        except Exception:
            continue

    # 2. Mobile Menu Expansion (Only on mobile viewport)
    if viewport == "mobile":
        for selector in MOBILE_MENU_SELECTORS:
            try:
                menu_btn = page.locator(selector).first
                if await menu_btn.is_visible(timeout=500):
                    await menu_btn.click(timeout=1000)
                    await page.wait_for_timeout(400)
                    action_msg = f"Expanded mobile navigation drawer using '{selector}'"
                    actions_taken.append(action_msg)
                    if emitter:
                        emitter.event(
                            "agent:action", "info",
                            f"[Interaction Agent] {action_msg} — revealing hidden routes",
                            f"act-menu-{viewport}",
                            {"action": "expand_mobile_menu", "selector": selector},
                        )

                    # Discover any newly revealed links
                    new_links = await page.locator("nav a[href], [role='navigation'] a[href]").evaluate_all(
                        "els => els.map(e => e.href).filter(Boolean)"
                    )
                    revealed_links.extend(new_links[:20])
                    break
            except Exception:
                continue

    # 3. Smooth Scroll to trigger lazy-loaded assets
    try:
        scrolled = await page.evaluate(
            """() => {
                if (document.body.scrollHeight > window.innerHeight * 1.5) {
                    window.scrollBy({ top: 800, behavior: 'instant' });
                    return true;
                }
                return false;
            }"""
        )
        if scrolled:
            await page.wait_for_timeout(400)
            actions_taken.append("Scrolled 800px to trigger lazy-loaded media and hydration")
            if emitter:
                emitter.event(
                    "agent:action", "info",
                    "[Interaction Agent] Scrolled viewport to trigger lazy-loaded media & dynamic state",
                    f"act-scroll-{viewport}",
                    {"action": "scroll_lazy_load"},
                )
            # Scroll back to top for visual audit consistency
            await page.evaluate("window.scrollTo(0, 0)")
            await page.wait_for_timeout(200)
    except Exception as exc:
        sys.stderr.write(f"Scroll exploration skipped: {safe_text(str(exc), 100)}\n")

    return {
        "actions_taken": actions_taken,
        "revealed_links": list(set(revealed_links)),
        "interaction_count": len(actions_taken),
    }
