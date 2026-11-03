"""Multimodal Visual Perception Agent for rendered page inspection.

Analyzes full rendered screenshots with AWS Bedrock Multimodal Vision
(Claude 3.5 Sonnet / Amazon Nova) and browser-rendered DOM collision heuristics
to detect visual clipping, unreadable contrast over dynamic backgrounds,
broken visual states, and UX conversion friction.
"""

from __future__ import annotations

import base64
import json
import os
import sys
from typing import Any

from playwright.async_api import Page

from .bedrock import get_bedrock_client
from .checks import VIEWPORTS, finding, screenshot_proof
from .policy import safe_text, safe_url


VISUAL_PROMPT = """You are an autonomous WebOps visual auditor. You are examining a rendered {viewport} viewport screenshot of: {url}.

Audit this rendered visual layout for real-world visual defects:
1. "VISUAL_OVERLAP_CLIPPING": Elements visually collide, obscure typography, or truncate key action buttons/labels.
2. "CONTRAST_DEFECT": Text is unreadable or fails contrast over dynamic gradients, complex hero images, or dark patterns.
3. "BROKEN_VISUAL_STATE": Stuck loading spinners, unresolved skeleton screens, or blank broken component placeholders.
4. "UX_CONVERSION_FRICTION": Primary call-to-action is visually buried, obstructed, or pushed into an awkward layout.

Respond ONLY with genuine issues visible in this screenshot. If the visual layout looks clean, return an empty list.
Output strict JSON with this exact schema:
[
  {{
    "rule_id": "VISUAL_OVERLAP_CLIPPING" | "CONTRAST_DEFECT" | "BROKEN_VISUAL_STATE" | "UX_CONVERSION_FRICTION",
    "title": "Short descriptive title (max 80 chars)",
    "priority": "P1" | "P2" | "P3",
    "target": "Specific visual area (e.g. Hero CTA button, Navigation Header, Feature Card)",
    "observed": "Exact visual observation in 1-2 sentences",
    "impact": "Why this hurts user experience, conversion, or accessibility in 1 sentence",
    "suggested_fix": "Clear action for designers/developers to fix this visual defect"
  }}
]
"""


