import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { ReplaceDeckDialog } from "../components/ReplaceDeckDialog";
import { goBack } from "../navigation";
import type { Status } from "../types";

type Props = { status: Status | null; fallback: string };

export function ImportPage({ status, fallback }: Props) {
  const navigate = useNavigate();
  const upload = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingImport, setPendingImport] = useState<"account" | "file" | null>(null);

  function cancelReplacement() {
    setPendingImport(null);
    if (upload.current) upload.current.value = "";
  }

  function requestAccountSwitch() {
    if (status?.hasCollection) setPendingImport("account");
    else navigate("/login");
  }

  function requestFileSelection() {
    if (status?.hasCollection) setPendingImport("file");
    else upload.current?.click();
  }

  function confirmReplacement() {
    const choice = pendingImport;
    setPendingImport(null);
    if (choice === "account") navigate("/login", { state: { replaceDeckConfirmed: true } });
    else if (choice === "file") upload.current?.click();
  }

  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await api.importFile(file);
      sessionStorage.removeItem("setupDraft");
      window.location.assign("/setup");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Import failed");
      setBusy(false);
      if (upload.current) upload.current.value = "";
    }
  }

  return (
    <main className="screen active">
      <div className="setup-window">
        <header className="setup-header">
          <button className="icon-button" type="button" aria-label="Back" onClick={() => goBack(navigate, fallback)}>←</button>
          <h1>Import deck</h1>
        </header>
        <div className="setup-content import-content">
          <div className="import-options">
            <div className="import-intro">
              <span className="import-eyebrow">GET STARTED</span>
              <h2>Bring your deck into KanjiGraph</h2>
              <p>Connect AnkiWeb or choose a deck file to see your words and their connections.</p>
            </div>
            {status?.hasCollection && <button className="primary-button import-continue" type="button" onClick={() => navigate("/setup")}>Continue</button>}
            <section className="import-option">
              <span className="import-option-icon" aria-hidden="true">↻</span>
              <h3>AnkiWeb</h3>
              {status?.hasAnkiSession ? (
                <>
                  <p className="import-account">Connected as <strong>{status.ankiAccount || "AnkiWeb account"}</strong></p>
                  <p>Import your studied cards from AnkiWeb.</p>
                  <button className="primary-button" type="button" disabled={busy} onClick={requestAccountSwitch}>Switch Account</button>
                </>
              ) : (
                <>
                  <p>Sign in to sync and import your studied cards from AnkiWeb.</p>
                  <button className="primary-button" type="button" disabled={busy} onClick={requestAccountSwitch}>Sign in to AnkiWeb</button>
                </>
              )}
            </section>
            <div className="import-divider"><span>OR</span></div>
            <section className="import-option">
              <span className="import-option-icon" aria-hidden="true">↑</span>
              <h3>Import deck directly from file</h3>
              {status?.hasCollection && !status.hasAnkiSession && <p className="import-account">Current deck was imported from a file.</p>}
              <p>Choose an Anki .apkg or .colpkg package with review history.</p>
              <button className="secondary-button" type="button" disabled={busy} onClick={requestFileSelection}>Choose file</button>
              <input ref={upload} className="visually-hidden" type="file" accept=".apkg,.colpkg" onChange={(event) => void importFile(event.target.files?.[0])} />
            </section>
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
        </div>
      </div>
      {pendingImport && <ReplaceDeckDialog onCancel={cancelReplacement} onConfirm={confirmReplacement} />}
    </main>
  );
}
