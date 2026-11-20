import { useState } from "react";
import { RecordRow } from "./RecordRow";
import type { Word } from "../types";

export function RecordPreview({ words }: { words: Word[] }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(words.length / 3));
  const currentPage = Math.min(page, pageCount - 1);
  if (!words.length) {
    return (
      <div className="preview-warning" role="status">
        <span className="preview-warning-icon" aria-hidden="true">!</span>
        <div>
          <strong>No importable words with these fields</strong>
          <p>Choose the field containing the Japanese word, then save the fields again.</p>
        </div>
      </div>
    );
  }
  return (
    <section className="record-preview" aria-label="Record preview">
      <div className="preview-heading">
        <h2>Record preview</h2>
        {words.length > 3 && <span>{currentPage + 1} / {pageCount}</span>}
      </div>
      <div className="preview-records" aria-live="polite">
        {words.slice(currentPage * 3, currentPage * 3 + 3).map((word) => (
          <RecordRow key={word.wordId} word={word} />
        ))}
      </div>
      {words.length > 3 && (
        <div className="preview-pagination">
          <button className="text-button" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous examples</button>
          <button className="text-button" type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>More examples</button>
        </div>
      )}
    </section>
  );
}
