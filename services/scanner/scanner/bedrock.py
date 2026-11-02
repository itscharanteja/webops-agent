"""Amazon Bedrock client for AI-enriched finding explanations and code fixes.

Uses Anthropic Claude 3.5 Sonnet or Amazon Nova on AWS Bedrock.
Falls back safely to deterministic rule explanations on error, timeout, or missing credentials.
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
        # Bedrock models are commonly accessed in us-east-1 or through cross-region inference profiles
        target_region = region or os.getenv("AWS_BEDROCK_REGION") or os.getenv("AWS_REGION") or "us-east-1"
        return boto3.client("bedrock-runtime", region_name=target_region)
    except Exception as exc:
        sys.stderr.write(f"Bedrock client initialization skipped: {safe_text(str(exc), 200)}\n")
        return None


def explain_finding_with_bedrock(
    finding: dict[str, Any],
    available_evidence_ids: list[str],
    model_id: str | None = None,
    region: str | None = None,
) -> dict[str, Any] | None:
    """Generate root-cause explanation and suggested fix via AWS Bedrock Converse API.

    Returns dict with summary, impact, suggested_fix, and cited_evidence_ids,
    or None on failure (triggering deterministic fallback).
    """
    client = get_bedrock_client(region)
    if not client:
        return None

    # Model ID can be Claude 3.5 Sonnet, Haiku, or Amazon Nova
    active_model = (
        model_id
        or os.getenv("BEDROCK_MODEL_ID")
        or "us.anthropic.claude-3-5-sonnet-20241022-v2:0"
    )

    prompt = f"""You are an autonomous WebOps auditor. A deterministic scan detected the following web issue:
- Rule ID: {finding.get('rule_id')}
- Affected Page: {finding.get('page_url')}
- Target: {finding.get('target')}
- Observed Fact: {finding.get('observed')}
- Available Evidence IDs: {', '.join(available_evidence_ids)}

Respond in valid JSON only with the following structure:
{{
  "summary": "1-2 sentence precise technical explanation of the root cause",
  "impact": "1-2 sentence real-world user or accessibility impact",
  "suggested_fix": "Clear, actionable fix with an exact code snippet or attribute change",
  "cited_evidence_ids": ["list of evidence IDs cited from the available list above"]
}}
"""

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
                "maxTokens": 600,
                "temperature": 0.2,
            },
        )
        content = response.get("output", {}).get("message", {}).get("content", [])
        raw_text = content[0].get("text", "") if content else ""
        
        # Parse JSON from response
        # Strip markdown fences if present
        clean_text = raw_text.strip()
        if clean_text.startswith("```"):
            clean_text = clean_text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        data = json.loads(clean_text)
        return {
            "summary": safe_text(data.get("summary", ""), 2000),
            "impact": safe_text(data.get("impact", ""), 2000),
            "suggested_fix": safe_text(data.get("suggested_fix", ""), 2000),
            "cited_evidence_ids": [str(eid) for eid in data.get("cited_evidence_ids", [])],
        }
    except Exception as exc:
        sys.stderr.write(f"Bedrock explanation generation failed ({safe_text(str(exc), 200)}); falling back to deterministic template.\n")
        return None
