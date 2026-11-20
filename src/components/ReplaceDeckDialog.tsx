import { useEffect, useRef } from "react";

type Props = {
  onCancel: () => void;
  onConfirm: () => void;
  description?: string;
};

export function ReplaceDeckDialog({
  onCancel,
  onConfirm,
  description = "Your current deck, field settings, and word corrections will be deleted when you import a new deck. You will start setup again.",
}: Props) {
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButton.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="replace-deck-title" aria-describedby="replace-deck-description">
        <div className="confirmation-icon" aria-hidden="true">!</div>
        <h2 id="replace-deck-title">Replace current deck?</h2>
        <p id="replace-deck-description">{description}</p>
        <div className="confirmation-actions">
          <button ref={cancelButton} className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
          <button className="danger-button" type="button" onClick={onConfirm}>Continue</button>
        </div>
      </section>
    </div>
  );
}
