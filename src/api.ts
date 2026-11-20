import { cache, loadDictionary, localState, replaceCollection, saveConfigAndSnapshot,
  saveCorrection as storeCorrection, saveSyncedCollection } from "./cache";
import { buildSnapshot, collectionDecks, collectionNoteTypes, newDuplicateRecords, previewSnapshot, validateCorrection } from "./snapshot";
import type { Config, Deck, DownloadResult, DuplicateRecord, Mapping, NoteType, Preview, Snapshot, Status, UnresolvedWord } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { cache: "no-store", ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

const json = (body: unknown) => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export type DictionaryManifest = {
  schemaVersion: number;
  datasetVersion: string;
  files: { path: string; bytes: number; sha256: string; kind: "words" | "similar" }[];
  sources: { name: string; version: string; url: string; license: string }[];
};

export type SyncResult = {
  snapshot: Snapshot | null;
  newUnresolved: UnresolvedWord[];
  newDuplicates: DuplicateRecord[];
};

async function dictionaryVersion(): Promise<string> {
  const stored = (await cache.values.get("dictionaryVersion"))?.value as string | undefined;
  if (stored) return stored;
  const manifest = await api.manifest();
  await loadDictionary(manifest, () => undefined);
  return manifest.datasetVersion;
}

export const api = {
  async status(): Promise<Status> {
    const state = await localState();
    return {
      hasCollection: Boolean(state.collection), hasAnkiSession: Boolean(state.auth),
      ankiAccount: state.auth?.email || null, hasSnapshot: Boolean(state.snapshot), config: state.config,
    };
  },
  async decks(): Promise<Deck[]> {
    const { collection } = await localState();
    if (!collection) throw new Error("No Anki collection is available");
    return collectionDecks(collection);
  },
  async noteTypes(deckId: number, includeChildren: boolean): Promise<NoteType[]> {
    const { collection } = await localState();
    if (!collection) throw new Error("No Anki collection is available");
    return collectionNoteTypes(collection, deckId, includeChildren);
  },
  login: (email: string, password: string) => request<{ jobId: string }>("/anki/login", {
    method: "POST", ...json({ email, password }),
  }),
  async sync(): Promise<{ jobId: string }> {
    const { auth } = await localState();
    if (!auth) throw new Error("Sign in to AnkiWeb first");
    return request<{ jobId: string }>("/anki/sync", { method: "POST", ...json(auth) });
  },
  job: (id: string) => request<{
    status: "running" | "complete" | "error"; message?: string; result?: DownloadResult;
  }>(`/jobs/${id}`),
  async applyLogin(result: DownloadResult): Promise<void> {
    await replaceCollection(result.collection, result.auth);
  },
  async applySync(result: DownloadResult): Promise<SyncResult> {
    const state = await localState();
    const snapshot = state.config
      ? await buildSnapshot(result.collection, state.config, state.corrections, await dictionaryVersion())
      : null;
    const previousSnapshot = await saveSyncedCollection(result.collection, result.auth, snapshot);
    const previousIds = new Set(previousSnapshot?.unresolved?.map((word) => word.noteId));
    const newUnresolved = snapshot?.unresolved.filter((word) => !previousIds.has(word.noteId)) ?? [];
    return { snapshot, newUnresolved, newDuplicates: newDuplicateRecords(previousSnapshot, snapshot) };
  },
  async importFile(file: File): Promise<void> {
    const body = new FormData();
    body.append("file", file);
    const result = await request<{ collection: DownloadResult["collection"] }>("/anki/import", {
      method: "POST", body,
    });
    await replaceCollection(result.collection, null);
  },
  async saveConfig(config: Config): Promise<{ snapshotVersion: string; wordCount: number }> {
    const state = await localState();
    if (!state.collection) throw new Error("No Anki collection is available");
    const types = collectionNoteTypes(state.collection, config.deckId, config.includeChildren);
    if (!types.length) throw new Error("The selected deck contains no note types");
    for (const type of types) {
      const mapping = config.mappings[String(type.id)];
      if (!mapping || !["configured", "skipped"].includes(mapping.status))
        throw new Error("Configure or skip every note type");
      if (mapping.status === "configured" && (
        !type.fields.includes(mapping.spelling) ||
        mapping.translation && !type.fields.includes(mapping.translation) ||
        mapping.translation && mapping.spelling === mapping.translation ||
        mapping.reading && !type.fields.includes(mapping.reading)
      )) throw new Error("Choose valid fields");
    }
    if (!types.some((type) => config.mappings[String(type.id)].status === "configured"))
      throw new Error("Configure at least one note type");
    const snapshot = await buildSnapshot(state.collection, config, state.corrections, await dictionaryVersion());
    await saveConfigAndSnapshot(config, snapshot);
    return { snapshotVersion: snapshot.snapshotVersion, wordCount: snapshot.words.length };
  },
  async snapshot(): Promise<Snapshot> {
    const state = await localState();
    if (!state.snapshot) throw new Error("No snapshot is available");
    return state.snapshot;
  },
  async preview(config: Config): Promise<Preview> {
    const state = await localState();
    if (!state.collection) throw new Error("No Anki collection is available");
    const types = collectionNoteTypes(state.collection, config.deckId, config.includeChildren);
    const mappings: Record<string, Mapping> = Object.fromEntries(Object.entries(config.mappings).map(([id, mapping]) => {
      const type = types.find((item) => String(item.id) === id);
      const valid = type && type.fields.includes(mapping.spelling) &&
        (!mapping.translation || type.fields.includes(mapping.translation) && mapping.translation !== mapping.spelling) &&
        (!mapping.reading || type.fields.includes(mapping.reading));
      return [id, { ...mapping, status: valid && mapping.status !== "skipped" ? "configured" as const : "skipped" as const }];
    }));
    return previewSnapshot(state.collection, { ...config, mappings }, state.corrections, await dictionaryVersion());
  },
  async saveCorrection(noteId: string, spelling: string, reading: string, ruby: string): Promise<void> {
    const state = await localState();
    if (!state.collection) throw new Error("No Anki collection is available");
    if (!Object.values(state.collection.studiedNotes).some((notes) => notes.some((note) => note.id === noteId)))
      throw new Error("Note not found");
    const correction = validateCorrection(spelling, reading, ruby);
    await storeCorrection(noteId, correction);
    if (state.config) {
      const snapshot = await buildSnapshot(state.collection, state.config,
        { ...state.corrections, [noteId]: correction }, await dictionaryVersion());
      await saveConfigAndSnapshot(state.config, snapshot);
    }
  },
  manifest: () => request<DictionaryManifest>("/dictionary/manifest"),
};

export async function waitForJob(id: string): Promise<DownloadResult> {
  for (;;) {
    const result = await api.job(id);
    if (result.status === "complete" && result.result) return result.result;
    if (result.status === "error") throw new Error(result.message || "Operation failed");
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
  }
}
