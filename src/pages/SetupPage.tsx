import { wordPath } from "../wordPath";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { MappingField } from "../components/MappingField";
import { RecordPreview } from "../components/RecordPreview";
import { ReplaceDeckDialog } from "../components/ReplaceDeckDialog";
import { SkipWordsDialog } from "../components/SkipWordsDialog";
import { DuplicateWordsNotice, UnresolvedWordsNotice } from "../components/WordNotices";
import { goBack } from "../navigation";
import { readSetupDraft } from "../setupDraft";
import type { Config, Deck, Mapping, NoteType, Preview, Snapshot } from "../types";

type Props = {
  initialConfig: Config | null;
  snapshotVersion?: string;
  onReady: (snapshot: Snapshot, config: Config) => void;
};

function guessMapping(type: NoteType): Mapping {
  const find = (pattern: RegExp) =>
    type.fields.find((field) => pattern.test(field)) || "";
  return {
    status: "unconfigured",
    spelling: find(/expression|word|front|japanese/i) || type.fields[0] || "",
    translation:
      find(/meaning|translation|back|english/i) || type.fields[1] || "",
    reading: "",
  };
}

function savedDraft(initialConfig: Config | null, entryKey: string) {
  const draft = readSetupDraft();
  if (!initialConfig) return draft;
  return draft?.entryKey === entryKey && draft.baseConfig === JSON.stringify(initialConfig)
    ? draft
    : null;
}

