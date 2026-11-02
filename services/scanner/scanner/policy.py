"""URL and DNS policy used before every browser network request."""

from __future__ import annotations

import asyncio
import ipaddress
import posixpath
import re
import socket
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit


class PolicyError(ValueError):
    pass


def normalize_url(raw: str, base: str | None = None) -> str:
    if not raw or raw != raw.strip() or re.search(r"[\\\x00-\x1f\x7f]", raw):
        raise PolicyError("Invalid URL characters")
    candidate = urljoin(base, raw) if base else raw
    parts = urlsplit(candidate)
    if parts.scheme.lower() not in ("http", "https"):
        raise PolicyError("Only HTTP(S) URLs are allowed")
    if parts.username or parts.password or "@" in parts.netloc:
        raise PolicyError("URL credentials are blocked")
    hostname = parts.hostname
    if not hostname:
        raise PolicyError("URL has no host")
    try:
        hostname = hostname.encode("idna").decode("ascii").lower()
        port = parts.port
    except (UnicodeError, ValueError) as error:
        raise PolicyError("Invalid URL host or port") from error
    scheme = parts.scheme.lower()
    if port == (80 if scheme == "http" else 443):
        port = None
    netloc = f"[{hostname}]" if ":" in hostname else hostname
    if port is not None:
        netloc += f":{port}"
    raw_path = parts.path or "/"
    normalized_path = posixpath.normpath(raw_path)
    if raw_path.endswith("/") and not normalized_path.endswith("/"):
        normalized_path += "/"
    if not normalized_path.startswith("/"):
        normalized_path = "/" + normalized_path
    return urlunsplit((scheme, netloc, normalized_path, parts.query, ""))


def origin_of(url: str) -> str:
    parts = urlsplit(normalize_url(url))
    return f"{parts.scheme}://{parts.netloc}"


def safe_url(url: str) -> str:
    try:
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            return "[blocked non-HTTP URL]"
        hostname = parts.hostname
        netloc = f"[{hostname}]" if ":" in hostname else hostname
        if parts.port is not None:
            netloc += f":{parts.port}"
        query = urlencode([(key, "[REDACTED]")
                           for key, value in parse_qsl(parts.query, keep_blank_values=True)])
        return urlunsplit((parts.scheme, netloc, parts.path, query, ""))
    except ValueError:
        return "[blocked invalid URL]"


def safe_text(value: str, limit: int = 2000) -> str:
    text = re.sub(r"(?i)\b(https?://)[^/@\s]+@", r"\1[REDACTED]@", value)
    text = re.sub(r"(?i)(authorization|cookie)\s*[:=]\s*[^\s]+", r"\1: [REDACTED]", text)
    text = re.sub(r"(?i)([?&][A-Za-z0-9_-]*(?:token|key|secret|password|auth|session|code)[A-Za-z0-9_-]*=)[^&\s]+",
                  r"\1[REDACTED]", text)
    return text[:limit]


def public_address(address: str) -> bool:
    try:
        parsed = ipaddress.ip_address(address)
        if isinstance(parsed, ipaddress.IPv6Address) and parsed.ipv4_mapped:
            parsed = parsed.ipv4_mapped
        return parsed.is_global
    except ValueError:
        return False


class UrlPolicy:
    def __init__(self, approved_origins: list[str], local_fixture_origin: str | None = None):
        self.origins = set(approved_origins)
        self.local_fixture_origin = local_fixture_origin
        for origin in self.origins:
            normalized = normalize_url(origin)
            if origin_of(normalized) != origin or urlsplit(normalized).path != "/" or urlsplit(normalized).query:
                raise PolicyError("Approved origins must be exact origins")

    async def validate(self, raw: str, base: str | None = None) -> str:
        url = normalize_url(raw, base)
        origin = origin_of(url)
        if origin not in self.origins:
            raise PolicyError("Origin is not approved")
        parts = urlsplit(url)
        if origin == self.local_fixture_origin:
            return url
        if parts.port is not None:
            raise PolicyError("Unexpected port")
        host = parts.hostname or ""
        if "." not in host or host.endswith((".local", ".internal")):
            raise PolicyError("Non-public hostname")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise PolicyError("IP literals are blocked")
        try:
            answers = await asyncio.wait_for(asyncio.to_thread(socket.getaddrinfo, host, None, type=socket.SOCK_STREAM), timeout=3)
        except (OSError, asyncio.TimeoutError) as error:
            raise PolicyError("DNS validation failed") from error
        addresses = {item[4][0] for item in answers}
        if not addresses or any(not public_address(address) for address in addresses):
            raise PolicyError("DNS resolved to a blocked address")
        return url
