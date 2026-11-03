import unittest
from unittest.mock import MagicMock, patch
from scanner.bedrock import explain_finding_with_bedrock, get_bedrock_client
from scanner.runner import Crawler


class TestBedrock(unittest.TestCase):
    def test_scanner_emits_deterministic_finding_before_proof_ids_exist(self):
        crawler = Crawler.__new__(Crawler)
        crawler.emitter = MagicMock()
        finding = {
            "description": "Deterministic explanation",
            "impact": "Known impact",
            "evidence": [{"kind": "dom", "payload": {"html": "<img>"}}],
        }
        with patch.dict("os.environ", {"BEDROCK_MODEL_ID": "apac.amazon.nova-lite-v1:0"}):
            with patch("scanner.bedrock.get_bedrock_client") as client:
                crawler.send_finding("finding-1", finding)
        client.assert_not_called()
        crawler.emitter.send.assert_called_once_with("finding", "finding-1", finding)

    def test_explain_finding_returns_none_when_client_fails(self):
        with patch("scanner.bedrock.get_bedrock_client", return_value=None):
            result = explain_finding_with_bedrock({"rule_id": "TEST"}, ["ev-1"])
            self.assertIsNone(result)

    def test_explain_finding_parses_converse_response(self):
        mock_client = MagicMock()
        mock_client.converse.return_value = {
            "output": {
                "message": {
                    "content": [
                        {
                            "text": '{"summary": "Test summary", "impact": "Test impact", "suggested_fix": "Add alt attribute", "cited_evidence_ids": ["ev-1"]}'
                        }
                    ]
                }
            }
        }
        with patch("scanner.bedrock.get_bedrock_client", return_value=mock_client):
            result = explain_finding_with_bedrock(
                {"rule_id": "MISSING_IMAGE_ALT", "page_url": "https://example.com"},
                ["ev-1"],
            )
            self.assertIsNotNone(result)
            self.assertEqual(result["summary"], "Test summary")
            self.assertEqual(result["suggested_fix"], "Add alt attribute")
            self.assertEqual(result["cited_evidence_ids"], ["ev-1"])

    def test_explain_finding_handles_malformed_json_with_fallback(self):
        mock_client = MagicMock()
        mock_client.converse.return_value = {
            "output": {
                "message": {
                    "content": [{"text": "Not valid JSON output"}]
                }
            }
        }
        with patch("scanner.bedrock.get_bedrock_client", return_value=mock_client):
            result = explain_finding_with_bedrock(
                {"rule_id": "TEST"},
                ["ev-1"],
            )
            self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
