import hashlib
import html
import re
import unicodedata
from html.parser import HTMLParser

KANJI = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
RUBY_ANNOTATION = re.compile(r"([^\[\]]+)\[([^\[\]]+)\]")
SOUND = re.compile(r"\[sound:[^\]]+\]")
PARENTHETICAL = re.compile(r"\([^()]*\)")


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"br", "hr", "div", "p"}:
            self.parts.append(" ")


def plain_text(value: str) -> str:
    parser = PlainText()
    parser.feed(SOUND.sub("", value))
    return re.sub(r"\s+", " ", html.unescape("".join(parser.parts))).strip()


def normalize_reading(value: str) -> str:
    source = re.split(
        r"<!--\s*accent_start|<hr\b|<svg\b", value, maxsplit=1, flags=re.IGNORECASE
    )[0]
    text = plain_text(source)
    while PARENTHETICAL.search(text):
        text = PARENTHETICAL.sub("", text)
    text = unicodedata.normalize("NFC", text.strip())
    return "".join(
        chr(ord(char) - 96) if "ァ" <= char <= "ヶ" else char for char in text
    )


def normalize_spelling(value: str) -> str:
    text = plain_text(value)
    while PARENTHETICAL.search(text):
        text = PARENTHETICAL.sub("", text)
    return unicodedata.normalize("NFC", re.sub(r"\s+", " ", text).strip())


def word_id(spelling: str, reading: str) -> str:
    pair = f"{normalize_spelling(spelling)}\0{normalize_reading(reading)}"
    return hashlib.sha256(pair.encode("utf-8")).hexdigest()


def has_kanji(value: str) -> bool:
    return KANJI.search(value) is not None


def ruby_from_annotation(value: str, spelling: str) -> list[dict[str, str]] | None:
    if "[" not in value:
        return None
    source = plain_text(value)
    if not any(char.isspace() for char in spelling):
        source = re.sub(r"\s+", "", source)
    pieces: list[dict[str, str]] = []
    cursor = 0
    for match in RUBY_ANNOTATION.finditer(source):
        if match.start() > cursor:
            pieces.append({"text": source[cursor : match.start()]})
        annotated = match.group(1)
        first_kanji = KANJI.search(annotated)
        if first_kanji and first_kanji.start():
            pieces.append({"text": annotated[: first_kanji.start()]})
            annotated = annotated[first_kanji.start() :]
        pieces.append({"text": annotated, "reading": normalize_reading(match.group(2))})
        cursor = match.end()
    if cursor < len(source):
        pieces.append({"text": source[cursor:]})
    return pieces if "".join(piece["text"] for piece in pieces) == spelling else None


def reading_from_ruby(pieces: list[dict[str, str]]) -> str | None:
    reading = "".join(
        piece.get("reading", piece["text"] if not has_kanji(piece["text"]) else "")
        for piece in pieces
    )
    if any(has_kanji(piece["text"]) and "reading" not in piece for piece in pieces):
        return None
    return reading if reading and all(
        "ぁ" <= char <= "ゖ" or char in "ー・" for char in reading
    ) else None
