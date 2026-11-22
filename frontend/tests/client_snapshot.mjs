import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
import ts from "typescript";

globalThis.crypto ||= webcrypto;
globalThis.DOMParser = class {
  parseFromString(source) {
    return { body: { textContent: source.replace(/<[^>]+>/g, "").replaceAll("&amp;", "&") } };
  }
};

const dictionary = [
  { datasetVersion: "test", wordId: "dictionary-id", spelling: "転勤", reading: "てんきん",
    ruby: [{ text: "転", reading: "てん" }, { text: "勤", reading: "きん" }] },
];
globalThis.__kanjigraphCache = {
  dictionaryWords: {
    where() {
      return { equals(spelling) { return { async toArray() {
        return dictionary.filter((word) => word.spelling === spelling);
      } }; } };
    },
  },
};

const source = await readFile(new URL("../src/snapshot.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace('import { cache } from "./cache";', "const cache = globalThis.__kanjigraphCache;");
const { buildSnapshot, collectionNoteTypes, newDuplicateRecords, previewSnapshot, readingFromRuby, rubyFromAnnotation } =
  await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

const collection = {
  decks: [{ id: 1, name: "Study" }, { id: 2, name: "Study::Extra" }],
  noteTypes: {
    "1": [{ id: 3, name: "Words", fields: ["Word", "Reading", "Meaning"], count: 1, samples: [] }],
    "2": [{ id: 3, name: "Words", fields: ["Word", "Reading", "Meaning"], count: 1, samples: [] }],
  },
  studiedNotes: {
    "1": [{ id: "10", modelId: 3, fields: ["転勤", "転[てん]勤[きん]", "job transfer"] }],
    "2": [{ id: "11", modelId: 3, fields: ["転勤", "転[てん]勤[きん]", "transfer"] }],
  },
};
const config = {
  deckId: 1, includeChildren: true,
  mappings: { "3": { status: "configured", spelling: "Word", reading: "Reading", translation: "Meaning" } },
};

test("client builds a deduplicated studied-word snapshot with subdecks", async () => {
  const result = await buildSnapshot(collection, config, {}, "test");
  assert.equal(result.words.length, 1);
  assert.equal(result.words[0].wordId, "dictionary-id");
  assert.deepEqual(result.words[0].noteIds, ["10", "11"]);
  assert.deepEqual(result.words[0].translations, ["job transfer", "transfer"]);
  assert.deepEqual(result.unresolved, []);
  assert.equal(collectionNoteTypes(collection, 1, true)[0].count, 2);
});

test("preview preserves the original records in each duplicate group across card types", async () => {
  const otherType = { ...collection.noteTypes["2"][0], id: 4 };
  const otherNote = {
    ...collection.studiedNotes["2"][0],
    modelId: 4,
    fields: ["転勤", "転勤[てんきん]", "transfer"],
  };
  const example = {
    ...collection,
    noteTypes: { ...collection.noteTypes, "2": [otherType] },
    studiedNotes: {
      ...collection.studiedNotes,
      "2": [otherNote, collection.studiedNotes["1"][0]],
    },
  };
  const mapped = { ...config, mappings: { ...config.mappings, "4": config.mappings["3"] } };
  const preview = await previewSnapshot(example, mapped, {}, "test");
  assert.equal(preview.duplicateGroups.length, 1);
  const [{ wordId, records }] = preview.duplicateGroups;
  assert.equal(wordId, "dictionary-id");
  assert.deepEqual(records.map(({ noteId, noteTypeId, translations }) => ({ noteId, noteTypeId, translations })), [
    { noteId: "10", noteTypeId: 3, translations: ["job transfer"] },
    { noteId: "11", noteTypeId: 4, translations: ["transfer"] },
  ]);
  assert.deepEqual(records[1].ruby, [{ text: "転勤", reading: "てんきん" }]);
  const withoutSubdecks = await previewSnapshot(example, { ...mapped, includeChildren: false }, {}, "test");
  assert.deepEqual(withoutSubdecks.duplicateGroups, []);
});

test("sync detects newly duplicated records using both current and older snapshots", async () => {
  const single = await buildSnapshot(collection, { ...config, includeChildren: false }, {}, "test");
  const pair = await buildSnapshot(collection, config, {}, "test");
  assert.deepEqual(newDuplicateRecords(single, pair).map((record) => record.noteId), ["10", "11"]);

  const previous = { ...pair };
  delete previous.duplicateGroups;
  assert.deepEqual(newDuplicateRecords(previous, pair), []);

  const example = {
    ...collection,
    studiedNotes: {
      ...collection.studiedNotes,
      "2": [...collection.studiedNotes["2"], { ...collection.studiedNotes["2"][0], id: "12" }],
    },
  };
  const updated = await buildSnapshot(example, config, {}, "test");
  assert.deepEqual(newDuplicateRecords(previous, updated).map((record) => record.noteId), ["12"]);
  assert.deepEqual(updated.words[0].translations, ["job transfer", "transfer"]);
});

test("client parses Anki furigana and rejects incomplete annotation", () => {
  const ruby = rubyFromAnnotation("具体[ぐたい]的[てき]な例[れい]を教[おし]えて", "具体的な例を教えて");
  assert.equal(readingFromRuby(ruby), "ぐたいてきなれいをおしえて");
  assert.equal(readingFromRuby(rubyFromAnnotation("工[こう]場", "工場")), null);
});
