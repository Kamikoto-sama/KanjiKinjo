# KanjiKinjo

A web app that helps you remember Japanese vocabulary by finding connections between words you’ve already reviewed in Anki. When a kanji or reading looks familiar, you can see which other words in your deck use it.

- Automatically sync from AnkiWeb or import an Anki export manually.
- Search reviewed words by their Japanese spelling and see their readings with furigana.
- Explore words in your deck that share kanji, contain visually similar kanji, or have the same or similar readings.
- Open a word’s page directly from an Anki card.
- Offline use. Install as a web app in a supported browser and browse your last synced or imported deck offline after initial setup.

## Quick start

1. Open [KanjiKinjo](https://kanji.danteiru.space/).
2. Select **Sign in to AnkiWeb** to import and sync your collection, or **Choose file** to upload an `.apkg` or `.colpkg` with review history.
3. Under **Deck & fields**, choose a deck and decide whether to include its subdecks. For each note type you want to use, select **Word / spelling** and, if available, **Reading / furigana** and **Translation**. Select **Continue**.
4. Enter a Japanese spelling such as `転勤` in **Search by spelling**. Open a result to browse related words from your deck.

To jump to a word from Anki, open the KanjiKinjo menu and choose **Show card link template**. Copy the link for your note type and replace `PASTE_COPIED_LINK_HERE` in the example below. Add the resulting HTML to the card template for that note type.

```html
<a href="PASTE_COPIED_LINK_HERE">Explore related words</a>
```

Anki fills in the word fields when it renders the card.

## Which words appear?

KanjiKinjo uses words from your selected deck that contain at least one kanji and have at least one card you’ve answered in Anki. Mixed kanji and kana spellings such as `食べる` are included. Notes with the same spelling and reading appear as one word, with their Anki translations combined and duplicates removed.

On a word’s page, **All** shows each related word once. Use the other tabs to narrow the list.

- **Same kanji** shows words that share a kanji. Select a kanji in the current word to filter by that character, then choose a reading if multiple readings are available.
- **Lookalikes** shows words with visually similar kanji and displays the matching character pairs.
- **Same reading** shows words with identical readings and different spellings and translations.
- **Similar reading** shows words whose readings match after removing `う` and small `っ`, such as `交渉（こうしょう）` and `故障（こしょう）`.

## Run locally

Use Python 3.13 and Node.js 22.x (22.12 or later) with npm. Run the following commands from the repository root.

```sh
python3.13 -m venv server/.venv
server/.venv/bin/python -m pip install -r server/requirements.txt
npm ci --prefix frontend
```

### Dictionary

Download the source data and generate the dictionary in `data/dictionary/`.

```sh
python3.13 scripts/fetch_sources.py
python3.13 -m scripts.build_dictionary
```

### Development server

Start the frontend and API together.

```sh
./scripts/dev.sh
```

Open [http://localhost:5173](http://localhost:5173).

## Build and run

### Without Docker

After installing the dependencies and generating the dictionary, build the frontend and start the server. FastAPI serves both the built frontend and the API.

```sh
npm --prefix frontend run build
server/.venv/bin/uvicorn server.main:app --host 127.0.0.1 --port 8000
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

### With Docker

Install Docker with Buildx and generate the dictionary before building the image.

```sh
./scripts/build-container.sh kanjikinjo:local
docker run --rm --platform linux/amd64 -p 127.0.0.1:8000:8000 kanjikinjo:local
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

## Data and privacy

KanjiKinjo stores your deck data, settings, and AnkiWeb session key in your browser using IndexedDB. When you import a file, the server processes the uploaded package in a temporary directory and returns the extracted data to your browser. When you sign in to AnkiWeb, the KanjiKinjo server forwards your credentials to AnkiWeb. Sync only downloads data from AnkiWeb.

## Data sources and license

KanjiKinjo uses JMdict for spellings and readings, JmdictFurigana for furigana annotations, and Kanji Database for visually similar kanji. The generated dictionary data are licensed under CC BY-SA 4.0. See [NOTICE](NOTICE) for attribution.

The KanjiKinjo software is licensed under the PolyForm Noncommercial License 1.0.0. See [LICENSE](LICENSE).
