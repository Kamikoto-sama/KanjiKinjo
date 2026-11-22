import Dexie, { type Table } from "dexie";
import type { DictionaryManifest } from "./api";
import type { AnkiAuth, CollectionData, Config, Correction, Snapshot } from "./types";

type StoredValue = { key: string; value: unknown };
type DictionaryWord = {
  datasetVersion: string;
  wordId: string;
  spelling: string;
  reading: string;
  ruby: { text: string; reading?: string }[] | null;
};

class Cache extends Dexie {
  values!: Table<StoredValue, string>;
  dictionaryWords!: Table<DictionaryWord, string>;

  constructor() {
    super("KanjiGraph");
    this.version(1).stores({
      values: "key",
      dictionaryWords: "[datasetVersion+wordId],datasetVersion,spelling",
    });
  }
}

export const cache = new Cache();

export async function cachedSnapshot(): Promise<Snapshot | null> {
  return (
    ((await cache.values.get("snapshot"))?.value as Snapshot | null) ?? null
  );
}

export async function localState() {
  const rows = await cache.values.bulkGet(["collection", "auth", "config", "snapshot", "corrections"]);
  return {
    collection: (rows[0]?.value as CollectionData | undefined) ?? null,
    auth: (rows[1]?.value as AnkiAuth | undefined) ?? null,
    config: (rows[2]?.value as Config | undefined) ?? null,
    snapshot: (rows[3]?.value as Snapshot | undefined) ?? null,
    corrections: (rows[4]?.value as Record<string, Correction> | undefined) ?? {},
  };
}

export async function replaceCollection(collection: CollectionData, auth: AnkiAuth | null): Promise<void> {
  await cache.transaction("rw", cache.values, async () => {
    await cache.values.bulkDelete(["collection", "auth", "config", "snapshot", "corrections"]);
    await cache.values.put({ key: "collection", value: collection });
    if (auth) await cache.values.put({ key: "auth", value: auth });
  });
}

export async function saveSyncedCollection(collection: CollectionData, auth: AnkiAuth, snapshot: Snapshot | null): Promise<Snapshot | null> {
  return cache.transaction("rw", cache.values, async () => {
    const previousSnapshot = await cachedSnapshot();
    await cache.values.bulkPut([
      { key: "collection", value: collection },
      { key: "auth", value: auth },
      ...(snapshot ? [{ key: "snapshot", value: snapshot }] : []),
    ]);
    return previousSnapshot;
  });
}

export async function saveConfigAndSnapshot(config: Config, snapshot: Snapshot): Promise<void> {
  await cache.transaction("rw", cache.values, async () => {
    await cache.values.bulkPut([
      { key: "config", value: config },
      { key: "snapshot", value: snapshot },
    ]);
  });
}

export async function saveCorrection(noteId: string, correction: Correction): Promise<void> {
  const current = (await cache.values.get("corrections"))?.value as Record<string, Correction> | undefined;
  await cache.values.put({ key: "corrections", value: { ...current, [noteId]: correction } });
}

let dictionaryLoad: Promise<void> | null = null;

async function unpack(path: string, expectedHash: string): Promise<unknown> {
  const response = await fetch(`/api/dictionary/${path}`);
  if (!response.ok) throw new Error(`Dictionary download failed: ${path}`);
  const data = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== expectedHash)
    throw new Error(`Dictionary checksum mismatch: ${path}`);
  const decompressed = new Response(
    new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip")),
  );
  return decompressed.json();
}

export async function loadDictionary(
  manifest: DictionaryManifest,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  if (dictionaryLoad) return dictionaryLoad;
  dictionaryLoad = loadDictionaryParts(manifest, onProgress).finally(() => { dictionaryLoad = null; });
  return dictionaryLoad;
}

async function loadDictionaryParts(
  manifest: DictionaryManifest,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  if (manifest.datasetVersion === "unavailable") return;
  const current = (await cache.values.get("dictionaryVersion"))?.value;
  if (current === manifest.datasetVersion) return;
  const similar: Record<string, string[]> = {};
  let done = 0;
  for (const file of manifest.files) {
    const data = await unpack(file.path, file.sha256);
    if (file.kind === "words")
      await cache.dictionaryWords.bulkPut(
        (data as DictionaryWord[]).map((word) => ({
          ...word,
          datasetVersion: manifest.datasetVersion,
        })),
      );
    if (file.kind === "similar") Object.assign(similar, data);
    done += 1;
    onProgress(done, manifest.files.length);
  }
  await cache.values.bulkPut([
    { key: "similar", value: similar },
    { key: "dictionaryVersion", value: manifest.datasetVersion },
  ]);
  await cache.dictionaryWords
    .where("datasetVersion")
    .notEqual(manifest.datasetVersion)
    .delete();
}

export async function cachedSimilar(): Promise<Record<string, string[]>> {
  return (
    ((await cache.values.get("similar"))?.value as Record<string, string[]>) ??
    {}
  );
}
