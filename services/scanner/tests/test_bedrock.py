import unittest
from unittest.mock import MagicMock, patch
from scanner.bedrock import (
    classify_persona,
    build_persona_prompt,
    explain_finding_with_bedrock,
    get_bedrock_client,
)
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

    def test_classify_persona(self):
        self.assertEqual(classify_persona("CONTRAST_DEFECT"), "ui_ux")
        self.assertEqual(classify_persona("HORIZONTAL_OVERFLOW"), "ui_ux")
        self.assertEqual(classify_persona("VISUAL_OVERLAP_CLIPPING"), "ui_ux")
        self.assertEqual(classify_persona("FAILED_FIRST_PARTY_REQUEST"), "backend")
        self.assertEqual(classify_persona("HTTP_PAGE_ERROR", {"status": 500}), "backend")
        self.assertEqual(classify_persona("HTTP_PAGE_ERROR", {"status": 404}), "frontend")
        self.assertEqual(classify_persona("MISSING_PAGE_TITLE"), "content_seo")
        self.assertEqual(classify_persona("MISSING_IMAGE_ALT"), "content_seo")
        self.assertEqual(classify_persona("UNLABELED_FORM_CONTROL"), "frontend")

    def test_build_persona_prompt_role_instructions(self):
        finding = {"rule_id": "CONTRAST_DEFECT", "observed": "Contrast 2.8:1"}
        prompt_ui = build_persona_prompt(finding, ["ev-1"], "ui_ux")
        self.assertIn("Principal Product Designer", prompt_ui)
        self.assertIn("WCAG / Design System Tokens", prompt_ui)

        prompt_be = build_persona_prompt(finding, ["ev-1"], "backend")
        self.assertIn("Staff Site Reliability Engineer", prompt_be)
        self.assertIn("Reproduction cURL", prompt_be)

        prompt_fe = build_persona_prompt(finding, ["ev-1"], "frontend")
        self.assertIn("Principal Frontend Engineer", prompt_fe)

        prompt_seo = build_persona_prompt(finding, ["ev-1"], "content_seo")
        self.assertIn("Content Strategist", prompt_seo)

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
                            "text": '{"summary": "Test summary", "impact": "Test impact", "suggested_fix": "Add alt attribute", "code_or_token_snippet": "alt=\\"logo\\"", "cited_evidence_ids": ["ev-1"]}'
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
            self.assertEqual(result["code_or_token_snippet"], 'alt="logo"')
            self.assertEqual(result["cited_evidence_ids"], ["ev-1"])
            self.assertEqual(result["target_persona"], "content_seo")

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
