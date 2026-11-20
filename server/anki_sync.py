"""Stateless AnkiWeb downloads. Collections exist only during a request job."""

import tempfile
from pathlib import Path

from anki.collection import Collection
from anki.sync import SyncAuth

from .collection import export_collection


def download(collection: Collection, auth: SyncAuth) -> None:
    status = collection.sync_status(auth)
    if status.new_endpoint:
        auth.endpoint = status.new_endpoint
    collection.close_for_full_sync()
    try:
        collection.full_upload_or_download(auth=auth, server_usn=None, upload=False)
    finally:
        collection.reopen(after_full_sync=True)


def login(username: str, password: str) -> dict:
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "collection.anki2"
        collection = Collection(str(path))
        try:
            auth = collection.sync_login(username, password, None)
            try:
                download(collection, auth)
            except Exception as error:
                raise RuntimeError(
                    f"AnkiWeb sign-in succeeded, but collection download failed: {error}"
                ) from error
        finally:
            collection.close()
        return {
            "auth": {"hkey": auth.hkey, "endpoint": auth.endpoint, "email": username},
            "collection": export_collection(path),
        }


def sync(hkey: str, endpoint: str, email: str) -> dict:
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "collection.anki2"
        collection = Collection(str(path))
        auth = SyncAuth(hkey=hkey, endpoint=endpoint)
        try:
            download(collection, auth)
        finally:
            collection.close()
        return {
            "auth": {"hkey": auth.hkey, "endpoint": auth.endpoint, "email": email},
            "collection": export_collection(path),
        }
