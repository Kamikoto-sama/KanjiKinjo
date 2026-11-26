import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

from server.collection import export_collection
from server.importer import import_package


class CollectionExportTests(unittest.TestCase):
    def test_exports_reviewed_and_unreviewed_notes_in_their_current_decks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "collection.anki2"
            connection = sqlite3.connect(path)
            connection.executescript("""
                CREATE TABLE col (decks TEXT, models TEXT);
                CREATE TABLE notes (id INTEGER, mid INTEGER, flds TEXT);
                CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER);
                CREATE TABLE revlog (cid INTEGER, type INTEGER);
            """)
            connection.execute("INSERT INTO col VALUES (?, ?)", (
                json.dumps({"1": {"id": 1, "name": "Study"}, "2": {"id": 2, "name": "Study::Extra"}}),
                json.dumps({"3": {"name": "Words", "flds": [{"name": "Word"}, {"name": "Meaning"}]}}),
            ))
            connection.executemany("INSERT INTO notes VALUES (?, ?, ?)", [
                (10, 3, "転勤\x1ftransfer"),
                (11, 3, "工場\x1ffactory"),
            ])
            connection.executemany("INSERT INTO cards VALUES (?, ?, ?)", [
                (20, 10, 1), (21, 11, 2), (22, 10, 1), (23, 10, 2),
            ])
            connection.executemany("INSERT INTO revlog VALUES (?, ?)", [(20, 1), (21, 4)])
            connection.commit()
            connection.close()

            result = export_collection(path)
            package = Path(directory) / "deck.apkg"
            with zipfile.ZipFile(package, "w") as archive:
                archive.write(path, "collection.anki2")
            imported = import_package(package)

        self.assertEqual([deck["name"] for deck in result["decks"]], ["Study", "Study::Extra"])
        self.assertEqual(result["studiedNotes"]["1"], [{
            "id": "10", "modelId": 3, "fields": ["転勤", "transfer"]
        }])
        self.assertEqual(result["studiedNotes"]["2"], [])
        self.assertEqual(result["unstudiedNotes"]["1"], [])
        self.assertEqual(result["unstudiedNotes"]["2"], [
            {"id": "10", "modelId": 3, "fields": ["転勤", "transfer"]},
            {"id": "11", "modelId": 3, "fields": ["工場", "factory"]},
        ])
        self.assertEqual(result["noteTypes"]["2"][0]["count"], 2)
        self.assertEqual(imported, result)


if __name__ == "__main__":
    unittest.main()
