import json
from functools import lru_cache
from pathlib import Path

DICTIONARY = Path(__file__).resolve().parent.parent / "data" / "dictionary"


@lru_cache(maxsize=1)
def manifest() -> dict:
    path = DICTIONARY / "manifest.json"
    return (
        json.loads(path.read_text())
        if path.exists()
        else {
            "schemaVersion": 1,
            "datasetVersion": "unavailable",
            "files": [],
            "sources": [],
        }
    )


