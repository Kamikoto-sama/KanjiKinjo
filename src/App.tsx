import { useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { api, waitForJob, type SyncResult } from "./api";
import {
  cachedSimilar,
  cachedSnapshot,
  loadDictionary,
} from "./cache";
import { SyncResultsDialog } from "./components/SyncResultsDialog";
import { LoginPage } from "./pages/LoginPage";
import { ImportPage } from "./pages/ImportPage";
import { goBack } from "./navigation";
import { CorrectionsPage } from "./pages/CorrectionsPage";
import { DuplicatesPage } from "./pages/DuplicatesPage";
import { SetupPage } from "./pages/SetupPage";
import { WordPage } from "./pages/WordPage";
import type { Snapshot, Status } from "./types";
import { wordPath } from "./wordPath";

let automaticSyncStarted = false;

function WordRoute({ snapshot, status, similar, onSync }: {
  snapshot: Snapshot | null;
  status: Status | null;
  similar: Record<string, string[]>;
  onSync: () => Promise<SyncResult | null>;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const spelling = params.get("spelling");
  const reading = params.get("reading");
  const normalizedSpelling = spelling?.normalize("NFC") || "";
  const normalizedReading = reading?.normalize("NFC").replace(/[ァ-ヶ]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 96),
  ) || "";
  const matches = snapshot?.words.filter((word) =>
    word.spelling === normalizedSpelling && (!normalizedReading || word.reading === normalizedReading),
  ) ?? [];
  const word = matches.length === 1 ? matches[0] : undefined;

  useEffect(() => {
    if (!snapshot) {
      sessionStorage.setItem(
        "pendingWord",
        location.pathname + location.search,
      );
      navigate("/setup", { replace: true });
      return;
    }
    if (word && (spelling !== word.spelling || reading !== word.reading))
      navigate(wordPath(word), { replace: true });
  }, [location, navigate, reading, snapshot, spelling, word]);

  if (snapshot) {
    if (matches.length <= 1)
      return <WordPage snapshot={snapshot} word={word} config={status?.config || null}
        hasAnkiSession={Boolean(status?.hasAnkiSession)} similar={similar} onSync={onSync} />;
    return (
      <main className="screen active">
        <div className="setup-window">
          <header className="setup-header">
            <button className="icon-button" type="button" aria-label="Back" onClick={() => goBack(navigate, snapshot.words[0] ? wordPath(snapshot.words[0]) : "/setup")}>←</button>
            <h1>Choose a reading</h1>
          </header>
          <div className="choice-list">
            {matches.map((word) => (
              <button
                key={word.wordId}
                className="word-row"
                type="button"
                onClick={() =>
                  navigate(wordPath(word), { replace: true })
                }
              >
                {word.spelling}{" "}
                <span className="word-row-meaning">{word.reading}</span>
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }
  return null;
}

function Application() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [similar, setSimilar] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [dictionaryProgress, setDictionaryProgress] = useState("");
  const [syncIssues, setSyncIssues] = useState<{ unresolvedCount: number; duplicateCount: number } | null>(null);
  const pendingSync = useRef<Promise<SyncResult | null> | null>(null);

  function onSynced({ snapshot: updated, newUnresolved, newDuplicates }: SyncResult) {
    if (updated) setSnapshot(updated);
    if (newUnresolved.length || newDuplicates.length) {
      setSyncIssues({ unresolvedCount: newUnresolved.length, duplicateCount: newDuplicates.length });
    }
  }

  function syncDeck(shouldApply?: () => Promise<boolean>): Promise<SyncResult | null> {
    if (!pendingSync.current) {
      async function runSync() {
        const { jobId } = await api.sync();
        const downloaded = await waitForJob(jobId);
        if (shouldApply && !(await shouldApply())) return null;
        const result = await api.applySync(downloaded);
        onSynced(result);
        return result;
      }

      pendingSync.current = runSync().finally(() => {
        pendingSync.current = null;
      });
    }
    return pendingSync.current;
  }

  useEffect(() => {
    let active = true;
    async function initialize() {
      const cached = await cachedSnapshot();
      if (!active) return;
      if (cached) setSnapshot(cached);
      setSimilar(await cachedSimilar());
      try {
        const current = await api.status();
        if (!active) return;
        setStatus(current);
        const fresh = current.hasSnapshot ? await api.snapshot() : null;
        if (active) setSnapshot(fresh);
        if (
          current.hasAnkiSession &&
          current.config &&
          navigator.onLine &&
          !automaticSyncStarted &&
          (!fresh || Date.now() - Date.parse(fresh.syncedAt) > 15 * 60 * 1000)
        ) {
          automaticSyncStarted = true;
          void syncDeck(async () => {
            const latestStatus = await api.status();
            return Boolean(latestStatus.config) &&
              JSON.stringify(latestStatus.config) === JSON.stringify(current.config) &&
              !["/import", "/login"].includes(window.location.pathname);
          }).catch(() => {
            automaticSyncStarted = false;
          });
        }
        void api.manifest().then((manifest) => loadDictionary(manifest, (done, total) =>
          setDictionaryProgress(`Loading dictionary ${done}/${total}`),
        ))
          .then(async () => {
            if (active) {
              setSimilar(await cachedSimilar());
              setDictionaryProgress("");
            }
          })
          .catch(() => {
            if (active && navigator.onLine) setDictionaryProgress("Dictionary download paused");
          });
      } catch {
        if (active)
          setStatus({
            hasCollection: Boolean(cached),
            hasAnkiSession: false,
            hasSnapshot: Boolean(cached),
            config: null,
          });
      } finally {
        if (active) setLoading(false);
      }
    }
    initialize();
    return () => {
      active = false;
    };
  }, []);

  if (loading)
    return (
      <main className="screen active loading-screen">
        <div className="loading-indicator">Loading KanjiGraph…</div>
      </main>
    );

  const firstWord = snapshot?.words[0];
  const entry = firstWord
    ? wordPath(firstWord)
    : status?.hasCollection
      ? "/setup"
      : "/import";
  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to={entry} replace />} />
        <Route path="/import" element={<ImportPage status={status} fallback={firstWord ? wordPath(firstWord) : "/login"} />} />
        <Route path="/login" element={<LoginPage status={status} />} />
        <Route
          path="/setup"
          element={
            <SetupPage
              initialConfig={status?.config || null}
              snapshotVersion={snapshot?.snapshotVersion}
              onReady={(next, config) => {
                setSnapshot(next);
                setStatus({
                  hasCollection: true,
                  hasAnkiSession: status?.hasAnkiSession || false,
                  hasSnapshot: true,
                  config,
                });
                void api
                  .status()
                  .then(setStatus)
                  .catch(() => undefined);
              }}
            />
          }
        />
        <Route
          path="/duplicates"
          element={
            status?.hasCollection ? (
              <DuplicatesPage initialConfig={status.config} snapshotVersion={snapshot?.snapshotVersion} />
            ) : (
              <Navigate to={entry} replace />
            )
          }
        />
        <Route
          path="/corrections"
          element={
            status?.hasCollection ? (
              <CorrectionsPage initialConfig={status.config} onSnapshot={setSnapshot} />
            ) : (
              <Navigate to={entry} replace />
            )
          }
        />
        <Route path="/word" element={
          <WordRoute snapshot={snapshot} status={status} similar={similar} onSync={syncDeck} />
        } />
        <Route path="*" element={<Navigate to={entry} replace />} />
      </Routes>
      {syncIssues && (
        <SyncResultsDialog
          {...syncIssues}
          onDismiss={() => setSyncIssues(null)}
          onOpenSetup={() => {
            if (pathname !== "/setup") navigate("/setup");
          }}
        />
      )}
      {dictionaryProgress && (
        <div className="dictionary-progress" role="status">
          {dictionaryProgress}
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Application />
    </BrowserRouter>
  );
}
