import { useEffect, useRef, useState } from "react";
import type { SyncResult } from "../api";

export function MissingWordSyncDialog({ spelling, reading, onSync }: {
  spelling: string | null;
  reading: string | null;
  onSync: () => Promise<SyncResult | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, [open]);

  async function sync() {
    setBusy(true);
    setError("");
    try {
      if (await onSync()) setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="confirmation-dialog"
      aria-labelledby="missing-word-sync-title"
      aria-describedby="missing-word-sync-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) setOpen(false);
      }}
    >
      <h2 id="missing-word-sync-title">Word not found</h2>
      <p id="missing-word-sync-description">
        {spelling ? <>The word <strong>{spelling}</strong></> : "This word"}
        {reading && <> with the reading <strong>{reading}</strong></>}
        {" was not found among the studied words in this deck. The deck may be out of date. Sync the deck?"}
      </p>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="confirmation-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="primary-button" type="button" disabled={busy} onClick={sync}>
          {busy ? "Syncing…" : "Sync"}
        </button>
      </div>
    </dialog>
  );
}
