import unittest

from server.text import reading_from_ruby, ruby_from_annotation


class FuriganaReadingTests(unittest.TestCase):
    def test_derives_reading_with_kana_between_kanji(self):
        spelling = "具体的な例を教えて"
        ruby = ruby_from_annotation(
            "具体[ぐたい]的[てき]な例[れい]を教[おし]えて", spelling
        )
        self.assertIsNotNone(ruby)
        self.assertEqual(reading_from_ruby(ruby), "ぐたいてきなれいをおしえて")
        self.assertEqual(ruby[2], {"text": "な"})

    def test_rejects_unannotated_kanji(self):
        ruby = ruby_from_annotation("工[こう]場", "工場")
        self.assertIsNone(reading_from_ruby(ruby))


if __name__ == "__main__":
    unittest.main()
