import { useState } from "react";
import { api, type PreparedSetup, setupPreview } from "../api";
import { readShowUnstudiedWords } from "../cache";
import { snapshotWords } from "../snapshot";
import type { Config, Snapshot, UnresolvedWord } from "../types";

function unresolvedSignature(unresolved: UnresolvedWord[]) {
  return JSON.stringify(
      unresolved
      .map(({ noteId, noteTypeId, spelling, reading, reason }) =>
        JSON.stringify([noteId, noteTypeId, spelling, reading, reason]),
      )
      .sort(),
  );
}

export function useSetupSave({
  getPrepared,
  showPrepared,
  onSaved,
  setError,
}: {
  getPrepared: () => Promise<PreparedSetup>;
  showPrepared: (prepared: PreparedSetup) => void;
  onSaved: (snapshot: Snapshot, config: Config) => void;
  setError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pendingSkip, setPendingSkip] = useState<{
    prepared: PreparedSetup;
    signature: string;
      count: number;
    trigger: HTMLButtonElement;
  } | null>(null);

  async function finishSetup(
    trigger: HTMLButtonElement,
    confirmation?: typeof pendingSkip,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    setPendingSkip(null);
    try {
      let prepared = confirmation?.prepared ?? (await getPrepared());
      for (;;) {
        prepared = await api.refreshSetup(prepared);
        showPrepared(prepared);
          const showUnstudied = await readShowUnstudiedWords();
          if (!snapshotWords(prepared.snapshot, showUnstudied).words.length) return;
          const { unresolved } = setupPreview(prepared, showUnstudied);
          const signature = unresolvedSignature(unresolved);
          if (unresolved.length && signature !== confirmation?.signature) {
              setPendingSkip({ prepared, signature, count: unresolved.length, trigger });
          return;
        }
        if (await api.saveSetup(prepared)) break;
      }
      onSaved(prepared.snapshot, prepared.config);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not build snapshot",
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    save: (trigger: HTMLButtonElement) => finishSetup(trigger),
    skipWarning: pendingSkip && {
        count: pendingSkip.count,
      returnFocus: pendingSkip.trigger,
    },
    dismissSkip: () => setPendingSkip(null),
    confirmSkip: () => {
      if (pendingSkip) void finishSetup(pendingSkip.trigger, pendingSkip);
    },
  };
}