async def run_visual_audit(
    page: Page,
    url: str,
    viewport: str,
    screenshot_bytes: bytes,
    emitter: Any = None,
) -> list[dict]:
    """Run multimodal visual perception and layout collision checks."""
    width, height = VIEWPORTS[viewport]
    findings: list[dict] = []
    
    # Generate the base full screenshot proof
    full_shot = screenshot_proof(screenshot_bytes, viewport, width, height)
    if not full_shot:
        return findings

    # 1. Deterministic Layout Collision Heuristic (Fast local check)
    try:
        collisions = await page.evaluate(
            """() => {
                const results = [];
                const interactives = Array.from(document.querySelectorAll('button, a[href], input, [role="button"]'))
                    .filter(el => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
                    })
                    .slice(0, 30);

                for (const el of interactives) {
                    const rect = el.getBoundingClientRect();
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;
                    const topEl = document.elementFromPoint(centerX, centerY);
                    if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
                        const topStyle = window.getComputedStyle(topEl);
                        if (topStyle.pointerEvents !== 'none' && topStyle.visibility !== 'hidden' && topStyle.opacity !== '0') {
                            results.push({
                                target: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 50),
                                blocker: topEl.tagName.toLowerCase(),
                                box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
                            });
                        }
                    }
                }
                return results.slice(0, 2);
            }"""
        )
        for col in collisions:
            target_name = col.get("target") or "Interactive Element"
            observed = f"Element '{target_name}' is visually obscured by an overlapping <{col.get('blocker')}> layer on {viewport} viewport."
            item = finding(
                url=url,
                rule="VISUAL_OVERLAP_CLIPPING",
                target=f"{target_name} ({viewport})",
                title="Interactive control visually obscured by overlapping layer",
                priority="P1",
                observed=observed,
                impact="Visitors cannot click or interact with this control because another visual layer intercepts pointer events.",
                steps=[f"Open {safe_url(url)} in {viewport} mode.", f"Locate '{target_name}'.", "Attempt to click the element."],
                fix=f"Adjust the CSS z-index, pointer-events, or positioning of the overlapping <{col.get('blocker')}> container.",
                evidence=[full_shot],
                facts={"viewport": viewport, "boundingBox": col.get("box")},
                confidence=0.95,
            )
            findings.append(item)
            if emitter:
                emitter.event(
                    "agent:vision", "warn",
                    f"[Visual Agent] Detected visual collision: '{target_name}' obscured by <{col.get('blocker')}> on {viewport}",
                    f"vision-col-{viewport}-{target_name}",
                    {"viewport": viewport, "target": target_name},
                )
    except Exception as exc:
        sys.stderr.write(f"DOM collision heuristic skipped: {safe_text(str(exc), 200)}\n")

    # 2. AWS Bedrock Multimodal Vision Model (if configured)
    client = get_bedrock_client()
    if client and not findings:
        try:
            active_model = os.getenv("BEDROCK_MODEL_ID") or "anthropic.claude-3-5-sonnet-20241022-v2:0"
            if emitter:
                emitter.event(
                    "agent:vision", "info",
                    f"[Visual Agent] Inspecting rendered {viewport} frame via Multimodal Vision AI...",
                    f"vision-inspect-{viewport}",
                    {"viewport": viewport, "model": active_model},
                )

            response = client.converse(
                modelId=active_model,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "image": {
                                "format": "jpeg",
                                "source": {"bytes": screenshot_bytes},
                            }
                        },
                        {
                            "text": VISUAL_PROMPT.format(viewport=viewport, url=safe_url(url)),
                        },
                    ],
                }],
                inferenceConfig={"maxTokens": 1000, "temperature": 0.1},
            )

            content = response.get("output", {}).get("message", {}).get("content", [])
            raw_text = content[0].get("text", "") if content else ""
            clean_text = raw_text.strip()
            if clean_text.startswith("```"):
                clean_text = clean_text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

            parsed = json.loads(clean_text)
            if isinstance(parsed, list):
                for issue in parsed[:3]:  # Cap at 3 visual findings per viewport
                    rule = issue.get("rule_id")
                    if rule not in ["VISUAL_OVERLAP_CLIPPING", "CONTRAST_DEFECT", "BROKEN_VISUAL_STATE", "UX_CONVERSION_FRICTION"]:
                        continue
                    item = finding(
                        url=url,
                        rule=rule,
                        target=safe_text(issue.get("target") or "Viewport Layout", 200),
                        title=safe_text(issue.get("title") or "Visual Layout Anomaly", 150),
                        priority=issue.get("priority") if issue.get("priority") in ["P1", "P2", "P3"] else "P2",
                        observed=safe_text(issue.get("observed") or "Visual anomaly detected in screenshot.", 1000),
                        impact=safe_text(issue.get("impact") or "Impairs visual UX and customer confidence.", 500),
                        steps=[f"Open {safe_url(url)} in {viewport} viewport.", f"Inspect the {issue.get('target') or 'affected area'}."],
                        fix=safe_text(issue.get("suggested_fix") or "Adjust layout styles and verify visual rendering.", 500),
                        evidence=[full_shot],
                        facts={"viewport": viewport, "source": "bedrock_vision"},
                        confidence=0.88,
                    )
                    findings.append(item)
                    if emitter:
                        emitter.event(
                            "agent:vision", "info",
                            f"[Visual Agent] {issue.get('title')}: {safe_text(issue.get('observed') or '', 100)}",
                            f"vision-finding-{viewport}-{rule}",
                            {"rule": rule, "target": issue.get("target")},
                        )
        except Exception as exc:
            sys.stderr.write(f"Bedrock visual audit skipped: {safe_text(str(exc), 200)}\n")

    return findings
