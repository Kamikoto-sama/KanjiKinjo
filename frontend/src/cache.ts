import Dexie, { type Table } from "dexie";
import type { DictionaryManifest } from "./api";
import type { AnkiAuth, CollectionData, Config, Correction, Snapshot, Status, } from "./types";

type StoredValue = { key: string; value: unknown };
export type DictionaryWord = {
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
    super("KanjiKinjo");
    this.version(1).stores({
      values: "key",
      dictionaryWords: "[datasetVersion+wordId],datasetVersion,spelling",
    });
  }
}

export const cache = new Cache();

type CollectionVersion = {
  id: string | null;
  // Content changes on sync. Inputs also change when mappings or corrections are saved.
  content: number;
  inputs: number;
};

export type SourceVersion = CollectionVersion & { dictionary: string | null };

const legacyVersion: CollectionVersion = { id: null, content: 0, inputs: 0 };

function value<T>(row: StoredValue | undefined): T | null {
  return (row?.value as T | undefined) ?? null;
}

function statusFor(
  hasCollection: boolean,
  auth: AnkiAuth | null,
  config: Config | null,
  snapshot: Snapshot | null,
): Status {
  return {
    hasCollection,
    hasAnkiSession: Boolean(auth),
    ankiAccount: auth?.email ?? null,
    hasSnapshot: Boolean(snapshot),
    config,
  };
}

export function readStartup() {
  return cache.transaction("r", cache.values, async () => {
    const [rows, hasCollection, dictionary] = await Promise.all([
        cache.values.bulkGet([
            "auth",
            "config",
            "snapshot",
            "collectionVersion",
            "showUnstudiedWords",
            "hasUnstudiedData",
        ]),
      cache.values.where(":id").equals("collection").count(),
      readDictionary(),
    ]);
      const [auth, config, storedSnapshot, version, showUnstudied, hasUnstudiedData] =
          rows;
    const snapshot = value<Snapshot>(storedSnapshot);
    return {
      status: statusFor(
        Boolean(hasCollection),
        value<AnkiAuth>(auth),
        value<Config>(config),
        snapshot,
      ),
      snapshot,
        showUnstudied: value<boolean>(showUnstudied) === true,
        hasUnstudiedData:
            value<boolean>(hasUnstudiedData) ?? Boolean(snapshot?.includingUnstudied),
      collectionId: (value<CollectionVersion>(version) ?? legacyVersion).id,
      dictionary,
    };
  });
}

export async function readShowUnstudiedWords() {
    return value<boolean>(await cache.values.get("showUnstudiedWords")) === true;
}

export async function saveShowUnstudiedWords(show: boolean) {
    await cache.values.put({ key: "showUnstudiedWords", value: show });
}

export async function cachedSnapshot(): Promise<Snapshot | null> {
  return value<Snapshot>(await cache.values.get("snapshot"));
}

export async function readCollection() {
  return value<CollectionData>(await cache.values.get("collection"));
}

export async function readSyncSource() {
  const [auth, version] = await cache.values.bulkGet([
    "auth",
    "collectionVersion",
  ]);
  return {
    auth: value<AnkiAuth>(auth),
    version: value<CollectionVersion>(version) ?? legacyVersion,
  };
}

export async function readSnapshotInputs() {
  const [collection, config, corrections, version, dictionary] =
    await cache.values.bulkGet([
      "collection",
      "config",
      "corrections",
      "collectionVersion",
      "dictionaryVersion",
    ]);
  return {
    collection: value<CollectionData>(collection),
    config: value<Config>(config),
    corrections: value<Record<string, Correction>>(corrections) ?? {},
    version: {
      ...(value<CollectionVersion>(version) ?? legacyVersion),
      dictionary: value<string>(dictionary),
    },
  };
}

export async function readSourceVersion(): Promise<SourceVersion> {
  const [version, dictionary] = await cache.values.bulkGet([
    "collectionVersion",
    "dictionaryVersion",
  ]);
  return {
    ...(value<CollectionVersion>(version) ?? legacyVersion),
    dictionary: value<string>(dictionary),
  };
}

export function sameCollectionContent(
  a: CollectionVersion,
  b: CollectionVersion,
) {
  return a.id === b.id && a.content === b.content;
}

export function sameSnapshotInputs(a: SourceVersion, b: SourceVersion) {
  return (
    sameCollectionContent(a, b) &&
    a.inputs === b.inputs &&
    a.dictionary === b.dictionary
  );
}

export async function lookupDictionary(
  spelling: string,
  dictionary: string,
): Promise<DictionaryWord[]> {
  const entries = await cache.dictionaryWords
    .where("spelling")
    .equals(spelling)
    .toArray();
  return entries.filter((word) => word.datasetVersion === dictionary);
}

export async function replaceCollection(
  collection: CollectionData,
  auth: AnkiAuth | null,
) {
  const version: CollectionVersion = {
    id: crypto.randomUUID(),
    content: 0,
    inputs: 0,
  };
  await cache.transaction("rw", cache.values, async () => {
    await cache.values.bulkDelete([
      "auth",
      "config",
      "snapshot",
      "corrections",
    ]);
    await cache.values.bulkPut([
      { key: "collection", value: collection },
        { key: "hasUnstudiedData", value: Boolean(collection.unstudiedNotes) },
      { key: "collectionVersion", value: version },
      ...(auth ? [{ key: "auth", value: auth }] : []),
    ]);
  });
  return {
    status: statusFor(true, auth, null, null),
    collectionId: version.id,
  };
}

