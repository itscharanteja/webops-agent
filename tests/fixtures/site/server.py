"""Local-only fixture server with an observable harmless form endpoint."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from threading import Thread
import time

submissions = 0
blocked_hits = 0


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/server-error":
            self.send_error(503, "Fixture resource failure")
            return
        if self.path == "/slow.html":
            time.sleep(20)
            body = b"<!doctype html><title>Slow fixture</title><h1>Slow fixture</h1>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/_form_submissions":
            body = json.dumps({"count": submissions}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        global submissions
        if self.path != "/form-action":
            self.send_error(404)
            return
        size = min(int(self.headers.get("Content-Length", "0")), 1024)
        self.rfile.read(size)
        submissions += 1
        body = b"Submitted test data"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class BlockedHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        global blocked_hits
        if self.path == "/_hits":
            body = json.dumps({"count": blocked_hits}).encode()
        else:
            blocked_hits += 1
            body = b"Unapproved origin reached"
        self.send_response(200)
        self.send_header("Content-Type", "application/json" if self.path == "/_hits" else "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    Thread(target=ThreadingHTTPServer(("0.0.0.0", 8081), BlockedHandler).serve_forever, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
