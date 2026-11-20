import sqlite3
import tempfile
import zipfile
from pathlib import Path

import zstandard

from .collection import export_collection

MAX_COLLECTION_BYTES = 512 * 1024 * 1024


class CollectionTooLarge(ValueError):
    pass


def copy_collection(source, destination) -> None:
    size = 0
    while chunk := source.read(1024 * 1024):
        size += len(chunk)
        if size > MAX_COLLECTION_BYTES:
            raise CollectionTooLarge("Anki collection exceeds the 512 MiB limit")
        destination.write(chunk)


def import_package(package: Path) -> dict:
    with zipfile.ZipFile(package) as archive:
        candidates = [
            name
            for name in ("collection.anki21b", "collection.anki21", "collection.anki2")
            if name in archive.namelist()
        ]
        if not candidates:
            raise ValueError("This package contains no Anki collection")
        name = candidates[0]
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "collection.anki2"
            with archive.open(name) as source, target.open("wb") as destination:
                if name.endswith("21b"):
                    with zstandard.ZstdDecompressor().stream_reader(source) as decoded:
                        copy_collection(decoded, destination)
                else:
                    copy_collection(source, destination)
            connection = sqlite3.connect(target)
            try:
                required = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    )
                }
                if not {"col", "notes", "cards", "revlog"}.issubset(required):
                    raise ValueError(
                        "This package has no review history; studied words cannot be determined"
                    )
                if (
                    connection.execute(
                        "SELECT COUNT(*) FROM revlog WHERE type IN (0, 1, 2, 3)"
                    ).fetchone()[0]
                    == 0
                ):
                    raise ValueError(
                        "This package has no recorded answers; studied words cannot be determined"
                    )
            finally:
                connection.close()
            return export_collection(target)
