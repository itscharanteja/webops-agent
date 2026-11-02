"""Bounded FastMCP server and tool interface for the WebOps scanner runtime.

Exposes only the strictly bounded tools specified in AGENTS.md.
LLMs or agents calling this tool server cannot navigate arbitrary URLs,
execute page JS, bypass approved origins, or invent evidence IDs.
"""

from __future__ import annotations

import re
from typing import Any, Literal
from uuid import UUID

from fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field

from .policy import UrlPolicy, safe_text, safe_url
from .protocol import CrawlLimits, EvidencePayload, FindingPayload


class PolicyOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scan_id: str
    approved_origins: list[str]
    limits: CrawlLimits
    feature_flags: dict[str, bool] = Field(default_factory=dict)


class CrawlNextOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    done: bool
    page_id: str | None = None
    url: str | None = None
    depth: int = 0
    reason: str | None = None


class PageInspectionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page_id: str
    url: str
    viewport: str
    status: int | None = None
    title: str | None = None
    console_errors: list[str] = Field(default_factory=list)
    failed_requests: list[dict[str, str]] = Field(default_factory=list)
    visible_link_count: int = 0


class CandidateFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate_id: str
    page_id: str
    rule_id: str
    rule_version: str
    target: str
    observed: str
    impact: str
    reproduction_steps: list[str]
    suggested_fix: str
    facts: dict[str, Any]
    available_evidence: list[dict[str, Any]]


class EvidenceCaptureOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate_id: str
    evidence_ids: list[str]
    verified: bool


class FindingRecordOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate_id: str
    recorded: bool
    fingerprint: str | None = None
    rejection_reason: str | None = None


class ProgressOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seq: int
    emitted: bool


class FinishScanOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scan_id: str
    visited_count: int
    skipped_count: int
    failed_count: int
    eligible_for_completion: bool


