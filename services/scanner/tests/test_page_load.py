import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from scanner.protocol import CrawlLimits, ScanInput
from scanner.runner import Crawler, PAGE_LOAD_TIMEOUT_MS


class TestPageLoadStateAndTimeout(unittest.TestCase):
    def setUp(self):
        self.scan_id = str(uuid4())
        self.request = ScanInput(
            v=1,
            scan_id=self.scan_id,
            base_url="https://example.com/",
            approved_origins=["https://example.com"],
            limits=CrawlLimits(
                maxPages=5,
                maxDepth=2,
                concurrency=1,
                navigationTimeoutMs=PAGE_LOAD_TIMEOUT_MS,
                pageTimeoutMs=15000,
                scanTimeoutMs=30000,
                requestsPerSecond=2.0,
            ),
        )
        self.crawler = Crawler(self.request)

    def test_page_load_timeout_constant_is_7_seconds(self):
        self.assertEqual(PAGE_LOAD_TIMEOUT_MS, 7000)

    def test_inspect_waits_for_ready_state_complete(self):
        async def run_test():
            mock_page = AsyncMock()
            mock_page.set_default_timeout = MagicMock()
            mock_page.set_default_navigation_timeout = MagicMock()
            mock_page.on = MagicMock()
            mock_page.goto = AsyncMock(return_value=MagicMock(status=200))
            mock_page.wait_for_function = AsyncMock()
            mock_page.evaluate = AsyncMock(return_value="complete")
            mock_page.title = AsyncMock(return_value="Example Page")
            mock_page.url = "https://example.com/test"
            
            mock_locator = MagicMock()
            mock_locator.evaluate_all = AsyncMock(return_value=[{"url": "https://example.com/sub", "text": "Sub"}])
            mock_page.locator = MagicMock(return_value=mock_locator)

            mock_context = AsyncMock()
            mock_context.new_page = AsyncMock(return_value=mock_page)

            with patch("scanner.runner.explore_page_interactions", new=AsyncMock(return_value={"revealed_links": []})), \
                 patch("scanner.runner.run_dom_checks", new=AsyncMock(return_value=([], None))):
                res = await self.crawler.inspect(mock_context, "https://example.com/test", 0)

            # Verified goto used domcontentloaded and 7000ms
            mock_page.goto.assert_called_once_with(
                "https://example.com/test",
                wait_until="domcontentloaded",
                timeout=7000,
            )
            # Verified wait_for_function waited for document.readyState === 'complete'
            mock_page.wait_for_function.assert_called_once_with(
                "() => document.readyState === 'complete'",
                timeout=3000,
            )
            # Verified evaluate checked document.readyState
            mock_page.evaluate.assert_any_call("() => document.readyState")
            # Verified crawler extracted links because page loaded full
            self.assertEqual(len(res.links), 1)
            self.assertEqual(res.status, 200)
            self.assertIsNone(res.limitation)

        asyncio.run(run_test())

    def test_inspect_crawls_when_ready_state_is_interactive(self):
        async def run_test():
            mock_page = AsyncMock()
            mock_page.set_default_timeout = MagicMock()
            mock_page.set_default_navigation_timeout = MagicMock()
            mock_page.on = MagicMock()
            mock_page.goto = AsyncMock(return_value=MagicMock(status=200))
            mock_page.wait_for_function = AsyncMock()
            # Returns 'interactive' (e.g. subresources blocked by origin policy)
            mock_page.evaluate = AsyncMock(return_value="interactive")
            mock_page.title = AsyncMock(return_value="Example Page")
            mock_page.url = "https://example.com/test"

            mock_locator = MagicMock()
            mock_locator.evaluate_all = AsyncMock(return_value=[{"url": "https://example.com/sub", "text": "Sub"}])
            mock_page.locator = MagicMock(return_value=mock_locator)

            mock_context = AsyncMock()
            mock_context.new_page = AsyncMock(return_value=mock_page)

            with patch("scanner.runner.explore_page_interactions", new=AsyncMock(return_value={"revealed_links": []})), \
                 patch("scanner.runner.run_dom_checks", new=AsyncMock(return_value=([], None))):
                res = await self.crawler.inspect(mock_context, "https://example.com/test", 0)

            # Must crawl successfully (links extracted)
            self.assertEqual(len(res.links), 1)
            self.assertEqual(res.status, 200)
            self.assertIsNone(res.limitation)

        asyncio.run(run_test())

    def test_inspect_does_not_crawl_if_ready_state_is_loading(self):
        async def run_test():
            mock_page = AsyncMock()
            mock_page.set_default_timeout = MagicMock()
            mock_page.set_default_navigation_timeout = MagicMock()
            mock_page.on = MagicMock()
            mock_page.goto = AsyncMock(return_value=MagicMock(status=200))
            mock_page.wait_for_function = AsyncMock()
            # Returns 'loading'
            mock_page.evaluate = AsyncMock(return_value="loading")
            mock_page.url = "https://example.com/test"

            mock_context = AsyncMock()
            mock_context.new_page = AsyncMock(return_value=mock_page)

            res = await self.crawler.inspect(mock_context, "https://example.com/test", 0)

            # Must NOT crawl (no links extracted)
            self.assertEqual(res.links, [])
            self.assertIsNotNone(res.limitation)
            self.assertIn("document.readyState is 'loading'", res.limitation)

        asyncio.run(run_test())

    def test_inspect_does_not_crawl_on_7s_timeout(self):
        async def run_test():
            mock_page = AsyncMock()
            mock_page.set_default_timeout = MagicMock()
            mock_page.set_default_navigation_timeout = MagicMock()
            mock_page.on = MagicMock()
            # Simulate timeout during page load
            mock_page.goto = AsyncMock(side_effect=asyncio.TimeoutError("Timeout 7000ms exceeded"))
            mock_page.url = "https://example.com/test"

            mock_context = AsyncMock()
            mock_context.new_page = AsyncMock(return_value=mock_page)

            res = await self.crawler.inspect(mock_context, "https://example.com/test", 0)

            # Must NOT crawl
            self.assertEqual(res.links, [])
            self.assertIsNotNone(res.limitation)
            self.assertIn("Timeout 7000ms exceeded", res.limitation)

        asyncio.run(run_test())


if __name__ == "__main__":
    unittest.main()