export function saveSyncedCollection(
  collection: CollectionData,
  auth: AnkiAuth,
  snapshot: Snapshot | null,
  source: SourceVersion,
) {
  return cache.transaction("rw", cache.values, async () => {
    if (!sameSnapshotInputs(await readSourceVersion(), source)) return null;
      const [previousSnapshot, showUnstudied] = await Promise.all([
          cachedSnapshot(),
          readShowUnstudiedWords(),
      ]);
    const version: CollectionVersion = {
      id: source.id,
      content: source.content + 1,
      inputs: source.inputs + 1,
    };
    await cache.values.bulkPut([
      { key: "collection", value: collection },
        { key: "hasUnstudiedData", value: Boolean(collection.unstudiedNotes) },
      { key: "auth", value: auth },
      { key: "collectionVersion", value: version },
      ...(snapshot ? [{ key: "snapshot", value: snapshot }] : []),
    ]);
      return { previousSnapshot, showUnstudied };
  });
}

export function saveConfigAndSnapshot(
  config: Config,
  snapshot: Snapshot,
  source: SourceVersion,
) {
  return cache.transaction("rw", cache.values, async () => {
    if (!sameSnapshotInputs(await readSourceVersion(), source)) return false;
    const version: CollectionVersion = {
      id: source.id,
      content: source.content,
      inputs: source.inputs + 1,
    };
    await cache.values.bulkPut([
      { key: "config", value: config },
      { key: "snapshot", value: snapshot },
      { key: "collectionVersion", value: version },
    ]);
    return true;
  });
}

export function saveCorrection(
  noteId: string,
  correction: Correction,
  source: SourceVersion,
) {
  return cache.transaction("rw", cache.values, async () => {
    const [version, corrections] = await cache.values.bulkGet([
      "collectionVersion",
      "corrections",
    ]);
    const current = value<CollectionVersion>(version) ?? legacyVersion;
    if (!sameCollectionContent(current, source)) return false;
    await cache.values.bulkPut([
      {
        key: "corrections",
        value: {
          ...value<Record<string, Correction>>(corrections),
          [noteId]: correction,
        },
      },
      {
        key: "collectionVersion",
        value: { ...current, inputs: current.inputs + 1 },
      },
    ]);
    return true;
  });
}

export function publishCorrectedSnapshot(
  snapshot: Snapshot,
  source: SourceVersion,
) {
  return cache.transaction("rw", cache.values, async () => {
    if (!sameSnapshotInputs(await readSourceVersion(), source)) return false;
    await cache.values.put({ key: "snapshot", value: snapshot });
    return true;
  });
}

const dictionaryDownloadConcurrency = 4;

async function unpack(
  path: string,
  expectedHash: string,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(`/api/dictionary/${path}`, { signal });
  if (!response.ok) throw new Error(`Dictionary download failed: ${path}`);
  const data = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", data);
  signal.throwIfAborted();
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== expectedHash)
    throw new Error(`Dictionary checksum mismatch: ${path}`);
  const decompressed = new Response(
    new Blob([data])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"), { signal }),
  );
  return decompressed.json();
}

export async function loadDictionary(
  manifest: DictionaryManifest,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  signal.throwIfAborted();
  const current = (await cache.values.get("dictionaryVersion"))?.value;
  if (current === manifest.datasetVersion) return;
  const similar: Record<string, string[]> = {};
  const { files } = manifest;
  let done = 0;
  for (
    let start = 0;
    start < files.length;
    start += dictionaryDownloadConcurrency
  ) {
    signal.throwIfAborted();
    const controller = new AbortController();
    const batchSignal = AbortSignal.any([signal, controller.signal]);
    const batch = files.slice(start, start + dictionaryDownloadConcurrency);
    const downloads = batch.map((file) => ({
      file,
      data: unpack(file.path, file.sha256, batchSignal),
    }));
    // Observe every rejection while consuming the downloads in manifest order.
    const settled = Promise.allSettled(downloads.map(({ data }) => data));
    try {
      for (const { file, data: download } of downloads) {
        const data = await download;
        signal.throwIfAborted();
        if (file.kind === "words")
          await cache.dictionaryWords.bulkPut(
            (data as DictionaryWord[]).map((word) => ({
              ...word,
              datasetVersion: manifest.datasetVersion,
            })),
          );
        if (file.kind === "similar") Object.assign(similar, data);
        signal.throwIfAborted();
        done += 1;
        onProgress(done, files.length);
      }
    } catch (error) {
      controller.abort();
      await settled;
      throw error;
    }
  }
  await cache.transaction(
    "rw",
    cache.values,
    cache.dictionaryWords,
    async () => {
      signal.throwIfAborted();
      await cache.values.bulkPut([
        { key: "similar", value: similar },
        { key: "dictionaryVersion", value: manifest.datasetVersion },
      ]);
      signal.throwIfAborted();
      await cache.dictionaryWords
        .where("datasetVersion")
        .notEqual(manifest.datasetVersion)
        .delete();
      signal.throwIfAborted();
    },
  );
}

export type CachedDictionary = {
  version: string | null;
  similar: Record<string, string[]>;
};

export async function readDictionary(): Promise<CachedDictionary> {
  const [version, similar] = await cache.values.bulkGet([
    "dictionaryVersion",
    "similar",
  ]);
  return {
    version: value<string>(version),
    similar: value<Record<string, string[]>>(similar) ?? {},
  };
}
