import io
import json
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from zstandard import ZstdCompressor, ZstdDecompressor

from server.anki_sync import login, sync


class Response(io.BytesIO):
    def __init__(self, body=b"", *, status=200, location=None):
        super().__init__(ZstdCompressor().compress(body))
        self.status = status
        self.headers = {"anki-original-size": str(len(body)), "Location": location}

    def getheader(self, name, default=None):
        return self.headers.get(name, default)


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.connection = Mock()
        self.connect = self.enterContext(patch("server.anki_sync.HTTPSConnection", return_value=self.connection))
        self.export = self.enterContext(patch("server.anki_sync.export_collection", return_value={"decks": []}))

    def test_login_downloads_from_validated_sync_host_and_discards_temporary_collection(self):
        self.connection.getresponse.side_effect = [
            Response(b'{"key":"new-key"}'),
            Response(status=308, location="https://sync19.ankiweb.net/"),
            Response(b'{"cont":true}'),
            Response(b"temporary collection"),
        ]

        def extract(path: Path):
            self.assertEqual(path.read_bytes(), b"temporary collection")
            return {"decks": []}

        self.export.side_effect = extract
        result = login("me@example.com", "password")

        self.assertEqual(result["auth"], {
            "hkey": "new-key", "endpoint": "https://sync19.ankiweb.net/", "email": "me@example.com",
        })
        self.assertEqual([call.args[0] for call in self.connect.call_args_list], [
            "sync.ankiweb.net", "sync.ankiweb.net", "sync19.ankiweb.net", "sync19.ankiweb.net",
        ])
        requests = [call.args for call in self.connection.request.call_args_list]
        self.assertEqual([request[1] for request in requests], [
            "/sync/hostKey", "/sync/meta", "/sync/meta", "/sync/download",
        ])
        login_data = ZstdDecompressor().decompress(requests[0][2])
        self.assertEqual(json.loads(login_data), {"u": "me@example.com", "p": "password"})
        self.assertEqual(json.loads(requests[-1][3]["anki-sync"])["k"], "new-key")
        self.assertFalse(self.export.call_args.args[0].exists())

    def test_rejects_unsupported_endpoint_before_opening_connection(self):
        with self.assertRaisesRegex(ValueError, "Unsupported AnkiWeb sync endpoint"):
            sync("key", "https://example.test/", "me@example.com")
        self.connect.assert_not_called()

    def test_rejects_unsupported_redirect_during_metadata_or_download(self):
        for prior in ([], [Response(b'{"cont":true}')]):
            with self.subTest(prior_requests=len(prior)):
                self.connect.reset_mock()
                self.connection.getresponse.side_effect = [
                    *prior, Response(status=308, location="https://example.test/"),
                ]
                with self.assertRaisesRegex(ValueError, "Unsupported AnkiWeb sync endpoint"):
                    sync("key", "", "me@example.com")
                self.assertEqual(self.connect.call_count, len(prior) + 1)
        self.export.assert_not_called()

    def test_rejects_redirects_other_than_ankiweb_migration(self):
        self.connection.getresponse.return_value = Response(status=302, location="https://example.test/")
        with self.assertRaisesRegex(RuntimeError, "HTTP 302"):
            sync("key", "", "me@example.com")
        self.connect.assert_called_once()
