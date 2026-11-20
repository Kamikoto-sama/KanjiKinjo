import { useEffect, useRef } from "react";

type Props = {
  count: number;
  onCancel: () => void;
  onManage: () => void;
  onContinue: () => void;
};

export function SkipWordsDialog({ count, onCancel, onManage, onContinue }: Props) {
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
      <section className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="skip-words-title" aria-describedby="skip-words-description">
        <div className="confirmation-icon" aria-hidden="true">!</div>
        <h2 id="skip-words-title">Continue without {count} {count === 1 ? "word" : "words"}?</h2>
        <p id="skip-words-description">These words in the selected deck cannot be imported and will be skipped. You can correct them before continuing.</p>
        <div className="confirmation-actions skip-words-actions">
          <button ref={cancelButton} className="text-button" type="button" onClick={onCancel}>Cancel</button>
          <button className="secondary-button" type="button" onClick={onManage}>Manage words</button>
          <button className="primary-button" type="button" onClick={onContinue}>Continue</button>
        </div>
      </section>
    </div>
  );
}
