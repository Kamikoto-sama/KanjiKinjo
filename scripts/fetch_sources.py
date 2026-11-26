import hashlib
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "data" / "sources"
KANJIDIC2_URL = "https://www.edrdg.org/kanjidic/kanjidic2.xml.gz"
SOURCES = {
    "JMdict_e.gz": "https://www.edrdg.org/pub/Nihongo/JMdict_e.gz",
    "JmdictFurigana.json.tar.gz": "https://github.com/Doublevil/JmdictFurigana/releases/download/2.3.1%2B2026-10-25/JmdictFurigana.json.tar.gz",
    "kanjidic2.xml.gz": KANJIDIC2_URL,
    "similar-kanji.tsv": "https://raw.githubusercontent.com/uball/kanji-db-data/main/data/similar-kanji.tsv",
}


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        path = ROOT / name
        if not path.exists():
            temporary = path.with_suffix(path.suffix + ".tmp")
            with (
                urllib.request.urlopen(url, timeout=120) as response,
                temporary.open("wb") as target,
            ):
                while chunk := response.read(1024 * 1024):
                    target.write(chunk)
            temporary.replace(path)
        print(name, hashlib.sha256(path.read_bytes()).hexdigest())


if __name__ == "__main__":
    main()
