import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { goBack } from "../navigation";
import { readSetupDraft } from "../setupDraft";
import type { Config, Preview, Snapshot, UnresolvedWord } from "../types";

type Props = { initialConfig: Config | null; onSnapshot: (snapshot: Snapshot) => void };

export function CorrectionsPage({ initialConfig, onSnapshot }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const noteTypeId = Number(new URLSearchParams(location.search).get("type")) || null;
  const [draft] = useState(readSetupDraft);
  const config = draft || initialConfig;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState("");
  const [spelling, setSpelling] = useState("");
  const [reading, setReading] = useState("");
  const [ruby, setRuby] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const items = preview?.unresolved.filter((item) => noteTypeId === null || item.noteTypeId === noteTypeId) || [];
  const active = items.find((item) => item.noteId === selected) || items[0];

  function select(item: UnresolvedWord) {
    setSelected(item.noteId);
    setSpelling(item.spelling);
    setReading(item.reading || "");
    setRuby(item.spelling);
    setError("");
  }

  useEffect(() => {
    if (!config) return;
    let active = true;
    api.preview(config)
      .then((next) => {
        if (!active) return;
        setPreview(next);
        const first = next.unresolved.find((item) => noteTypeId === null || item.noteTypeId === noteTypeId);
        if (first) select(first);
      })
      .catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [config, noteTypeId, location.key]);

  async function save() {
    if (!active || !config) return;
    setBusy(true);
    setError("");
    try {
      await api.saveCorrection(active.noteId, spelling, reading, ruby);
      const next = await api.preview(config);
      setPreview(next);
      const first = next.unresolved.find((item) => noteTypeId === null || item.noteTypeId === noteTypeId);
      if (first) select(first);
      else setSelected("");
      try {
        const snapshot = await api.snapshot();
        onSnapshot(snapshot);
      } catch {
        // A snapshot is created only after the deck settings have been saved.
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save correction");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen active">
      <div className="setup-window">
        <header className="setup-header">
          <button className="icon-button" type="button" aria-label="Back" onClick={() => goBack(navigate, "/setup")}>←</button>
          <h1>Word corrections</h1>
        </header>
        <div className="setup-content">
          {!config ? <div className="empty-state">Choose a deck and fields first.</div> : !preview && !error ? <div className="empty-state">Checking words…</div> : !items.length ? <div className="empty-state">All studied words {noteTypeId === null ? "" : "in this card type "}are resolved.</div> : (
            <>
              <p className="correction-summary">{items.length} words cannot be imported until corrected. Uncorrected words will be skipped.</p>
              <div className="correction-list">
                {items.map((item) => (
                  <button key={item.noteId} type="button" className={item.noteId === active?.noteId ? "active" : ""} onClick={() => select(item)}>
                    {item.spelling}
                    <span>{item.reason === "needsRuby" ? "Furigana needed" : "Reading needed"}</span>
                  </button>
                ))}
              </div>
              {active && (
                <div className="correction-form">
                  <label className="field-label" htmlFor="correct-spelling">Word / spelling</label>
                  <input id="correct-spelling" value={spelling} onChange={(event) => setSpelling(event.target.value)} />
                  <label className="field-label" htmlFor="correct-reading">Reading (optional)</label>
                  <input id="correct-reading" value={reading} onChange={(event) => setReading(event.target.value)} placeholder="Calculated from furigana" />
                  <label className="field-label" htmlFor="correct-ruby">Furigana</label>
                  <input id="correct-ruby" value={ruby} onChange={(event) => setRuby(event.target.value)} placeholder="工[こう]場[じょう]" />
                  <p>Put each kanji or kanji group before its reading in brackets, for example 工[こう]場[じょう]. Reading is calculated from furigana if left blank.</p>
                  {error && <p className="form-error" role="alert">{error}</p>}
                  <button className="primary-button" type="button" disabled={busy} onClick={save}>Save correction <span aria-hidden="true">→</span></button>
                </div>
              )}
            </>
          )}
          {error && !active && <p className="form-error" role="alert">{error}</p>}
        </div>
      </div>
    </main>
  );
}
