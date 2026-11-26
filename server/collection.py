import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from .text import has_kanji, plain_text


@dataclass(frozen=True)
class Deck:
    id: int
    name: str


@dataclass(frozen=True)
class NoteType:
    id: int
    name: str
    fields: list[str]
    count: int


@dataclass(frozen=True)
class CollectionNote:
    id: int
    model_id: int
    fields: list[str]
    studied: bool


class CollectionReader:
    def __init__(self, path: Path):
        self.connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        self.connection.create_collation(
            "unicase",
            lambda left, right: (
                (left.casefold() > right.casefold())
                - (left.casefold() < right.casefold())
            ),
        )
        self.connection.row_factory = sqlite3.Row
        row = self.connection.execute("SELECT decks, models FROM col").fetchone()
        if row["decks"] and row["models"]:
            self.decks = [
                Deck(int(item["id"]), item["name"])
                for item in json.loads(row["decks"]).values()
            ]
            self.models = json.loads(row["models"])
        else:
            self.decks = [
                Deck(int(item["id"]), item["name"])
                for item in self.connection.execute("SELECT id, name FROM decks")
            ]
            fields: dict[str, list[dict[str, str]]] = {}
            for item in self.connection.execute(
                "SELECT ntid, name FROM fields ORDER BY ntid, ord"
            ):
                fields.setdefault(str(item["ntid"]), []).append({"name": item["name"]})
            self.models = {
                str(item["id"]): {
                    "name": item["name"],
                    "flds": fields.get(str(item["id"]), []),
                }
                for item in self.connection.execute("SELECT id, name FROM notetypes")
            }

    def close(self) -> None:
        self.connection.close()

    def deck_ids(self, deck_id: int, include_children: bool) -> list[int]:
        deck = next((item for item in self.decks if item.id == deck_id), None)
        if deck is None:
            raise ValueError("Deck not found")
        return [
            item.id
            for item in self.decks
            if item.id == deck_id
            or include_children
            and item.name.startswith(deck.name + "::")
        ]

    def note_types(self, deck_id: int, include_children: bool) -> list[NoteType]:
        ids = self.deck_ids(deck_id, include_children)
        placeholders = ",".join("?" for _ in ids)
        rows = self.connection.execute(
            f"SELECT n.mid, COUNT(DISTINCT n.id) AS count FROM notes n JOIN cards c ON c.nid = n.id WHERE c.did IN ({placeholders}) GROUP BY n.mid",
            ids,
        ).fetchall()
        return [
            NoteType(
                int(row["mid"]),
                self.models[str(row["mid"])]["name"],
                [field["name"] for field in self.models[str(row["mid"])]["flds"]],
                row["count"],
            )
            for row in rows
        ]

    def note_samples(
        self, deck_id: int, include_children: bool, model_id: int
    ) -> list[dict[str, str]]:
        ids = self.deck_ids(deck_id, include_children)
        placeholders = ",".join("?" for _ in ids)
        fields = [
            field["name"] for field in self.models[str(model_id)]["flds"]
        ]
        rows = self.connection.execute(
            f"SELECT DISTINCT n.id, n.flds FROM notes n JOIN cards c ON c.nid = n.id WHERE c.did IN ({placeholders}) AND n.mid = ? LIMIT 200",
            [*ids, model_id],
        )
        preferred: list[dict[str, str]] = []
        fallback: list[dict[str, str]] = []
        for row in rows:
            sample = {
                name: plain_text(value)[:160]
                for name, value in zip(fields, row["flds"].split("\x1f"))
            }
            if not any(sample.values()):
                continue
            if fields and has_kanji(sample.get(fields[0], "")):
                preferred.append(sample)
            else:
                fallback.append(sample)
            if len(preferred) == 3:
                break
        return (preferred + fallback)[:3]

    def notes(self, deck_id: int) -> list[CollectionNote]:
        rows = self.connection.execute(
            """
            SELECT n.id, n.mid, n.flds, deck_notes.studied
            FROM (
                SELECT c.nid, MAX(EXISTS (
                    SELECT 1 FROM revlog r WHERE r.cid = c.id AND r.type IN (0, 1, 2, 3)
                )) AS studied
                FROM cards c
                WHERE c.did = ?
                GROUP BY c.nid
            ) deck_notes
            JOIN notes n ON n.id = deck_notes.nid
            """,
            (deck_id,),
        )
        return [
            CollectionNote(
                int(row["id"]), int(row["mid"]), row["flds"].split("\x1f"), bool(row["studied"])
            )
            for row in rows
        ]


def export_collection(path: Path) -> dict:
    """Extract deck metadata and note fields without retaining the collection."""
    reader = CollectionReader(path)
    try:
        decks = [{"id": deck.id, "name": deck.name} for deck in reader.decks]
        note_types: dict[str, list[dict]] = {}
        studied_notes: dict[str, list[dict]] = {}
        unstudied_notes: dict[str, list[dict]] = {}
        for deck in reader.decks:
            key = str(deck.id)
            types = reader.note_types(deck.id, False)
            note_types[key] = [
                {
                    "id": item.id,
                    "name": item.name,
                    "fields": item.fields,
                    "count": item.count,
                    "samples": reader.note_samples(deck.id, False, item.id),
                }
                for item in types
            ]
            studied_notes[key] = []
            unstudied_notes[key] = []
            for note in reader.notes(deck.id):
                notes = studied_notes if note.studied else unstudied_notes
                notes[key].append(
                    {"id": str(note.id), "modelId": note.model_id, "fields": note.fields}
                )
        return {
            "decks": decks,
            "noteTypes": note_types,
            "studiedNotes": studied_notes,
            "unstudiedNotes": unstudied_notes,
        }
    finally:
        reader.close()
