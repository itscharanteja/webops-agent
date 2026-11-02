"""Versioned worker/scanner messages."""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CrawlLimits(BaseModel):
    model_config = ConfigDict(extra="forbid")
    maxPages: int = Field(ge=1, le=100)
    maxDepth: int = Field(ge=0, le=5)
    concurrency: int = Field(ge=1, le=4)
    navigationTimeoutMs: int = Field(ge=1000, le=30000)
    pageTimeoutMs: int = Field(ge=5000, le=120000)
    scanTimeoutMs: int = Field(ge=30000, le=1800000)
    requestsPerSecond: float = Field(ge=0.1, le=5)


class ScanInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    v: Literal[1]
    scan_id: UUID
    base_url: str = Field(max_length=2048)
    approved_origins: list[str] = Field(min_length=1, max_length=10)
    limits: CrawlLimits
    local_fixture_origin: str | None = None


class EventPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    level: Literal["debug", "info", "warn", "error"]
    phase: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=2000)
    data: dict[str, Any] = Field(default_factory=dict)


class FailedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(max_length=2048)
    error: str = Field(max_length=500)


class PagePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    normalized_url: str = Field(max_length=2048)
    final_url: str | None = Field(default=None, max_length=2048)
    depth: int = Field(ge=0)
    http_status: int | None = Field(default=None, ge=100, le=599)
    title: str | None = Field(default=None, max_length=500)
    timing_ms: int | None = Field(default=None, ge=0)
    visited_at: str
    console_messages: list[str] = Field(max_length=100)
    failed_requests: list[FailedRequest] = Field(max_length=100)


class SkippedUrl(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(max_length=2048)
    reason: str = Field(max_length=200)


class DonePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    visited_urls: list[str] = Field(max_length=100)
    skipped: list[SkippedUrl] = Field(max_length=500)
    failed_count: int = Field(ge=0)
    limitations: list[str] = Field(max_length=100)
    complete: bool


class EvidencePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["screenshot", "dom", "console", "network", "url"]
    locator: str | None = Field(default=None, max_length=500)
    payload: dict[str, Any]
    artifact_base64: str | None = Field(default=None, max_length=800_000)
    mime_type: Literal["image/jpeg", "image/png"] | None = None


class FindingPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page_url: str = Field(max_length=2048)
    rule_id: Literal["HTTP_PAGE_ERROR", "BROKEN_INTERNAL_LINK", "JS_CONSOLE_ERROR",
                     "FAILED_FIRST_PARTY_REQUEST", "MISSING_IMAGE_ALT", "UNLABELED_FORM_CONTROL",
                     "MISSING_PAGE_TITLE", "HORIZONTAL_OVERFLOW"]
    rule_version: Literal["1"] = "1"
    target: str = Field(min_length=1, max_length=1000)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(max_length=4000)
    priority: Literal["P0", "P1", "P2", "P3"]
    confidence: float = Field(ge=0, le=1)
    observed: str = Field(min_length=1, max_length=4000)
    impact: str = Field(min_length=1, max_length=2000)
    reproduction_steps: list[str] = Field(min_length=1, max_length=10)
    suggested_fix: str = Field(min_length=1, max_length=2000)
    facts: dict[str, Any]
    evidence: list[EvidencePayload] = Field(min_length=1, max_length=6)


class PageScreenshotPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page_url: str = Field(max_length=2048)
    viewport: Literal["desktop", "mobile"]
    artifact_base64: str = Field(max_length=800_000)
    mime_type: Literal["image/jpeg"]
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class ProtocolMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    v: Literal[1] = 1
    type: Literal["event", "page", "candidate", "finding", "done"]
    scan_id: UUID
    idempotency_key: str = Field(min_length=1, max_length=256)
    payload: dict[str, Any]
