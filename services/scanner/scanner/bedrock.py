"""Amazon Bedrock client for AI-enriched finding explanations and role-specific remediation.

Uses Anthropic Claude 3.5 Sonnet or Amazon Nova on AWS Bedrock.
Falls back safely to deterministic rule explanations on error, timeout, or missing credentials.
Supports Persona-Targeted Triage (UI/UX Designer, Frontend Engineer, Backend SRE, Content Strategist).
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

from .policy import safe_text


def get_bedrock_client(region: str | None = None) -> Any:
    """Initialize boto3 bedrock-runtime client."""
    try:
        import boto3
        target_region = region or os.getenv("AWS_BEDROCK_REGION") or os.getenv("AWS_REGION") or "ap-south-1"
        return boto3.client("bedrock-runtime", region_name=target_region)
    except Exception as exc:
        sys.stderr.write(f"Bedrock client initialization skipped: {safe_text(str(exc), 200)}\n")
        return None


def classify_persona(rule_id: str, facts: dict[str, Any] | None = None) -> str:
    """Determine target persona discipline from rule ID and observed facts."""
    facts = facts or {}
    if rule_id in (
        "HORIZONTAL_OVERFLOW",
        "CONTRAST_DEFECT",
        "VISUAL_OVERLAP_CLIPPING",
        "UX_CONVERSION_FRICTION",
    ):
        return "ui_ux"
    if rule_id in ("FAILED_FIRST_PARTY_REQUEST", "SLOW_TTFB") or (
        rule_id == "HTTP_PAGE_ERROR"
        and (facts.get("status") is None or int(facts.get("status", 0)) >= 500)
    ):
        return "backend"
    if rule_id in ("MISSING_PAGE_TITLE", "MISSING_IMAGE_ALT"):
        return "content_seo"
    return "frontend"


def build_persona_prompt(
    finding: dict[str, Any],
    available_evidence_ids: list[str],
    persona: str,
) -> str:
    """Construct role-tailored prompt for Amazon Bedrock based on target persona."""
    rule_id = finding.get("rule_id", "GENERAL_DEFECT")
    page_url = finding.get("page_url", "https://example.com")
    target = finding.get("target", "element")
    observed = finding.get("observed", "Defect observed")
    evidence_str = ", ".join(available_evidence_ids) if available_evidence_ids else "None"

    if persona == "ui_ux":
        role_instructions = """You are a Principal Product Designer and Design Systems Architect.
Analyze the following visual/layout finding and provide:
1. UX Impact: Explain the visual hierarchy defect and user cognitive friction.
2. WCAG / Design System Tokens: Provide exact mathematical adjustments (e.g. shift color hex from #ABC to #XYZ to reach WCAG 2.1 AA 4.5:1 ratio).
3. Mobile Viewport Guidance: Specify concrete responsive CSS/layout recommendations (flex-wrap, padding, max-width constraints).
Do not include backend code, SQL, or raw network headers."""

    elif persona == "backend":
        role_instructions = """You are a Staff Site Reliability Engineer and Backend Architect.
Analyze the following network/server finding and provide:
1. Impact on Microservices: Explain the blast radius and user journey failure.
2. Reproduction cURL: Provide an exact, sanitized cURL command to trigger the failure outside the browser.
3. Root Cause Hypothesis: Suggest controller, database connection, or schema validation failure points.
4. Remediation Patch: Outline the backend API fix (HTTP status codes, idempotency, or error payload structure).
Do not discuss color schemes, fonts, or CSS layout tokens."""

    elif persona == "content_seo":
        role_instructions = """You are a Principal Content Strategist and SEO Specialist.
Analyze the following content or metadata finding and provide:
1. SEO & Accessibility Impact: Explain search indexing penalties and screen reader user friction.
2. Concrete Meta Copy / Alt Text Fix: Provide exact, recommended nonblank title, description, or descriptive alt text.
3. Editorial Checklist: Concrete guidelines for content authors."""

    elif persona == "frontend":  # frontend
        role_instructions = """You are a Principal Frontend Engineer.
Analyze the following client-side DOM or script finding and provide:
1. Browser Behavior: Explain how this breaks user interaction or form submission.
2. Exact DOM Locator: Specify CSS selector and HTML excerpt.
3. Component Patch: Provide a concrete React/HTML code snippet showing the fix."""

    return f"""{role_instructions}

Detected Issue Details:
- Rule ID: {rule_id}
- Affected Page: {page_url}
- Target: {target}
- Observed Fact: {observed}
- Available Cryptographic Evidence IDs: {evidence_str}

Respond in valid JSON only with the following structure:
{{
  "summary": "1-2 sentence precise technical explanation tailored for {persona}",
  "impact": "1-2 sentence impact assessment tailored for {persona}",
  "suggested_fix": "Clear, actionable remediation guidance tailored for {persona}",
  "code_or_token_snippet": "Exact code, token, or cURL command snippet (or empty string)",
  "cited_evidence_ids": ["list of evidence IDs cited from the available list above"]
}}
"""


def explain_finding_with_bedrock(
    finding: dict[str, Any],
    available_evidence_ids: list[str],
    model_id: str | None = None,
    region: str | None = None,
    target_persona: str | None = None,
) -> dict[str, Any] | None:
    """Generate root-cause explanation and suggested fix via AWS Bedrock Converse API.

    Returns dict with summary, impact, suggested_fix, code_or_token_snippet, and cited_evidence_ids,
    or None on failure (triggering deterministic fallback).
    """
    client = get_bedrock_client(region)
    if not client:
        return None

    persona = target_persona or classify_persona(
        finding.get("rule_id", ""),
        finding.get("facts", {}),
    )

    active_model = (
        model_id
        or os.getenv("BEDROCK_MODEL_ID")
        or "apac.amazon.nova-lite-v1:0"
    )

    prompt = build_persona_prompt(finding, available_evidence_ids, persona)

    try:
        response = client.converse(
            modelId=active_model,
            messages=[
                {
                    "role": "user",
                    "content": [{"text": prompt}],
                }
            ],
            inferenceConfig={
                "maxTokens": 800,
                "temperature": 0.2,
            },
        )
        content = response.get("output", {}).get("message", {}).get("content", [])
        raw_text = content[0].get("text", "") if content else ""

        # Parse JSON from response, stripping markdown fences if present
        clean_text = raw_text.strip()
        if clean_text.startswith("```"):
            clean_text = clean_text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        data = json.loads(clean_text)
        return {
            "summary": safe_text(data.get("summary", ""), 2000),
            "impact": safe_text(data.get("impact", ""), 2000),
            "suggested_fix": safe_text(data.get("suggested_fix", ""), 2000),
            "code_or_token_snippet": safe_text(data.get("code_or_token_snippet", ""), 4000),
            "cited_evidence_ids": [str(eid) for eid in data.get("cited_evidence_ids", [])],
            "target_persona": persona,
        }
    except Exception as exc:
        sys.stderr.write(
            f"Bedrock explanation generation failed ({safe_text(str(exc), 200)}); falling back to deterministic template.\n"
        )
        return None
