import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { RecordRow } from "../components/RecordRow";
import { goBack } from "../navigation";
import { readSetupDraft } from "../setupDraft";
import type { Config, DuplicateGroup } from "../types";

type Props = { initialConfig: Config | null; snapshotVersion?: string };

export function DuplicatesPage({ initialConfig, snapshotVersion }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const noteTypeId = Number(new URLSearchParams(location.search).get("type")) || null;
  const [draft] = useState(readSetupDraft);
  const config = draft || initialConfig;
  const [previewGroups, setPreviewGroups] = useState<DuplicateGroup[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!config) return;
    let active = true;
    setPreviewGroups(null);
    setError("");
    api.preview(config)
      .then((preview) => {
        if (active) setPreviewGroups(preview.duplicateGroups);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load duplicates");
      });
    return () => { active = false; };
  }, [config, snapshotVersion]);

  const visibleGroups = previewGroups?.filter(({ records }) =>
    noteTypeId === null || records.some((record) => record.noteTypeId === noteTypeId),
  );

  return (
    <main className="screen active">
      <div className="setup-window">
        <header className="setup-header">
          <button className="icon-button" type="button" aria-label="Back" onClick={() => goBack(navigate, "/setup")}>←</button>
          <h1>Duplicate words</h1>
        </header>
        <div className="setup-content">
          {error ? (
            <p className="form-error" role="alert">{error}</p>
          ) : !config ? (
            <div className="empty-state">Choose a deck and fields first.</div>
          ) : !visibleGroups ? (
            <div className="empty-state" role="status">Checking words…</div>
          ) : !visibleGroups.length ? (
            <div className="empty-state">No duplicate words{noteTypeId === null ? "" : " in this card type"}.</div>
          ) : (
            <ul className="duplicate-groups">
              {visibleGroups.map(({ wordId, records }) => (
                <li className="preview-records" key={wordId}>
                  {records.map((record) => <RecordRow key={record.noteId} word={record} />)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
