"""HTTP server: static dashboard files + /api/* routing."""

import argparse
import json
import mimetypes
import secrets
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import config as cfg
from .config import (BASE_DIR, DATA_ROOT, HOST, PORT, STATIC_TYPES,
                     VERSION, db_path, is_loopback, log, set_auth_token, set_db_path)
from .routes import handle_api

class Handler(BaseHTTPRequestHandler):
    server_version = "TokenMetrics/%s" % VERSION

    def _authorized(self, query):
        """True when the request carries the auth token (cookie, header or
        query param). No token configured -> open."""
        token = cfg.AUTH_TOKEN
        if not token:
            return True
        if self.headers.get("Cookie", "").find("tm_auth=%s" % token) >= 0:
            return True
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer ") and auth[len("Bearer "):].strip() == token:
            return True
        return (query.get("token") or [""])[0] == token

    def _send(self, code, body, ctype, extra_headers=None):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        if cfg.AUTH_TOKEN:
            self.send_header("Set-Cookie",
                             "tm_auth=%s; HttpOnly; SameSite=Strict; Path=/" % cfg.AUTH_TOKEN)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8")

    def do_OPTIONS(self):
        self._send(200, b"", "text/plain")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path.startswith("/api/"):
            if not self._authorized(query):
                self._json(401, {"ok": False, "error": "unauthorized"})
                return
            try:
                payload = handle_api(path, query)
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)})
                return
            if payload is None:
                self._json(404, {"ok": False, "error": "unknown endpoint"})
                return
            self._json(200, payload)
            return

        # Static dashboard files
        if path in ("/", "/index.html"):
            path = "/index.html"
        elif path.startswith("/.."):
            self._send(403, b"forbidden", "text/plain")
            return

        rel = path.lstrip("/")
        if not rel:
            rel = "index.html"
        if rel.startswith("graphify-out/"):
            root = DATA_ROOT
        else:
            root = BASE_DIR
        file_path = (root / rel).resolve()
        if not str(file_path).startswith(str(root.resolve())) or not file_path.is_file():
            self._send(404, b"not found", "text/plain")
            return

        ext = file_path.suffix.lower()
        ctype = STATIC_TYPES.get(ext, mimetypes.guess_type(str(file_path))[0] or "application/octet-stream")
        try:
            body = file_path.read_bytes()
        except OSError as e:
            self._send(500, str(e).encode("utf-8"), "text/plain; charset=utf-8")
            return
        self._send(200, body, ctype)

    def log_message(self, fmt, *args):
        return


def make_server(host=HOST, port=PORT):
    """Bind and return a started ThreadingHTTPServer.

    port 0 -> OS picks a free port (returned as the second element).
    Compatible with embedding (desktop.py) and the CLI.
    """
    srv = ThreadingHTTPServer((host, port), Handler)
    actual = srv.server_address[1]
    log("=" * 58)
    log("Token Metrics - OpenCode bridge")
    log("  DB       : %s" % db_path())
    log("  UI       : http://%s:%d/" % (host, actual))
    log("  API      : http://%s:%d/api/health" % (host, actual))
    log("=" * 58)
    return srv, actual


def main():
    ap = argparse.ArgumentParser(description="OpenCode Token Metrics bridge server")
    ap.add_argument("--port", type=int, default=PORT, help="listen port (default %d)" % PORT)
    ap.add_argument("--host", default=HOST, help="bind address (default %s)" % HOST)
    ap.add_argument("--db", default=None, help="override opencode database path")
    ap.add_argument("--auth-token", default=None,
                    help="require this token on /api/* (also via TOKENMETRICS_AUTH_TOKEN)")
    args = ap.parse_args()

    if args.db:
        set_db_path(args.db)

    if args.auth_token:
        set_auth_token(args.auth_token)
    if not is_loopback(args.host) and not cfg.AUTH_TOKEN:
        token = secrets.token_urlsafe(24)
        set_auth_token(token)
        log("=" * 58)
        log("WARNING: binding to a non-loopback address - remote access")
        log("API auth token: %s" % token)
        log("Pass it as ?token=..., Authorization: Bearer, or the tm_auth cookie.")
        log("=" * 58)

    srv, _ = make_server(args.host, args.port)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        log("\nStopping server.")
        srv.shutdown()


if __name__ == "__main__":
    main()
