import {
  cachedSnapshot,
  lookupDictionary,
  publishCorrectedSnapshot,
  readCollection,
  readSnapshotInputs,
  readSourceVersion,
  readSyncSource,
  sameCollectionContent,
  sameSnapshotInputs,
  saveConfigAndSnapshot,
  saveCorrection as storeCorrection,
  saveSyncedCollection,
  type SourceVersion,
} from "./cache";
import {
  buildSnapshot,
  collectionDecks,
  collectionNoteTypes,
  newDuplicateRecords,
  prepareSnapshot,
  snapshotWords,
  validateCorrection,
} from "./snapshot";
import type {
  CollectionData,
  Config,
  DownloadResult,
  DuplicateRecord,
  Mapping,
  NoteType,
  Preview,
  Snapshot,
  UnresolvedWord,
} from "./types";

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { cache: "no-store", ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new HttpError(
      typeof body?.detail === "string"
        ? body.detail
        : `Request failed (${response.status})`,
      response.status,
    );
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
  files: {
    path: string;
    bytes: number;
    sha256: string;
    kind: "words" | "similar";
  }[];
  sources: { name: string; version: string; url: string; license: string }[];
};

export type SyncResult = {
  snapshot: Snapshot | null;
  newUnresolved: UnresolvedWord[];
  newDuplicates: DuplicateRecord[];
};

type SnapshotInputs = Awaited<ReturnType<typeof readSnapshotInputs>>;
type SyncSource = Awaited<ReturnType<typeof readSyncSource>>["version"];

export type PreparedSetup = {
  config: Config;
  source: SourceVersion;
  snapshot: Snapshot;
  preview: Preview;
    previewIncludingUnstudied?: Preview;
  types: NoteType[];
};

export function setupPreview(
    prepared: PreparedSetup,
    showUnstudied: boolean,
): Preview {
    return (showUnstudied && prepared.previewIncludingUnstudied) || prepared.preview;
}

function requireCollection(state: SnapshotInputs): CollectionData {
  if (!state.collection) throw new Error("No Anki collection is available");
  return state.collection;
}

function requireDictionary(state: SnapshotInputs): string {
  if (!state.version.dictionary) throw new Error("Dictionaries are not loaded");
  return state.version.dictionary;
}

function buildFromInputs(
  collection: CollectionData,
  config: Config,
  state: SnapshotInputs,
) {
  return buildSnapshot(
    collection,
    config,
    state.corrections,
    requireDictionary(state),
    lookupDictionary,
  );
}

function validFields(type: NoteType, mapping: Mapping) {
  return (
    type.fields.includes(mapping.spelling) &&
    (!mapping.translation ||
      (type.fields.includes(mapping.translation) &&
        mapping.translation !== mapping.spelling)) &&
    (!mapping.reading || type.fields.includes(mapping.reading))
  );
}

function validateConfig(config: Config, types: NoteType[]) {
  if (!types.length)
    throw new Error("The selected deck contains no note types");
  for (const type of types) {
    const mapping = config.mappings[String(type.id)];
    if (!mapping || mapping.status === "unconfigured")
      throw new Error("Configure or skip every note type");
    if (mapping.status === "configured" && !validFields(type, mapping))
      throw new Error("Choose valid fields");
  }
  if (
    !types.some(
      (type) => config.mappings[String(type.id)].status === "configured",
    )
  ) {
    throw new Error("Configure at least one note type");
  }
}

