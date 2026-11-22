import asyncio
import tempfile
import unittest
from collections import deque
from pathlib import Path
from unittest.mock import patch

from server import main


async def request(path, *, method="GET", body=b"", client="192.0.2.1"):
    scope = {
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
        "http_version": "1.1", "scheme": "http", "path": path, "method": method,
        "query_string": b"", "server": ("testserver", 80), "client": (client, 1234),
        "headers": [(b"content-type", b"application/json")] if body else [],
    }
    messages = []

    async def send(message):
        messages.append(message)

    async def receive():
        nonlocal body
        if body is None:
            await asyncio.Event().wait()
        data, body = body, None
        return {"type": "http.request", "body": data, "more_body": False}

    await asyncio.wait_for(main.app(scope, receive, send), timeout=3)
    response = messages[0]
    return response["status"], dict(response["headers"]), b"".join(
        message.get("body", b"") for message in messages[1:]
    )


class FrontendTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.dist = self.root / "dist"
        self.dist.mkdir()
        self.enterContext(patch.object(main, "frontend_files", main.FrontendFiles(self.dist)))
        (self.dist / "index.html").write_text("PWA shell")

    async def test_serves_assets_and_client_routes_and_keeps_api_404(self):
        (self.dist / "assets").mkdir()
        (self.dist / "assets" / "app.js").write_text("PWA script")
        (self.dist / "icon.svg").write_text("PWA icon")
        (self.dist / "api").mkdir()
        (self.dist / "api" / "unknown").write_text("outside API routing")

        for path, body in [
            ("/assets/app.js", b"PWA script"), ("/icon.svg", b"PWA icon"),
            ("/", b"PWA shell"), ("/word", b"PWA shell"),
        ]:
            status, _, received = await request(path)
            self.assertEqual((status, received), (200, body))
        self.assertEqual((await request("/assets/app.js", method="HEAD"))[2], b"")
        for path in ("/api", "/api/unknown", "/assets/missing.js"):
            self.assertEqual((await request(path))[0], 404)
        self.assertEqual((await request("/api/unknown", method="POST"))[0], 404)

    async def test_only_serves_files_inside_build_directory(self):
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "file.js").write_text("outside build")
        (self.dist / "assets").symlink_to(outside, target_is_directory=True)
        (self.dist / "alias.html").symlink_to(self.dist / "index.html")

        self.assertEqual((await request("/assets/file.js"))[0], 404)
        self.assertEqual((await request("/alias.html"))[2], b"PWA shell")
        (self.dist / "index.html").unlink()
        (self.dist / "index.html").symlink_to(outside / "file.js")
        self.assertEqual((await request("/word"))[0], 404)


class AnkiApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.now = 100
        self.enterContext(patch.object(main, "monotonic", side_effect=lambda: self.now))
        self.enterContext(patch.object(main, "login_attempts", deque()))
        self.enqueue = self.enterContext(patch.object(main, "enqueue_job", return_value={"jobId": "queued"}))

    async def login(self, client="192.0.2.1"):
        return await request(
            "/api/anki/login", method="POST", client=client,
            body=b'{"email":"me@example.test","password":"password"}',
        )

    async def test_login_limit_expires_and_applies_per_client(self):
        for _ in range(main.LOGIN_LIMIT_PER_CLIENT):
            self.assertEqual((await self.login())[0], 200)
        self.now += 10
        status, headers, _ = await self.login()
        self.assertEqual(status, 429)
        self.assertEqual(headers[b"retry-after"], b"50")
        self.assertEqual(self.enqueue.call_count, main.LOGIN_LIMIT_PER_CLIENT)
        self.assertEqual((await self.login("192.0.2.2"))[0], 200)
        self.now += 50
        self.assertEqual((await self.login())[0], 200)

    async def test_total_login_limit_applies_across_clients(self):
        with patch.object(main, "LOGIN_LIMIT_TOTAL", 2):
            self.assertEqual((await self.login("192.0.2.1"))[0], 200)
            self.assertEqual((await self.login("192.0.2.2"))[0], 200)
            self.assertEqual((await self.login("192.0.2.3"))[0], 429)
        self.assertEqual(self.enqueue.call_count, 2)

    async def test_sync_validates_endpoint_before_enqueuing(self):
        path = "/api/anki/sync"
        status, _, _ = await request(
            path, method="POST", body=b'{"hkey":"key","endpoint":"https://example.test/"}',
        )
        self.assertEqual(status, 400)
        self.enqueue.assert_not_called()
        status, _, _ = await request(path, method="POST", body=b'{"hkey":"key"}')
        self.assertEqual(status, 200)
        self.enqueue.assert_called_once_with(main.sync, "key", "https://sync.ankiweb.net/", "")
