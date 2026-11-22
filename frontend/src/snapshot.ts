import type { CollectionData, Config, Correction, DuplicateGroup, DuplicateRecord, NoteType, Preview, RubyPart, Snapshot, StudiedNote, UnresolvedWord, Word } from "./types";

type DictionaryLookup = (
  spelling: string,
  datasetVersion: string,
) => Promise<Pick<Word, "wordId" | "reading" | "ruby">[]>;

const kanji = /[\u3400-\u9fff\uf900-\ufaff]/u;
const kana = /^[ぁ-ゖー・]+$/u;

function plainText(value: string): string {
  const source = value.replace(/\[sound:[^\]]+\]/g, "").replace(/<(br|hr|div|p)\b[^>]*>/gi, " ");
  return new DOMParser().parseFromString(source, "text/html").body.textContent?.replace(/\s+/g, " ").trim() || "";
}

function withoutHints(value: string): string {
  let next = value;
  while (/\([^()]*\)/.test(next)) next = next.replace(/\([^()]*\)/g, "");
  return next;
}

export function normalizeSpelling(value: string): string {
  return withoutHints(plainText(value)).normalize("NFC").trim();
}

export function normalizeReading(value: string): string {
  const source = value.split(/<!--\s*accent_start|<hr\b|<svg\b/i, 1)[0];
  return [...withoutHints(plainText(source)).normalize("NFC")]
    .map((char) => char >= "ァ" && char <= "ヶ" ? String.fromCharCode(char.charCodeAt(0) - 96) : char)
    .join("").trim();
}

export function rubyFromAnnotation(value: string, spelling: string): RubyPart[] | null {
  if (!value.includes("[")) return null;
  let source = plainText(value);
  if (!/\s/.test(spelling)) source = source.replace(/\s+/g, "");
  const parts: RubyPart[] = [];
  let cursor = 0;
  for (const match of source.matchAll(/([^\[\]]+)\[([^\[\]]+)\]/g)) {
    const start = match.index || 0;
    if (start > cursor) parts.push({ text: source.slice(cursor, start) });
    let annotated = match[1];
    const first = annotated.search(kanji);
    if (first > 0) {
      parts.push({ text: annotated.slice(0, first) });
      annotated = annotated.slice(first);
    }
    parts.push({ text: annotated, reading: normalizeReading(match[2]) });
    cursor = start + match[0].length;
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor) });
  return parts.map((part) => part.text).join("") === spelling ? parts : null;
}

export function readingFromRuby(parts: RubyPart[]): string | null {
  if (parts.some((part) => kanji.test(part.text) && !part.reading)) return null;
  const reading = parts.map((part) => part.reading ?? part.text).join("");
  return reading && kana.test(reading) ? reading : null;
}

