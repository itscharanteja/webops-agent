import unittest
from uuid import uuid4

from scanner.protocol import CrawlLimits, ScanInput
from scanner.tools import enrich_explanation_with_fallback, create_scanner_mcp_server


class DummyCrawler:
    def __init__(self):
        self.scan_id = str(uuid4())
        self.request = ScanInput(
            v=1,
            scan_id=self.scan_id,
            base_url="https://example.com/",
            approved_origins=["https://example.com"],
            limits=CrawlLimits(
                maxPages=10,
                maxDepth=2,
                concurrency=2,
                navigationTimeoutMs=5000,
                pageTimeoutMs=10000,
                scanTimeoutMs=30000,
                requestsPerSecond=2.0,
            ),
        )
        self.pending = [("https://example.com/page1", 1)]
        self.results = {}
        self.visited = ["https://example.com/"]
        self.skipped = []
        self.failed_count = 0
        self.complete = True


class TestScannerTools(unittest.TestCase):
    def test_enrichment_fallback_on_none(self):
        finding = {
            "observed": "Observed issue",
            "impact": "High impact",
            "suggested_fix": "Fix it",
        }
        res = enrich_explanation_with_fallback(finding, None, {"ev-1"})
        self.assertFalse(res["modelEnriched"])
        self.assertEqual(res["summary"], "Observed issue")
        self.assertEqual(res["suggestedFix"], "Fix it")

    def test_enrichment_rejects_hallucinated_citations(self):
        finding = {
            "observed": "Observed issue",
            "impact": "High impact",
            "suggested_fix": "Fix it",
        }
        hallucinated = {
            "summary": "AI summary",
            "impact": "AI impact",
            "suggested_fix": "AI fix",
            "cited_evidence_ids": ["ev-1", "ev-fake-999"],
        }
        res = enrich_explanation_with_fallback(finding, hallucinated, {"ev-1"})
        self.assertFalse(res["modelEnriched"])
        self.assertIn("Citation validation failed", res["fallbackReason"])
        self.assertEqual(res["suggestedFix"], "Fix it")

    def test_enrichment_accepts_valid_citations(self):
        finding = {
            "observed": "Observed issue",
            "impact": "High impact",
            "suggested_fix": "Fix it",
        }
        valid = {
            "summary": "AI summary",
            "impact": "AI impact",
            "suggested_fix": "AI fix",
            "cited_evidence_ids": ["ev-1"],
        }
        res = enrich_explanation_with_fallback(finding, valid, {"ev-1", "ev-2"})
        self.assertTrue(res["modelEnriched"])
        self.assertEqual(res["summary"], "AI summary")
        self.assertEqual(res["citedEvidenceIds"], ["ev-1"])

    def test_mcp_server_creation(self):
        crawler = DummyCrawler()
        mcp = create_scanner_mcp_server(crawler)
        self.assertIsNotNone(mcp)


if __name__ == "__main__":
    unittest.main()
