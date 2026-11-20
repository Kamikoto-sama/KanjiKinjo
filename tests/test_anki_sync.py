import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from server.anki_sync import download, login


class DownloadTests(unittest.TestCase):
    def test_full_sync_is_download_only(self):
        calls = []

        class Collection:
            def sync_status(self, auth):
                return SimpleNamespace(new_endpoint=None)

            def close_for_full_sync(self):
                calls.append("close")

            def full_upload_or_download(self, **kwargs):
                calls.append(kwargs)

            def reopen(self, **kwargs):
                calls.append(kwargs)

        auth = SimpleNamespace(endpoint="")
        download(Collection(), auth)
        self.assertEqual(calls[1]["upload"], False)
        self.assertEqual(calls[2], {"after_full_sync": True})

    def test_login_discards_temporary_collection_after_extraction(self):
        paths = []

        class Collection:
            def __init__(self, path):
                self.path = Path(path)
                self.path.write_bytes(b"temporary")

            def sync_login(self, *_):
                return SimpleNamespace(hkey="new-key", endpoint="")

            def close(self):
                pass

        def extract(path):
            paths.append(path)
            self.assertTrue(path.exists())
            return {"decks": []}

        with patch("server.anki_sync.Collection", Collection), patch("server.anki_sync.download"), \
             patch("server.anki_sync.export_collection", side_effect=extract):
            result = login("me@example.com", "password")
        self.assertEqual(result["auth"]["hkey"], "new-key")
        self.assertFalse(paths[0].exists())


if __name__ == "__main__":
    unittest.main()