export const api = {
  async decks() {
    const collection = await readCollection();
    if (!collection) throw new Error("No Anki collection is available");
    return collectionDecks(collection);
  },
  async noteTypes(deckId: number, includeChildren: boolean) {
    const collection = await readCollection();
    if (!collection) throw new Error("No Anki collection is available");
    return collectionNoteTypes(collection, deckId, includeChildren);
  },
  login: (email: string, password: string) =>
    request<{ jobId: string }>("/anki/login", {
      method: "POST",
      ...json({ email, password }),
    }),
  async sync(): Promise<{ jobId: string; source: SyncSource }> {
    const { auth, version } = await readSyncSource();
    if (!auth) throw new Error("Sign in to AnkiWeb first");
    const { jobId } = await request<{ jobId: string }>("/anki/sync", {
      method: "POST",
      ...json(auth),
    });
    return { jobId, source: version };
  },
  job: (id: string, signal?: AbortSignal) =>
    request<{
      status: "running" | "complete" | "error";
      message?: string;
      result?: DownloadResult;
    }>(`/jobs/${id}`, { signal }),
  async applySync(
    result: DownloadResult,
    source: SyncSource,
  ): Promise<SyncResult | null> {
    while (sameCollectionContent(await readSourceVersion(), source)) {
      const state = await readSnapshotInputs();
      if (!sameCollectionContent(state.version, source)) return null;
      const snapshot = state.config
        ? await buildFromInputs(result.collection, state.config, state)
        : null;
      const saved = await saveSyncedCollection(
        result.collection,
        result.auth,
        snapshot,
        state.version,
      );
      if (!saved) continue;
        const previous =
            saved.previousSnapshot && snapshotWords(saved.previousSnapshot, saved.showUnstudied);
        const next = snapshot && snapshotWords(snapshot, saved.showUnstudied);
      const previousIds = new Set(
          previous?.unresolved?.map((word) => word.noteId),
      );
      const newUnresolved =
          next?.unresolved.filter((word) => !previousIds.has(word.noteId)) ??
        [];
      return {
        snapshot,
        newUnresolved,
          newDuplicates: newDuplicateRecords(previous, next),
      };
    }
    return null;
  },
  async importFile(file: File): Promise<CollectionData> {
    const body = new FormData();
    body.append("file", file);
    const result = await request<{ collection: CollectionData }>(
      "/anki/import",
      { method: "POST", body },
    );
    return result.collection;
  },
  async snapshot(): Promise<Snapshot> {
    const snapshot = await cachedSnapshot();
    if (!snapshot) throw new Error("No snapshot is available");
    return snapshot;
  },
  async prepareSetup(config: Config): Promise<PreparedSetup> {
    const state = await readSnapshotInputs();
    const collection = requireCollection(state);
    const types = collectionNoteTypes(
      collection,
      config.deckId,
      config.includeChildren,
    );
    const mappings: Record<string, Mapping> = Object.fromEntries(
      Object.entries(config.mappings).map(([id, mapping]) => {
        const type = types.find((item) => String(item.id) === id);
        return [
          id,
          {
            ...mapping,
            status:
              type && mapping.status !== "skipped" && validFields(type, mapping)
                ? "configured"
                : "skipped",
          },
        ];
      }),
    );
    const prepared = await prepareSnapshot(
      collection,
      { ...config, mappings },
      state.corrections,
      requireDictionary(state),
      lookupDictionary,
    );
    return { ...prepared, config, source: state.version, types };
  },
    async preview(config: Config, showUnstudied = false): Promise<Preview> {
        return setupPreview(await api.prepareSetup(config), showUnstudied);
  },
  async refreshSetup(prepared: PreparedSetup): Promise<PreparedSetup> {
    const current = await readSourceVersion();
    if (sameSnapshotInputs(current, prepared.source)) return prepared;
    if (current.id !== prepared.source.id)
      throw new Error("The collection changed. Reopen deck setup.");
    const refreshed = await api.prepareSetup(prepared.config);
    if (refreshed.source.id !== prepared.source.id)
      throw new Error("The collection changed. Reopen deck setup.");
    return refreshed;
  },
  async saveSetup(prepared: PreparedSetup): Promise<boolean> {
    validateConfig(prepared.config, prepared.types);
    return saveConfigAndSnapshot(
      prepared.config,
      prepared.snapshot,
      prepared.source,
    );
  },
  async saveCorrection(
    noteId: string,
    spelling: string,
    reading: string,
    ruby: string,
  ): Promise<void> {
    const correction = validateCorrection(spelling, reading, ruby);
    const first = await readSnapshotInputs();
    let state = first;
    for (;;) {
      if (state.version.id !== first.version.id)
        throw new Error("The collection changed. Reopen word corrections.");
      const collection = requireCollection(state);
      if (
          ![collection.studiedNotes, collection.unstudiedNotes].some((decks) =>
              Object.values(decks ?? {}).some((notes) =>
                  notes.some((note) => note.id === noteId),
              ),
        )
      ) {
        throw new Error("Note not found");
      }
      if (await storeCorrection(noteId, correction, state.version)) break;
      state = await readSnapshotInputs();
    }
    for (;;) {
      state = await readSnapshotInputs();
      if (state.version.id !== first.version.id || !state.config) return;
      const snapshot = await buildFromInputs(
        requireCollection(state),
        state.config,
        state,
      );
      if (await publishCorrectedSnapshot(snapshot, state.version)) return;
    }
  },
  manifest: (signal?: AbortSignal) =>
    request<DictionaryManifest>("/dictionary/manifest", { signal }),
};

function retryableJobError(error: unknown) {
  if (error instanceof HttpError)
    return [408, 429].includes(error.status) || error.status >= 500;
  return error instanceof TypeError || error instanceof SyntaxError;
}

export async function waitForJob(
  id: string,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  let failures = 0;
  for (;;) {
    signal?.throwIfAborted();
    let result;
    try {
      result = await api.job(id, signal);
      failures = 0;
    } catch (error) {
      if (!retryableJobError(error) || ++failures > 3) throw error;
    }
    if (result?.status === "complete") {
      if (!result.result) throw new Error("The job returned no collection");
      return result.result;
    }
    if (result?.status === "error")
      throw new Error(result.message || "Operation failed");
    await new Promise((resolve) =>
      setTimeout(resolve, 1200 * Math.max(1, failures)),
    );
  }
}
