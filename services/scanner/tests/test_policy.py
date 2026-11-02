import socket
import unittest
from unittest.mock import patch

from scanner.policy import PolicyError, UrlPolicy, normalize_url, public_address, safe_url


def answer(address: str):
    return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", (address, 443))]


class PolicyTests(unittest.IsolatedAsyncioTestCase):
    def test_normalization_and_redaction(self):
        self.assertEqual(normalize_url("../about.html#section", "https://EXAMPLE.com/a/b/"),
                         "https://example.com/a/about.html")
        self.assertIn("token=%5BREDACTED%5D", safe_url("https://example.com/?token=secret&x=1"))
        self.assertIn("x=%5BREDACTED%5D", safe_url("https://example.com/?token=secret&x=1"))
        self.assertNotIn("user:pass", safe_url("https://user:pass@example.com/path"))
        for raw in ("file:///etc/passwd", "http://user:pass@example.com/", "http://example.com\\@evil.test/"):
            with self.assertRaises(PolicyError):
                normalize_url(raw)

    def test_address_ranges(self):
        for address in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "100.100.100.200", "::1", "fc00::1", "::ffff:127.0.0.1"):
            self.assertFalse(public_address(address), address)
        self.assertTrue(public_address("8.8.8.8"))

    async def test_origin_and_dns_rebinding(self):
        policy = UrlPolicy(["https://example.com"])
        with self.assertRaises(PolicyError):
            await policy.validate("https://other.example/")
        with patch("socket.getaddrinfo", side_effect=[answer("8.8.8.8"), answer("127.0.0.1")]):
            self.assertEqual(await policy.validate("https://example.com/"), "https://example.com/")
            with self.assertRaises(PolicyError):
                await policy.validate("https://example.com/")

    async def test_exact_local_fixture_exception(self):
        policy = UrlPolicy(["http://localhost:8080"], "http://localhost:8080")
        self.assertEqual(await policy.validate("http://localhost:8080/index.html"), "http://localhost:8080/index.html")
        with self.assertRaises(PolicyError):
            await policy.validate("http://localhost:8081/")


if __name__ == "__main__":
    unittest.main()