async function wordId(spelling: string, reading: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${spelling}\0${reading}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function deckIds(collection: CollectionData, config: Config): number[] {
  const selected = collection.decks.find((deck) => deck.id === config.deckId);
  if (!selected) throw new Error("Deck not found");
  return collection.decks.filter((deck) => deck.id === selected.id ||
    config.includeChildren && deck.name.startsWith(`${selected.name}::`)).map((deck) => deck.id);
}

export function collectionDecks(collection: CollectionData) {
  return [...collection.decks].sort((a, b) => a.name.localeCompare(b.name));
}

export function collectionNoteTypes(collection: CollectionData, deckId: number, includeChildren: boolean): NoteType[] {
  const ids = deckIds(collection, { deckId, includeChildren, mappings: {} });
  const merged = new Map<number, NoteType>();
  for (const id of ids) for (const item of collection.noteTypes[String(id)] || []) {
    const prior = merged.get(item.id);
    merged.set(item.id, prior ? {
      ...prior,
      count: prior.count + item.count,
      samples: [...prior.samples, ...item.samples].slice(0, 3),
    } : { ...item });
  }
  return [...merged.values()];
}

function studiedNotes(collection: CollectionData, config: Config): StudiedNote[] {
  const notes = new Map<string, StudiedNote>();
  for (const id of deckIds(collection, config))
    for (const note of collection.studiedNotes[String(id)] || []) notes.set(note.id, note);
  return [...notes.values()];
}

export async function buildSnapshot(
  collection: CollectionData,
  config: Config,
  corrections: Record<string, Correction>,
  datasetVersion: string,
  lookup: DictionaryLookup,
): Promise<Snapshot> {
  const deck = collection.decks.find((item) => item.id === config.deckId);
  if (!deck) throw new Error("Deck not found");
  const types = new Map(collectionNoteTypes(collection, config.deckId, config.includeChildren).map((item) => [item.id, item]));
  const recordsByWord = new Map<string, DuplicateRecord[]>();
  const unresolved: UnresolvedWord[] = [];
  const dictionary = new Map<string, Awaited<ReturnType<DictionaryLookup>>>();
  for (const note of studiedNotes(collection, config)) {
    const type = types.get(note.modelId);
    const mapping = config.mappings[String(note.modelId)];
    if (!type || mapping?.status !== "configured") continue;
    const fields = Object.fromEntries(type.fields.map((name, index) => [name, note.fields[index] || ""]));
    const correction = corrections[note.id];
    const spelling = normalizeSpelling(correction?.spelling || fields[mapping.spelling] || "");
    if (!kanji.test(spelling)) continue;
    const translation = plainText(fields[mapping.translation] || "");
    const sourceReading = correction?.reading || (mapping.reading ? fields[mapping.reading] : "") || "";
    const sourceRuby = rubyFromAnnotation(sourceReading, spelling) ||
      Object.values(fields).map((value) => rubyFromAnnotation(value, spelling)).find(Boolean) || null;
    let reading = sourceReading.includes("[") && sourceRuby ? readingFromRuby(sourceRuby) || "" : normalizeReading(sourceReading);
    if (!reading && sourceRuby) reading = readingFromRuby(sourceRuby) || "";
    let entries = dictionary.get(spelling);
    if (!entries) {
      entries = await lookup(spelling, datasetVersion);
      dictionary.set(spelling, entries);
    }
    const matches = reading
      ? entries.filter((item) => item.reading === reading)
      : entries;
    if (!reading) {
      if (matches.length !== 1) {
        unresolved.push({ noteId: note.id, noteTypeId: note.modelId, spelling,
          reason: matches.length ? "ambiguousReading" : "missingReading" });
        continue;
      }
      reading = matches[0].reading;
    }
    if (!kana.test(reading)) {
      unresolved.push({ noteId: note.id, noteTypeId: note.modelId, spelling, reason: "missingReading" });
      continue;
    }
    const ruby = rubyFromAnnotation(correction?.ruby || "", spelling) || sourceRuby || matches[0]?.ruby || null;
    if (!ruby) {
      unresolved.push({ noteId: note.id, noteTypeId: note.modelId, spelling, reading, reason: "needsRuby" });
      continue;
    }
    const identity = matches[0]?.wordId || await wordId(spelling, reading);
    const record: DuplicateRecord = {
      noteId: note.id, noteTypeId: note.modelId, spelling, reading, ruby,
      translations: translation ? [translation] : [],
      match: correction ? "custom" : matches.length ? "dictionary" : "custom",
    };
    const records = recordsByWord.get(identity);
    if (records) records.push(record);
    else recordsByWord.set(identity, [record]);
  }
  const words: Word[] = [];
  const duplicateGroups: DuplicateGroup[] = [];
  const sortedGroups = [...recordsByWord].sort(([, [a]], [, [b]]) => a.spelling.localeCompare(b.spelling));
  for (const [wordId, records] of sortedGroups) {
    const { spelling, reading, ruby, match } = records[0];
    words.push({
      wordId, spelling, reading, ruby, match,
      noteIds: records.map((record) => record.noteId),
      translations: [...new Set(records.flatMap((record) => record.translations))],
    });
    if (records.length > 1) duplicateGroups.push({ wordId, records });
  }
  return {
    schemaVersion: 1, snapshotVersion: crypto.randomUUID(), datasetVersion,
    deck: { id: deck.id, name: deck.name, includeChildren: config.includeChildren },
    syncedAt: new Date().toISOString(),
    words, unresolved, duplicateGroups,
  };
}

export function newDuplicateRecords(previous: Snapshot | null, next: Snapshot | null): DuplicateRecord[] {
  const previousGroups = new Map(previous?.words
    .filter((word) => word.noteIds.length > 1)
    .map((word) => [word.wordId, new Set(word.noteIds)]));
  return (next?.duplicateGroups ?? []).flatMap(({ wordId, records }) => {
    const previousIds = previousGroups.get(wordId);
    return records.filter((record) => !previousIds?.has(record.noteId));
  });
}

export async function prepareSnapshot(
  collection: CollectionData,
  config: Config,
  corrections: Record<string, Correction>,
  datasetVersion: string,
  lookup: DictionaryLookup,
): Promise<{ snapshot: Snapshot; preview: Preview }> {
  const snapshot = await buildSnapshot(
    collection,
    config,
    corrections,
    datasetVersion,
    lookup,
  );
  const noteTypes = new Map(
    studiedNotes(collection, config).map((note) => [
      note.id,
      String(note.modelId),
    ]),
  );
  const wordsByType: Record<string, Word[]> = Object.fromEntries(
    collectionNoteTypes(collection, config.deckId, config.includeChildren).map(
      (item) => [String(item.id), []],
    ),
  );
  for (const word of snapshot.words)
    for (const typeId of new Set(word.noteIds.map((id) => noteTypes.get(id)))) {
      if (typeId && wordsByType[typeId] && wordsByType[typeId].length < 30)
        wordsByType[typeId].push(word);
    }
  return {
    snapshot,
    preview: {
      wordsByType,
      unresolved: snapshot.unresolved,
      duplicateGroups: snapshot.duplicateGroups ?? [],
    },
  };
}

export function validateCorrection(spellingInput: string, readingInput: string, rubyInput: string): Correction {
  const spelling = normalizeSpelling(spellingInput);
  let reading = normalizeReading(readingInput);
  const ruby = rubyFromAnnotation(rubyInput, spelling);
  const derived = ruby && readingFromRuby(ruby);
  if (!kanji.test(spelling) || !derived)
    throw new Error("Enter a kanji word and complete furigana such as 工[こう]場[じょう]");
  if (!reading) reading = derived;
  else if (reading !== derived) throw new Error("Reading must match the furigana");
  if (!kana.test(reading)) throw new Error("Reading must contain kana only");
  return { spelling, reading, ruby: rubyInput };
}
