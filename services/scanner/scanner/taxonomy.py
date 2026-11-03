"""Autonomous Site Taxonomy Classifier.

Extracts business and technical context from the audited page, identifies the
site archetype (e.g. Personal Portfolio vs. Commercial Platform), and calculates a
mathematical confidence score.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit


CATEGORY_DEFINITIONS: dict[str, str] = {
    "developer_tools": "Developer Tools & Infrastructure",
    "saas_productivity": "B2B SaaS & Productivity Platform",
    "ecommerce": "E-Commerce & Digital Commerce",
    "general_web": "Modern Web & Digital Services",
}

PORTFOLIO_KEYWORDS = [
    "portfolio", "resume", "curriculum vitae", "cv", "about me", "my work", "projects",
    "personal website", "software engineer", "frontend engineer", "full stack",
    "product designer", "ui/ux designer", "developer portfolio", "student", "freelance",
    "case study", "side projects", "contact me", "get in touch", "my blog",
]

COMMERCIAL_KEYWORDS = [
    "pricing", "plans", "sign in", "sign up", "start free trial", "book a demo",
    "request demo", "add to cart", "checkout", "trusted by", "customers", "solutions",
    "platform", "enterprise", "soc2", "privacy policy", "terms of service", "api documentation",
]


def classify_site_context(
    url: str,
    title: str | None,
    text_sample: str = "",
    links: list[dict[str, str]] | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Identify site archetype and calculate confidence score."""
    combined = f"{url} {title or ''} {text_sample}".lower()
    nav_texts = " ".join(item.get("text", "").lower() for item in (links or []))
    combined_with_nav = f"{combined} {nav_texts}"

    parsed = urlsplit(url)
    domain = parsed.hostname or url

    # 1. Evaluate Portfolio Signals
    portfolio_signals = []
    portfolio_score = 0.0

    if any(k in combined for k in ["portfolio", "resume", "cv"]):
        portfolio_signals.append("keyword:portfolio_resume")
        portfolio_score += 0.40
    if re.search(r"\b(i am|i'm|my work|about me|hi, i'm)\b", combined):
        portfolio_signals.append("syntax:first_person_copy")
        portfolio_score += 0.30
    if any(k in nav_texts for k in ["resume", "cv", "projects", "about", "skills", "experience"]):
        portfolio_signals.append("nav:portfolio_sections")
        portfolio_score += 0.25
    if any(k in combined_with_nav for k in ["github.com/", "dribbble.com/", "behance.net/", "readcv", "linkedin.com/in/"]):
        portfolio_signals.append("links:personal_socials")
        portfolio_score += 0.20

    # 2. Evaluate Commercial Signals
    commercial_signals = []
    commercial_score = 0.0

    if any(k in combined_with_nav for k in ["pricing", "plans", "/pricing", "billing"]):
        commercial_signals.append("nav:pricing_page")
        commercial_score += 0.45
    if any(k in combined for k in ["start free trial", "book a demo", "get started", "request a demo", "sign up free"]):
        commercial_signals.append("cta:commercial_trial")
        commercial_score += 0.35
    if any(k in combined for k in ["trusted by", "customers", "partners", "integrations"]):
        commercial_signals.append("social_proof:enterprise")
        commercial_score += 0.20
    if any(k in combined for k in ["platform", "solution", "enterprise", "teams", "soc2", "gdpr"]):
        commercial_signals.append("copy:b2b_saas")
        commercial_score += 0.20

    # 3. Archetype Decision & Confidence Calculation
    if portfolio_score > commercial_score and portfolio_score >= 0.40:
        confidence = min(0.98, max(0.72, portfolio_score))
        return {
            "archetype": "personal_portfolio",
            "is_product_or_service": False,
            "confidence": round(confidence, 2),
            "category_label": "Personal Portfolio & Resume",
            "target_domain": domain,
            "target_url": url,
            "detected_signals": portfolio_signals,
            "reasoning": f"Identified as Personal Portfolio (Confidence: {int(confidence * 100)}%).",
        }

    # Commercial Product / Service
    confidence = min(0.98, max(0.70, commercial_score if commercial_score > 0 else 0.75))

    if any(k in combined for k in ["api", "dev", "code", "ops", "cloud", "infra", "deploy", "git", "monitor", "test", "fixture"]):
        category = "developer_tools"
    elif any(k in combined for k in ["shop", "store", "cart", "buy", "product", "price", "checkout"]):
        category = "ecommerce"
    elif any(k in combined for k in ["app", "workspace", "task", "project", "crm", "workflow", "manage", "team"]):
        category = "saas_productivity"
    else:
        category = "general_web"

    category_label = CATEGORY_DEFINITIONS[category]

    return {
        "archetype": "commercial_product",
        "is_product_or_service": True,
        "confidence": round(confidence, 2),
        "category_key": category,
        "category_label": category_label,
        "target_domain": domain,
        "target_url": url,
        "detected_signals": commercial_signals or ["default_commercial_baseline"],
        "reasoning": f"Classified as {category_label} (Confidence: {int(confidence * 100)}%).",
    }
