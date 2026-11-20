import { useEffect, useRef } from "react";

type Props = {
  unresolvedCount: number;
  duplicateCount: number;
  onDismiss: () => void;
  onOpenSetup: () => void;
};

export function SyncResultsDialog({ unresolvedCount, duplicateCount, onDismiss, onOpenSetup }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function dismiss() {
    dialogRef.current?.close();
    onDismiss();
  }

  return (
    <dialog
      ref={dialogRef}
      className="confirmation-dialog sync-results-dialog"
      aria-labelledby="sync-results-title"
      aria-describedby="sync-results-summary"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      <h2 id="sync-results-title">Review synced words</h2>
      <div id="sync-results-summary">
        {unresolvedCount > 0 && (
          <p>{unresolvedCount} new {unresolvedCount === 1 ? "word" : "words"} cannot be imported.</p>
        )}
        {duplicateCount > 0 && (
          <p>{duplicateCount} new duplicate {duplicateCount === 1 ? "record" : "records"} will be merged.</p>
        )}
      </div>
      <div className="confirmation-actions">
        <button className="secondary-button" type="button" onClick={dismiss}>Close</button>
        <button className="primary-button" type="button" onClick={() => {
          dismiss();
          onOpenSetup();
        }}>Deck &amp; fields</button>
      </div>
    </dialog>
  );
}
