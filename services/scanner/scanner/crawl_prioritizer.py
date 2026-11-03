"""Reasoning-driven Crawl Navigation & Priority Queue.

Ranks discovered links based on business impact, conversion risk, and audit importance
so that the limited page budget audits revenue-critical, authentication, and core product
flows first, rather than wasting budget on legal boilerplate and terms pages.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit

from .policy import safe_url


HIGH_PRIORITY_PATTERNS = [
    r"/(pricing|plans|buy|checkout|cart|subscribe|billing)",
    r"/(signup|register|login|signin|auth|account)",
    r"/(product|features|solutions|demo|app)",
    r"/(contact|support|help|quote)",
]

LOW_PRIORITY_PATTERNS = [
    r"/(terms|privacy|legal|cookies|disclaimer|compliance)",
    r"/(press|news|changelog|releases|media)",
    r"/(careers|jobs|internships|positions)",
]


def score_link_priority(url: str, anchor_text: str = "") -> int:
    """Calculate audit priority score: 1 (Highest) to 5 (Lowest)."""
    normalized = f"{urlsplit(url).path.lower()} {anchor_text.lower()}"

    for pattern in HIGH_PRIORITY_PATTERNS:
        if re.search(pattern, normalized):
            return 1  # Revenue / Auth / Core Product

    if any(k in normalized for k in ["docs", "documentation", "api", "guide", "faq"]):
        return 2  # Product Documentation & API

    if any(k in normalized for k in ["about", "story", "team", "blog", "projects", "work"]):
        return 3  # General Content & Showcase

    for pattern in LOW_PRIORITY_PATTERNS:
        if re.search(pattern, normalized):
            return 5  # Boilerplate / Legal

    return 3  # Default middle priority


def prioritize_links(
    links: list[tuple[str, int, str]],
    remaining_budget: int,
) -> list[tuple[str, int, str]]:
    """Sort pending link tuples (url, depth, anchor_text) by audit priority."""
    return sorted(links, key=lambda item: (score_link_priority(item[0], item[2]), item[1]))
