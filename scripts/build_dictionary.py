import csv
import gzip
import hashlib
import io
import json
import re
import tarfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

from server.text import has_kanji, normalize_reading, normalize_spelling, word_id

from .fetch_sources import KANJIDIC2_URL

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "data" / "sources"
OUTPUT = ROOT / "data" / "dictionary"


def source_version() -> str:
    with gzip.open(SOURCES / "JMdict_e.gz", "rb") as source:
        header = source.read(100000).decode("utf-8")
    match = re.search(r"JMdict created: (\d{4}-\d{2}-\d{2})", header)
    if match is None:
        raise ValueError("JMdict source version is missing")
    return match.group(1)


def furigana_entries() -> dict[tuple[str, str], list[dict[str, str]]]:
    with tarfile.open(SOURCES / "JmdictFurigana.json.tar.gz", "r:gz") as archive:
        source = archive.extractfile("JmdictFurigana.json")
        entries = json.load(io.TextIOWrapper(source, encoding="utf-8-sig"))
    result = {}
    for entry in entries:
        spelling = normalize_spelling(entry["text"])
        reading = normalize_reading(entry["reading"])
        parts = [
            {
                "text": item["ruby"],
                **(
                    {"reading": normalize_reading(item["rt"])} if item.get("rt") else {}
                ),
            }
            for item in entry["furigana"]
        ]
        result[spelling, reading] = parts
    return result


def jmdict_words():
    with gzip.open(SOURCES / "JMdict_e.gz", "rb") as source:
        for _, element in ET.iterparse(source, events=("end",)):
            if element.tag != "entry":
                continue
            spellings = [
                item.text
                for item in element.findall("k_ele/keb")
                if item.text and has_kanji(item.text)
            ]
            for reading_element in element.findall("r_ele"):
                reading_text = reading_element.findtext("reb")
                if not reading_text:
                    continue
                restrictions = {
                    item.text for item in reading_element.findall("re_restr")
                }
                for spelling in spellings:
                    if not restrictions or spelling in restrictions:
                        yield (
                            normalize_spelling(spelling),
                            normalize_reading(reading_text),
                        )
            element.clear()


def similar_kanji() -> dict[str, list[str]]:
    result: dict[str, set[str]] = defaultdict(set)
    with (SOURCES / "similar-kanji.tsv").open(encoding="utf-8") as source:
        for row in csv.DictReader(source, delimiter="\t"):
            left, right = row["kanji"], row["similar"]
            result[left].add(right)
            result[right].add(left)
    return {key: sorted(values) for key, values in result.items()}


def kanji_meanings(path: Path) -> tuple[str, dict[str, list[str]]]:
    version = None
    entries = {}
    with gzip.open(path, "rb") as source:
        for _, element in ET.iterparse(source, events=("end",)):
            if element.tag == "header":
                version = element.findtext("database_version")
            if element.tag != "character":
                continue
            literal = element.findtext("literal")
            meanings = dict.fromkeys(
                meaning.text.strip()
                for meaning in element.findall("reading_meaning/rmgroup/meaning")
                if meaning.get("m_lang", "en") == "en"
                and meaning.text
                and meaning.text.strip()
            )
            if literal and meanings:
                entries[literal] = list(meanings)
            element.clear()
    if not version or not entries:
        raise ValueError("KANJIDIC2 source version or English meanings are missing")
    return version, entries


def write_part(name: str, kind: str, value: object) -> dict:
    path = OUTPUT / name
    with (
        path.open("wb") as file,
        gzip.GzipFile(fileobj=file, mode="wb", mtime=0) as compressed,
    ):
        compressed.write(
            json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
        )
    data = path.read_bytes()
    return {
        "path": name,
        "kind": kind,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def build() -> None:
    version = source_version()
    kanjidic_path = SOURCES / "kanjidic2.xml.gz"
    kanjidic_version, meanings = kanji_meanings(kanjidic_path)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    furigana = furigana_entries()
    seen: set[tuple[str, str]] = set()
    files = []
    chunk = []
    count = 0
    for spelling, reading in jmdict_words():
        identity = word_id(spelling, reading)
        ruby = furigana.get((spelling, reading))
        if (spelling, reading) in seen:
            continue
        seen.add((spelling, reading))
        chunk.append(
            {"wordId": identity, "spelling": spelling, "reading": reading, "ruby": ruby}
        )
        count += 1
        if len(chunk) >= 5000:
            files.append(write_part(f"words-{len(files):03d}.json.gz", "words", chunk))
            chunk = []
    if chunk:
        files.append(write_part(f"words-{len(files):03d}.json.gz", "words", chunk))
    files.append(write_part("similar.json.gz", "similar", similar_kanji()))
    files.append(write_part("kanji-meanings.json.gz", "kanji-meanings", meanings))
    manifest = {
        "schemaVersion": 1,
        "datasetVersion": version,
        "createdAt": datetime.now(UTC).isoformat(),
        "wordCount": count,
        "sources": [
            {
                "name": "JMdict",
                "version": version,
                "url": "https://www.edrdg.org/pub/Nihongo/JMdict_e.gz",
                "license": "EDRDG / CC BY-SA 4.0",
                "sha256": hashlib.sha256(
                    (SOURCES / "JMdict_e.gz").read_bytes()
                ).hexdigest(),
            },
            {
                "name": "JmdictFurigana",
                "version": "2.3.1+2026-10-25",
                "url": "https://github.com/Doublevil/JmdictFurigana",
                "license": "MIT and source data licenses",
                "sha256": hashlib.sha256(
                    (SOURCES / "JmdictFurigana.json.tar.gz").read_bytes()
                ).hexdigest(),
            },
            {
                "name": "KANJIDIC2",
                "version": kanjidic_version,
                "url": KANJIDIC2_URL,
                "license": "EDRDG / CC BY-SA 4.0",
                "sha256": hashlib.sha256(kanjidic_path.read_bytes()).hexdigest(),
            },
            {
                "name": "Kanji Database similar-kanji",
                "version": version,
                "url": "https://kanji-db.com/en/data",
                "license": "CC BY-SA 4.0",
                "sha256": hashlib.sha256(
                    (SOURCES / "similar-kanji.tsv").read_bytes()
                ).hexdigest(),
            },
        ],
        "files": files,
    }
    (OUTPUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Built {count} words in {len(files)} files")


if __name__ == "__main__":
    build()
