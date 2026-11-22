export type RubyPart = { text: string; reading?: string };

export type Word = {
  wordId: string;
  noteIds: string[];
  spelling: string;
  reading: string;
  translations: string[];
  ruby: RubyPart[] | null;
  match: "dictionary" | "custom" | "needsRuby";
};

export type Snapshot = {
  schemaVersion: number;
  snapshotVersion: string;
  datasetVersion: string;
  deck: { id: number; name: string; includeChildren: boolean };
  syncedAt: string;
  words: Word[];
  unresolved: UnresolvedWord[];
  duplicateGroups?: DuplicateGroup[];
};

export type UnresolvedWord = {
  noteId: string;
  noteTypeId: number;
  spelling: string;
  reading?: string;
  reason: string;
};

export type DuplicateRecord = Omit<Word, "wordId" | "noteIds"> & {
  noteId: string;
  noteTypeId: number;
};

export type DuplicateGroup = {
  wordId: string;
  records: DuplicateRecord[];
};

export type Preview = {
  wordsByType: Record<string, Word[]>;
  unresolved: UnresolvedWord[];
  duplicateGroups: DuplicateGroup[];
};

export type Mapping = {
  status: "unconfigured" | "configured" | "skipped";
  spelling: string;
  translation: string;
  reading: string;
};

export type Config = {
  deckId: number;
  includeChildren: boolean;
  mappings: Record<string, Mapping>;
};

export type Deck = { id: number; name: string };
export type NoteType = {
  id: number;
  name: string;
  fields: string[];
  count: number;
  samples: Record<string, string>[];
};
export type StudiedNote = { id: string; modelId: number; fields: string[] };
export type CollectionData = {
  decks: Deck[];
  noteTypes: Record<string, NoteType[]>;
  studiedNotes: Record<string, StudiedNote[]>;
};
export type AnkiAuth = { hkey: string; endpoint: string; email: string };
export type Correction = { spelling: string; reading: string; ruby: string };
export type DownloadResult = {
  auth: AnkiAuth;
  collection: CollectionData;
};
export type Status = {
  hasCollection: boolean;
  hasAnkiSession: boolean;
  ankiAccount?: string | null;
  hasSnapshot: boolean;
  config: Config | null;
};
export type Group = "same" | "lookalikes" | "sameReading" | "similarReading";