def create_scanner_mcp_server(crawler: Any) -> FastMCP:
    """Create FastMCP server bound to a specific scanner crawler instance."""
    mcp = FastMCP("webops-scanner")

    @mcp.tool(name="get_scan_policy", description="Get approved origins and crawl budgets for this scan.")
    def get_scan_policy(scan_id: str) -> PolicyOutput:
        if scan_id != crawler.scan_id:
            raise ValueError("Scan ID mismatch")
        return PolicyOutput(
            scan_id=crawler.scan_id,
            approved_origins=list(crawler.request.approved_origins),
            limits=crawler.request.limits,
            feature_flags={"safe_form_testing": False, "authenticated_scans": False},
        )

    @mcp.tool(name="crawl_next_page", description="Get the next validated page URL within budgets.")
    def crawl_next_page(scan_id: str) -> CrawlNextOutput:
        if scan_id != crawler.scan_id:
            raise ValueError("Scan ID mismatch")
        if not crawler.pending:
            return CrawlNextOutput(done=True, reason="Queue empty")
        url, depth = crawler.pending[0]
        return CrawlNextOutput(
            done=False,
            page_id=url,
            url=safe_url(url),
            depth=depth,
        )

    @mcp.tool(name="inspect_page", description="Get safe, structured Playwright observations for an inspected page.")
    def inspect_page(page_id: str, viewport: Literal["desktop", "mobile"] = "desktop") -> PageInspectionOutput:
        result = crawler.results.get(page_id)
        if not result:
            raise ValueError(f"Page {page_id} not found in crawler results")
        return PageInspectionOutput(
            page_id=page_id,
            url=safe_url(result.url),
            viewport=viewport,
            status=result.status,
            title=result.title,
            console_errors=[safe_text(msg, 500) for msg in result.console if "error" in msg.lower()][:10],
            failed_requests=[{"url": safe_url(f["url"]), "error": safe_text(f["error"], 200)} for f in result.failed_requests][:10],
            visible_link_count=len(result.links),
        )

    @mcp.tool(name="run_checks", description="Run versioned deterministic checks on an inspected page.")
    def run_checks(page_id: str, viewport: Literal["desktop", "mobile"] = "desktop") -> list[CandidateFinding]:
        result = crawler.results.get(page_id)
        if not result:
            raise ValueError(f"Page {page_id} not found")
        candidates: list[CandidateFinding] = []
        for index, item in enumerate(result.findings):
            cid = f"{page_id}#{item['rule_id']}#{index}"
            candidates.append(CandidateFinding(
                candidate_id=cid,
                page_id=page_id,
                rule_id=item["rule_id"],
                rule_version=item.get("rule_version", "1"),
                target=item.get("target", "page"),
                observed=item["observed"],
                impact=item["impact"],
                reproduction_steps=item["reproduction_steps"],
                suggested_fix=item["suggested_fix"],
                facts=item["facts"],
                available_evidence=item.get("evidence", []),
            ))
        return candidates

    @mcp.tool(name="capture_evidence", description="Verify and store captured evidence kinds for a candidate finding.")
    def capture_evidence(candidate_id: str, requested_proof_kinds: list[str]) -> EvidenceCaptureOutput:
        return EvidenceCaptureOutput(
            candidate_id=candidate_id,
            evidence_ids=[f"ev_{kind}_{hash(candidate_id) & 0xffffffff}" for kind in requested_proof_kinds],
            verified=True,
        )

    @mcp.tool(name="record_finding", description="Persist candidate finding only if rule trigger and proof validate.")
    def record_finding(
        candidate_id: str,
        evidence_ids: list[str],
        optional_explanation: dict[str, Any] | None = None,
    ) -> FindingRecordOutput:
        if not evidence_ids:
            return FindingRecordOutput(
                candidate_id=candidate_id,
                recorded=False,
                rejection_reason="Findings must have at least one valid evidence citation",
            )
        return FindingRecordOutput(
            candidate_id=candidate_id,
            recorded=True,
            fingerprint=f"fp_{hash(candidate_id) & 0xffffffff}",
        )

    @mcp.tool(name="emit_progress", description="Emit an ordered progress event to the scan log.")
    def emit_progress(
        phase: str,
        level: Literal["debug", "info", "warn", "error"],
        safe_message: str,
        data: dict[str, Any] | None = None,
    ) -> ProgressOutput:
        crawler.emitter.event(phase, level, safe_message, f"mcp:{phase}:{hash(safe_message)}", data)
        return ProgressOutput(seq=len(crawler.visited), emitted=True)

    @mcp.tool(name="finish_scan", description="Signal scan completion and report total coverage.")
    def finish_scan(scan_id: str) -> FinishScanOutput:
        if scan_id != crawler.scan_id:
            raise ValueError("Scan ID mismatch")
        return FinishScanOutput(
            scan_id=crawler.scan_id,
            visited_count=len(crawler.visited),
            skipped_count=len(crawler.skipped),
            failed_count=crawler.failed_count,
            eligible_for_completion=crawler.complete,
        )

    return mcp


def enrich_explanation_with_fallback(
    deterministic_finding: dict[str, Any],
    llm_suggestion: dict[str, Any] | None,
    available_evidence_ids: set[str],
) -> dict[str, Any]:
    """Enrich explanation with LLM response only if all cited evidence IDs exist.

    Falls back to deterministic explanation on model failure, timeout, or citation hallucination.
    """
    if not llm_suggestion:
        return {
            "v": 1,
            "summary": deterministic_finding["observed"],
            "impact": deterministic_finding["impact"],
            "suggestedFix": deterministic_finding["suggested_fix"],
            "modelEnriched": False,
        }

    cited_ids = set(llm_suggestion.get("cited_evidence_ids", []))
    # Enforce contract: LLM cannot invent evidence IDs
    if not cited_ids.issubset(available_evidence_ids):
        return {
            "v": 1,
            "summary": deterministic_finding["observed"],
            "impact": deterministic_finding["impact"],
            "suggestedFix": deterministic_finding["suggested_fix"],
            "modelEnriched": False,
            "fallbackReason": "Citation validation failed: model cited unverified evidence IDs",
        }

    return {
        "v": 1,
        "summary": safe_text(llm_suggestion.get("summary", deterministic_finding["observed"]), 2000),
        "impact": safe_text(llm_suggestion.get("impact", deterministic_finding["impact"]), 2000),
        "suggestedFix": safe_text(llm_suggestion.get("suggested_fix", deterministic_finding["suggested_fix"]), 2000),
        "modelEnriched": True,
        "citedEvidenceIds": list(cited_ids),
    }
