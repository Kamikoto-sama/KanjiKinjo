"""Stateless, download-only AnkiWeb sync."""

import json
import re
import sys
import tempfile
from contextlib import closing, contextmanager
from http import HTTPStatus
from http.client import HTTPResponse, HTTPSConnection
from pathlib import Path
from uuid import uuid4

from anki.buildinfo import buildhash, version
from zstandard import ZstdCompressor, ZstdDecompressor

from .collection import export_collection

DEFAULT_ENDPOINT = "https://sync.ankiweb.net/"
SYNC_ENDPOINT = re.compile(
    r"https://(sync[0-9]*\.ankiweb\.net)(?::443)?/?", re.IGNORECASE | re.ASCII
)
SYNC_VERSION = 11
CLIENT_VERSION = f"anki,{version} ({buildhash}),{sys.platform}"
MAX_METADATA_BYTES = 64 * 1024


def normalize_endpoint(endpoint: str) -> str:
    if not endpoint:
        return DEFAULT_ENDPOINT
    match = SYNC_ENDPOINT.fullmatch(endpoint)
    if match is None:
        raise ValueError("Unsupported AnkiWeb sync endpoint")
    return f"https://{match[1].lower()}/"


@contextmanager
def _request(endpoint: str, method: str, hkey: str, payload: dict):
    data = ZstdCompressor().compress(json.dumps(payload).encode())
    headers = {
        "Content-Type": "application/octet-stream",
        "anki-sync": json.dumps({"v": SYNC_VERSION, "k": hkey, "c": CLIENT_VERSION, "s": uuid4().hex[:8]}),
    }
    for redirects in range(2):
        endpoint = normalize_endpoint(endpoint)
        host = endpoint.removeprefix("https://").removesuffix("/")
        with closing(HTTPSConnection(host, timeout=30)) as connection:
            connection.request("POST", f"/sync/{method}", data, headers)
            with connection.getresponse() as response:
                if response.status == HTTPStatus.OK:
                    yield endpoint, response
                    return
                if response.status == HTTPStatus.PERMANENT_REDIRECT:
                    endpoint = response.getheader("Location")
                    if redirects or not endpoint:
                        raise RuntimeError("Invalid AnkiWeb sync redirect")
                    continue
                if response.status == HTTPStatus.FORBIDDEN:
                    raise RuntimeError("AnkiWeb rejected the credentials or session key")
                raise RuntimeError(f"AnkiWeb sync request failed (HTTP {response.status})")


def _response_size(response: HTTPResponse) -> int:
    size = response.getheader("anki-original-size", "")
    if not re.fullmatch(r"[0-9]{1,10}", size) or int(size) > 2**32 - 1:
        raise RuntimeError("Invalid AnkiWeb response size")
    return int(size)


def _read_json(response: HTTPResponse) -> dict:
    size = _response_size(response)
    if size > MAX_METADATA_BYTES:
        raise RuntimeError("AnkiWeb metadata response is too large")
    with ZstdDecompressor().stream_reader(response, closefd=False) as reader:
        body = reader.read(size + 1)
    if len(body) != size:
        raise RuntimeError("Unexpected AnkiWeb response size")
    return json.loads(body)


def _write_collection(response: HTTPResponse, path: Path) -> None:
    remaining = _response_size(response)
    with ZstdDecompressor().stream_reader(response, closefd=False) as reader, path.open("wb") as file:
        while chunk := reader.read(min(1024 * 1024, remaining + 1)):
            remaining -= len(chunk)
            if remaining < 0:
                break
            file.write(chunk)
    if remaining != 0:
        raise RuntimeError("Unexpected AnkiWeb collection size")


def login(username: str, password: str) -> dict:
    with _request(DEFAULT_ENDPOINT, "hostKey", "", {"u": username, "p": password}) as (endpoint, response):
        hkey = _read_json(response)["key"]
    try:
        return sync(hkey, endpoint, username)
    except Exception as error:
        raise RuntimeError(
            f"AnkiWeb sign-in succeeded, but collection download failed: {error}"
        ) from error


def sync(hkey: str, endpoint: str, email: str) -> dict:
    metadata_request = {"v": SYNC_VERSION, "cv": CLIENT_VERSION}
    with _request(endpoint, "meta", hkey, metadata_request) as (sync_endpoint, response):
        metadata = _read_json(response)
    if not metadata["cont"]:
        raise RuntimeError(metadata["msg"] or "AnkiWeb stopped the sync")

    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "collection.anki2"
        with _request(sync_endpoint, "download", hkey, {}) as (download_endpoint, response):
            _write_collection(response, path)
        return {
            "auth": {"hkey": hkey, "endpoint": download_endpoint, "email": email},
            "collection": export_collection(path),
        }