export function SetupPage({ initialConfig, snapshotVersion, onReady }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const [draft] = useState(() => savedDraft(initialConfig, location.key));
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckId, setDeckId] = useState(draft?.deckId || initialConfig?.deckId || 0);
  const [includeChildren, setIncludeChildren] = useState(
    draft?.includeChildren ?? initialConfig?.includeChildren ?? true,
  );
  const [types, setTypes] = useState<NoteType[]>([]);
  const [mappings, setMappings] = useState<Record<string, Mapping>>(
    draft?.mappings || initialConfig?.mappings || {},
  );
  const [selectedType, setSelectedType] = useState(draft?.selectedType || 0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const previewRequest = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingSkip, setPendingSkip] = useState<{ count: number; config: Config } | null>(null);
  const [pendingDeckId, setPendingDeckId] = useState<number | null>(null);
  const previewSignature = JSON.stringify(
    Object.entries(mappings).map(([id, item]) => [
      id, item.spelling, item.reading, item.translation, item.status === "skipped",
    ]),
  );

  useEffect(() => {
    api
      .decks()
      .then(setDecks)
      .catch((reason) => setError(reason.message));
  }, []);
  useEffect(() => {
    sessionStorage.setItem("setupDraft", JSON.stringify({
      deckId, includeChildren, mappings, selectedType,
      entryKey: location.key,
      baseConfig: initialConfig ? JSON.stringify(initialConfig) : null,
    }));
  }, [deckId, includeChildren, mappings, selectedType, location.key, initialConfig]);
  useEffect(() => {
    if (!deckId) {
      setTypes([]);
      setPreview(null);
      return;
    }
    let active = true;
    api
      .noteTypes(deckId, includeChildren)
      .then((items) => {
        if (!active) return;
        setTypes(items);
        setSelectedType((index) => Math.max(0, Math.min(index, items.length - 1)));
        setMappings((previous) =>
          Object.fromEntries(
            items.map((item) => [
              String(item.id),
              previous[String(item.id)] || guessMapping(item),
            ]),
          ),
        );
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      });
    return () => { active = false; };
  }, [deckId, includeChildren, snapshotVersion]);

  useEffect(() => {
    if (!deckId || !types.length) {
      ++previewRequest.current;
      return;
    }
    const request = ++previewRequest.current;
    const timer = window.setTimeout(() => {
      api.preview({ deckId, includeChildren, mappings })
        .then((result) => {
          if (request === previewRequest.current) setPreview(result);
        })
        .catch((reason) => {
          if (request === previewRequest.current) setError(reason.message);
        });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [deckId, includeChildren, previewSignature, types, snapshotVersion]);

  const current = types[selectedType];
  const mapping = current ? mappings[String(current.id)] : null;
  const unresolvedInType = current
    ? preview?.unresolved.filter((word) => word.noteTypeId === current.id) || []
    : [];
  const duplicateCount = preview?.duplicateGroups.reduce((count, { records }) =>
    count + records.filter((record) => record.noteTypeId === current?.id).length, 0) ?? 0;
  const ready = types.filter(
    (type) => mappings[String(type.id)]?.status !== "unconfigured",
  ).length;
  const canContinue =
    types.length > 0 &&
    ready === types.length &&
    types.some((type) => mappings[String(type.id)]?.status === "configured");

  function change(field: keyof Mapping, value: string) {
    if (!current || !mapping) return;
    setPreview(null);
    setError("");
    setMappings((previous) => ({
      ...previous,
      [String(current.id)]: {
        ...mapping,
        [field]: value,
        status: "unconfigured",
      },
    }));
  }

  function changeStatus(status: Mapping["status"]) {
    if (!current || !mapping) return;
    if (status === "skipped" || mapping.status === "skipped") setPreview(null);
    setError("");
    setMappings((previous) => ({
      ...previous,
      [String(current.id)]: { ...mapping, status },
    }));
  }

  function selectDeck(nextDeckId: number) {
    setError("");
    setDeckId(nextDeckId);
    setTypes([]);
    setMappings(nextDeckId === initialConfig?.deckId ? initialConfig.mappings : {});
    if (nextDeckId === initialConfig?.deckId) {
      setIncludeChildren(initialConfig.includeChildren);
    }
    setSelectedType(0);
    setPreview(null);
  }

  function requestDeckChange(nextDeckId: number) {
    if (nextDeckId === deckId) return;
    if (nextDeckId > 0 && initialConfig && nextDeckId !== initialConfig.deckId) {
      setPendingDeckId(nextDeckId);
      return;
    }
    selectDeck(nextDeckId);
  }

  async function continueToWords() {
    if (!canContinue) return;
    setBusy(true);
    setError("");
    const config = { deckId, includeChildren, mappings };
    try {
      const latestPreview = await api.preview(config);
      setPreview(latestPreview);
      if (!Object.values(latestPreview.wordsByType).some((words) => words.length)) {
        return;
      }
      if (latestPreview.unresolved.length) {
        setPendingSkip({ count: latestPreview.unresolved.length, config });
        return;
      }
      await saveAndOpenWords(config);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not build snapshot",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveAndOpenWords(config: Config) {
    await api.saveConfig(config);
    const snapshot = await api.snapshot();
    onReady(snapshot, config);
    sessionStorage.removeItem("setupDraft");
    const pending = sessionStorage.getItem("pendingWord");
    sessionStorage.removeItem("pendingWord");
    navigate(pending || (snapshot.words[0] ? wordPath(snapshot.words[0]) : "/setup"), {
      replace: true,
    });
  }

  async function continueAfterWarning() {
    if (!pendingSkip) return;
    const config = pendingSkip.config;
    setPendingSkip(null);
    setBusy(true);
    setError("");
    try {
      await saveAndOpenWords(config);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not build snapshot");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen active">
      <div className="setup-window">
        <header className="setup-header">
          <button
            className="icon-button"
            type="button"
            aria-label="Back"
            onClick={() => goBack(navigate, "/import")}
          >
            ←
          </button>
          <h1>Deck &amp; fields</h1>
        </header>
        <div className="setup-content">
          <div className="deck-settings">
            <label className="field-label" htmlFor="deck-select">
              Deck
            </label>
            <div className="select-wrap">
              <select
                id="deck-select"
                value={deckId}
                onChange={(event) => requestDeckChange(Number(event.target.value))}
              >
                <option value={0}>Select a deck</option>
                {decks
                  .filter((deck) => deck.id !== 1)
                  .map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.name}
                    </option>
                  ))}
              </select>
            </div>
            <label className="toggle-row" htmlFor="subdecks-toggle">
              <span>Include subdecks</span>
              <span className="switch">
                <input
                  id="subdecks-toggle"
                  type="checkbox"
                  checked={includeChildren}
                  onChange={(event) => {
                    setTypes([]);
                    setPreview(null);
                    setIncludeChildren(event.target.checked);
                  }}
                />
                <span className="switch-track" />
              </span>
            </label>
          </div>
          {deckId > 0 && types.length > 0 && (
            <section
              className="note-settings"
              aria-label="Note type field mapping"
            >
              <div className="note-tabs" role="tablist" aria-label="Note types">
                {types.map((type, index) => {
                  const status =
                    mappings[String(type.id)]?.status || "unconfigured";
                  return (
                    <button
                      key={type.id}
                      className={`note-tab ${index === selectedType ? "active" : ""}`}
                      data-status={status}
                      type="button"
                      role="tab"
                      aria-selected={index === selectedType}
                      onClick={() => setSelectedType(index)}
                    >
                      <span className="status-icon" aria-hidden="true">
                        {status === "configured"
                          ? "✓"
                          : status === "skipped"
                            ? "✕"
                            : ""}
                      </span>
                      <span>{type.name}</span>
                      <span className="note-count">
                        {type.count.toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>
              {current && mapping && (
                <div
                  className={`note-panel ${mapping.status === "skipped" ? "is-skipped" : ""}`}
                  role="tabpanel"
                >
                  {mapping.status === "skipped" && <div className="skipped-banner"><span>This card type is excluded</span><button className="text-button" type="button" onClick={() => changeStatus("unconfigured")}>Include</button></div>}
                  <div className="mapping-grid">
                    <MappingField
                      label="Word / spelling"
                      value={mapping.spelling}
                      options={current.fields}
                      onChange={(value) => change("spelling", value)}
                      disabled={mapping.status === "skipped"}
                    />
                    <MappingField
                      label="Reading / furigana"
                      value={mapping.reading}
                      options={["", ...current.fields]}
                      onChange={(value) => change("reading", value)}
                      disabled={mapping.status === "skipped"}
                    />
                    <MappingField
                      label="Translation"
                      value={mapping.translation}
                      options={["", ...current.fields]}
                      emptyLabel="No translation"
                      onChange={(value) => change("translation", value)}
                      disabled={mapping.status === "skipped"}
                    />
                  </div>
                  <div className="type-actions">
                    <button
                      className="text-button"
                      type="button"
                      disabled={selectedType === 0}
                      onClick={() => setSelectedType(selectedType - 1)}
                    >
                      Back
                    </button>
                    <div className="type-action-right">
                    {mapping.status !== "skipped" && <button className="text-button" type="button" onClick={() => changeStatus("skipped")}>Skip this type</button>}
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        if (mapping.status !== "unconfigured") {
                          if (selectedType < types.length - 1) setSelectedType(selectedType + 1);
                          else void continueToWords();
                          return;
                        }
                        if (
                          !mapping.spelling ||
                          (mapping.translation && mapping.spelling === mapping.translation)
                        ) {
                          setError(
                            !mapping.spelling
                              ? "Choose a field for the Japanese word."
                              : "Choose different fields for word and translation.",
                          );
                          return;
                        }
                        setError("");
                        changeStatus("configured");
                      }}
                    >
                      {mapping.status !== "unconfigured" ? "Next" : "Save fields"}
                    </button>
                    </div>
                  </div>
                  {unresolvedInType.length > 0 && (
                    <UnresolvedWordsNotice
                      count={unresolvedInType.length}
                      inCardType
                      onManage={() => navigate(`/corrections?type=${current.id}`)}
                    />
                  )}
                  {duplicateCount > 0 && (
                    <DuplicateWordsNotice
                      count={duplicateCount}
                      inCardType
                      onView={() => navigate(`/duplicates?type=${current.id}`)}
                    />
                  )}
                  {mapping.status !== "skipped" && (preview ? <RecordPreview key={current.id} words={preview.wordsByType[String(current.id)] || []} /> : <p className="preview-empty">Checking examples…</p>)}
                </div>
              )}
            </section>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="setup-footer">
          <span aria-live="polite">
            {types.length ? `${ready} of ${types.length} types ready` : ""}
          </span>
          <button
            className="primary-button"
            type="button"
            disabled={!canContinue || busy || (preview !== null && !Object.values(preview.wordsByType).some((words) => words.length))}
            onClick={continueToWords}
          >
            {busy ? "Preparing…" : "Continue"} <span aria-hidden="true">→</span>
          </button>
        </footer>
      </div>
      {pendingDeckId !== null && (
        <ReplaceDeckDialog
          description="Choosing a different deck will reset the field settings shown here. Your current studied deck will be replaced when you finish setup."
          onCancel={() => setPendingDeckId(null)}
          onConfirm={() => {
            selectDeck(pendingDeckId);
            setPendingDeckId(null);
          }}
        />
      )}
      {pendingSkip && (
        <SkipWordsDialog
          count={pendingSkip.count}
          onCancel={() => setPendingSkip(null)}
          onManage={() => { setPendingSkip(null); navigate("/corrections"); }}
          onContinue={() => void continueAfterWarning()}
        />
      )}
    </main>
  );
}
