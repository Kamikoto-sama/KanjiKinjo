import assert from "node:assert/strict";
import {test} from "@playwright/test";
import {webcrypto} from "node:crypto";
import {
    buildSnapshot,
    collectionNoteTypes,
    newDuplicateRecords,
    prepareSnapshot,
    readingFromRuby,
    rubyFromAnnotation,
} from "../src/snapshot.ts";

globalThis.crypto ||= webcrypto;
globalThis.DOMParser = class {
  parseFromString(source) {
    return {
      body: {
        textContent: source.replace(/<[^>]+>/g, "").replaceAll("&amp;", "&"),
      },
    };
  }
};

const dictionary = [
  {
    datasetVersion: "test",
    wordId: "dictionary-id",
    spelling: "転勤",
    reading: "てんきん",
    ruby: [
      { text: "転", reading: "てん" },
      { text: "勤", reading: "きん" },
    ],
  },
];
async function lookup(spelling, version) {
  return dictionary.filter(
    (word) => word.spelling === spelling && word.datasetVersion === version,
  );
}

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
  const lookups = [];
  const result = await buildSnapshot(collection, config, {}, "test", (spelling, version) => {
    lookups.push([spelling, version]);
    return lookup(spelling, version);
  });
  assert.deepEqual(lookups, [["転勤", "test"]]);
  assert.equal(result.words.length, 1);
  assert.equal(result.words[0].wordId, "dictionary-id");
  assert.deepEqual(result.words[0].noteIds, ["10", "11"]);
  assert.deepEqual(result.words[0].translations, ["job transfer", "transfer"]);
  assert.deepEqual(result.unresolved, []);
  assert.equal(collectionNoteTypes(collection, 1, true)[0].count, 2);
});

test("full and studied views share word identity and classify notes within the selected decks", async () => {
    const shared = {
        id: "12", modelId: 3, fields: ["工場", "工[こう]場[じょう]", "factory"],
    };
    const fresh = {
        id: "13", modelId: 3, fields: ["工事", "工[こう]事[じ]", "construction"],
    };
    const duplicate = {
        id: "14", modelId: 3, fields: ["転勤", "転勤[てんきん]", "relocation"],
    };
    const unresolved = {
        id: "15", modelId: 3, fields: ["会社", "", "company"],
    };
    const mixed = {
        ...collection,
        studiedNotes: {...collection.studiedNotes, "2": [...collection.studiedNotes["2"], shared]},
        unstudiedNotes: {"1": [shared, duplicate, unresolved], "2": [fresh]},
    };

    const {snapshot, preview, previewIncludingUnstudied} = await prepareSnapshot(mixed, config, {}, "test", lookup);
    const transfer = snapshot.words.find((word) => word.wordId === "dictionary-id");
    const fullTransfer = snapshot.includingUnstudied.words.find((word) => word.wordId === transfer.wordId);
    assert.deepEqual(transfer.translations, ["job transfer", "transfer"]);
    assert.deepEqual(fullTransfer.translations, ["job transfer", "transfer", "relocation"]);
    assert.equal(fullTransfer.unstudied, undefined);
    assert.deepEqual(fullTransfer.ruby, transfer.ruby);
    assert.deepEqual(snapshot.includingUnstudied.words.find((word) => word.spelling === "工場").noteIds, ["12"]);
    assert.deepEqual(snapshot.includingUnstudied.words.filter((word) => word.unstudied).map((word) => word.spelling), ["工事"]);
    assert.deepEqual(preview.unresolved, []);
    assert.deepEqual(previewIncludingUnstudied.unresolved.map((word) => [word.noteId, word.unstudied]), [["15", true]]);
    assert.equal(preview.duplicateGroups[0].records.length, 2);
    assert.equal(previewIncludingUnstudied.duplicateGroups[0].records[2].unstudied, true);

    const parentOnly = await buildSnapshot(mixed, {...config, includeChildren: false}, {}, "test", lookup);
    assert.equal(parentOnly.words.some((word) => word.spelling === "工場"), false);
    assert.equal(parentOnly.includingUnstudied.words.find((word) => word.spelling === "工場").unstudied, true);
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
  const { preview } = await prepareSnapshot(example, mapped, {}, "test", lookup);
  assert.equal(preview.duplicateGroups.length, 1);
  const [{ wordId, records }] = preview.duplicateGroups;
  assert.equal(wordId, "dictionary-id");
  assert.deepEqual(records.map(({ noteId, noteTypeId, translations }) => ({ noteId, noteTypeId, translations })), [
    { noteId: "10", noteTypeId: 3, translations: ["job transfer"] },
    { noteId: "11", noteTypeId: 4, translations: ["transfer"] },
  ]);
  assert.deepEqual(records[1].ruby, [{ text: "転勤", reading: "てんきん" }]);
  const { preview: withoutSubdecks } = await prepareSnapshot(example, { ...mapped, includeChildren: false }, {}, "test", lookup);
  assert.deepEqual(withoutSubdecks.duplicateGroups, []);
});

test("sync detects newly duplicated records using both current and older snapshots", async () => {
  const single = await buildSnapshot(collection, { ...config, includeChildren: false }, {}, "test", lookup);
  const pair = await buildSnapshot(collection, config, {}, "test", lookup);
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
  const updated = await buildSnapshot(example, config, {}, "test", lookup);
  assert.deepEqual(newDuplicateRecords(previous, updated).map((record) => record.noteId), ["12"]);
  assert.deepEqual(updated.words[0].translations, ["job transfer", "transfer"]);
});

test("client parses Anki furigana and rejects incomplete annotation", () => {
  const ruby = rubyFromAnnotation("具体[ぐたい]的[てき]な例[れい]を教[おし]えて", "具体的な例を教えて");
  assert.equal(readingFromRuby(ruby), "ぐたいてきなれいをおしえて");
  assert.equal(readingFromRuby(rubyFromAnnotation("工[こう]場", "工場")), null);
});
