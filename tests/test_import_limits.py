import asyncio
import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from fastapi import Request
from fastapi.responses import Response

from server.importer import CollectionTooLarge, import_package
from server.main import import_anki, same_origin


def import_request(length: str | None) -> Request:
    headers = [] if length is None else [(b"content-length", length.encode())]
    return Request({
        "type": "http", "method": "POST", "path": "/api/anki/import",
        "headers": headers, "scheme": "http", "server": ("testserver", 80),
        "query_string": b"",
    })


class ImportLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_unbounded_or_oversized_requests_before_parsing(self):
        async def unused(_):
            self.fail("Request body should not be parsed")

        self.assertEqual((await same_origin(import_request(None), unused)).status_code, 411)
        with patch("server.main.MAX_MULTIPART_BYTES", 10):
            self.assertEqual((await same_origin(import_request("11"), unused)).status_code, 413)
        self.assertEqual((await same_origin(import_request("invalid"), unused)).status_code, 400)

    async def test_allows_two_active_imports_and_rejects_the_third(self):
        entered = asyncio.Event()
        release = asyncio.Event()
        count = 0

        async def held(_):
            nonlocal count
            count += 1
            if count == 2:
                entered.set()
            await release.wait()
            return Response()

        first = asyncio.create_task(same_origin(import_request("1"), held))
        second = asyncio.create_task(same_origin(import_request("1"), held))
        await asyncio.wait_for(entered.wait(), 1)
        rejected = await same_origin(import_request("1"), held)
        self.assertEqual(rejected.status_code, 429)
        release.set()
        await asyncio.gather(first, second)
        self.assertEqual((await same_origin(import_request("1"), held)).status_code, 200)

    async def test_rejects_file_exceeding_limit(self):
        upload = UploadFile(io.BytesIO(b"12345"), filename="deck.apkg")
        with patch("server.main.MAX_PACKAGE_BYTES", 4):
            with self.assertRaises(HTTPException) as raised:
                await asyncio.to_thread(import_anki, upload)
        self.assertEqual(raised.exception.status_code, 413)

    async def test_rejects_large_unpacked_collection(self):
        with tempfile.TemporaryDirectory() as directory:
            package = Path(directory) / "deck.apkg"
            with zipfile.ZipFile(package, "w") as archive:
                archive.writestr("collection.anki2", b"12345")
            with patch("server.importer.MAX_COLLECTION_BYTES", 4):
                with self.assertRaisesRegex(CollectionTooLarge, "512 MiB limit"):
                    await asyncio.to_thread(import_package, package)

    async def test_reports_large_unpacked_collection_as_413(self):
        upload = UploadFile(io.BytesIO(b"package"), filename="deck.apkg")
        with patch("server.main.import_package", side_effect=CollectionTooLarge("too large")):
            with self.assertRaises(HTTPException) as raised:
                await asyncio.to_thread(import_anki, upload)
        self.assertEqual(raised.exception.status_code, 413)


if __name__ == "__main__":
    unittest.main()
