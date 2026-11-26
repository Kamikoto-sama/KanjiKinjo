import { liveQuery } from "dexie";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate, } from "react-router-dom";
import { toast } from "sonner";
import { api, type SyncResult, waitForJob } from "./api";
import {
  cache,
  type CachedDictionary,
  readShowUnstudiedWords,
  readStartup,
  replaceCollection,
  saveShowUnstudiedWords,
} from "./cache";
import { LoadingScreen } from "./components/LoadingScreen";
import { SyncResultsDialog } from "./components/SyncResultsDialog";
import { Empty, EmptyHeader, EmptyTitle } from "./components/ui/empty";
import { Button } from "./components/ui/button";
import { Toaster } from "./components/ui/sonner";
import { LoginPage } from "./pages/LoginPage";
import { ImportPage } from "./pages/ImportPage";
import { CorrectionsPage } from "./pages/CorrectionsPage";
import { DictionariesPage } from "./pages/DictionariesPage";
import { DuplicatesPage } from "./pages/DuplicatesPage";
import { SetupPage } from "./pages/SetupPage";
import { WordRoute } from "./pages/WordRoute";
import type { AnkiAuth, CollectionData, Snapshot, Status } from "./types";

const SearchPage = lazy(() => import("./pages/SearchPage"));

function Application() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [hasUnstudiedData, setHasUnstudiedData] = useState(false);
  const [showUnstudied, setShowUnstudied] = useState(false);
  const [savingUnstudiedPreference, setSavingUnstudiedPreference] =
      useState(false);
  const [startup, setStartup] = useState<"loading" | "error" | "ready">(
    "loading",
  );
  const [startupAttempt, setStartupAttempt] = useState(0);
  const startupRead = useRef<Promise<
    Awaited<ReturnType<typeof readStartup>>
  > | null>(null);
  const savedSearch = useRef("");
  const collectionEpoch = useRef(0);
  const automaticSyncStarted = useRef(false);
  const hasCollection = Boolean(status?.hasCollection);
  const [dictionary, setDictionary] = useState<CachedDictionary>({
    version: null,
    similar: {},
  });
  const [syncIssues, setSyncIssues] = useState<{
    unresolvedCount: number;
    duplicateCount: number;
    returnFocus?: HTMLElement;
  } | null>(null);
  const pendingSync = useRef<{
    controller: AbortController;
    promise: Promise<SyncResult | null>;
    returnFocus?: HTMLElement;
  } | null>(null);

  async function changeCollection(
    collection: CollectionData,
    auth: AnkiAuth | null,
  ) {
    const next = await replaceCollection(collection, auth);
    collectionEpoch.current++;
    pendingSync.current?.controller.abort();
    pendingSync.current = null;
    savedSearch.current = "";
    sessionStorage.removeItem("setupDraft");
    setCollectionId(next.collectionId);
    setStatus(next.status);
    setHasUnstudiedData(Boolean(collection.unstudiedNotes));
    setSnapshot(null);
    setSyncIssues(null);
    navigate("/dictionaries");
  }

  const syncDeck = useCallback(function syncDeck(
    shouldApply?: () => boolean,
    returnFocus?: HTMLElement,
  ): Promise<SyncResult | null> {
    if (pendingSync.current) {
      if (returnFocus) pendingSync.current.returnFocus = returnFocus;
      return pendingSync.current.promise;
    }
    const controller = new AbortController();
    const epoch = collectionEpoch.current;
    const stillCurrent = () => collectionEpoch.current === epoch;
    const promise = (async () => {
      try {
        const { jobId, source } = await api.sync();
        const downloaded = await waitForJob(jobId, controller.signal);
        if (!stillCurrent() || (shouldApply && !shouldApply())) return null;
        const result = await api.applySync(downloaded, source);
        if (!result || !stillCurrent()) return null;
        setHasUnstudiedData(Boolean(downloaded.collection.unstudiedNotes));
        if (result.snapshot) setSnapshot(result.snapshot);
        if (result.newUnresolved.length || result.newDuplicates.length) {
          setSyncIssues({
            unresolvedCount: result.newUnresolved.length,
            duplicateCount: result.newDuplicates.length,
            returnFocus: pendingSync.current?.returnFocus,
          });
        }
        return result;
      } catch (error) {
        if (!stillCurrent()) return null;
        throw error;
      }
    })().finally(() => {
      if (pendingSync.current?.controller === controller)
        pendingSync.current = null;
    });
    pendingSync.current = { controller, promise, returnFocus };
    return promise;
  }, []);

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        startupRead.current ??= startupAttempt
          ? cache.open().then(readStartup)
          : readStartup();
        const current = await startupRead.current;
        if (!active) return;
        setStatus(current.status);
        setSnapshot(current.snapshot);
        setCollectionId(current.collectionId);
        setHasUnstudiedData(current.hasUnstudiedData);
        setShowUnstudied(current.showUnstudied);
        setDictionary(current.dictionary);
        setStartup("ready");
      } catch {
        if (active) setStartup("error");
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, [startupAttempt]);

  useEffect(() => {
    if (startup !== "ready") return;
    const subscription = liveQuery(readShowUnstudiedWords).subscribe({
      next: setShowUnstudied,
      error: () => toast.error("Could not read the word display setting"),
    });
    return () => subscription.unsubscribe();
  }, [startup]);

  async function changeShowUnstudied(show: boolean) {
    setSavingUnstudiedPreference(true);
    try {
      await saveShowUnstudiedWords(show);
      setShowUnstudied(show);
    } catch {
      toast.error("Could not save the word display setting");
    } finally {
      setSavingUnstudiedPreference(false);
    }
  }

  useEffect(() => {
    const needsSync =
      !snapshot || Date.now() - Date.parse(snapshot.syncedAt) > 15 * 60 * 1000;
    if (
      !dictionary.version ||
      !status?.hasAnkiSession ||
      !status.config ||
      !navigator.onLine ||
      pathname === "/dictionaries" ||
      automaticSyncStarted.current ||
      !needsSync
    )
      return;

    automaticSyncStarted.current = true;
    void syncDeck(
      () =>
        !["/import", "/login", "/dictionaries"].includes(
          window.location.pathname,
        ),
    ).catch(() => {
      automaticSyncStarted.current = false;
    });
  }, [dictionary.version, pathname, status, snapshot, syncDeck]);

  if (startup === "loading") return <LoadingScreen />;
  if (startup === "error") {
    return (
      <main className="screen active loading-screen">
        <Empty>
          <EmptyHeader role="alert">
            <EmptyTitle>Could not open local storage</EmptyTitle>
          </EmptyHeader>
          <Button
            onClick={() => {
              startupRead.current = null;
              setStartup("loading");
              setStartupAttempt((attempt) => attempt + 1);
            }}
          >
            Retry
          </Button>
        </Empty>
      </main>
    );
  }

  const unstudiedPreference = {
    showUnstudied,
    savingUnstudiedPreference,
    onShowUnstudiedChange: changeShowUnstudied,
  };
  const hasAnkiSession = Boolean(status?.hasAnkiSession);
  const syncFromPage = (returnFocus?: HTMLElement) =>
      syncDeck(undefined, returnFocus);
  return (
    <>
      <Routes>
        <Route
            path="/"
            element={
              <Navigate
                  to={snapshot && dictionary.version ? "/search" : "/import"}
                  replace
              />
            }
        />
        <Route
          path="/import"
          element={
            <ImportPage
              status={status}
              onReplace={changeCollection}
            />
          }
        />
        <Route
          path="/login"
          element={<LoginPage status={status} onReplace={changeCollection} />}
        />
        <Route
          path="/dictionaries"
          element={
            hasCollection ? (
              <DictionariesPage
                ready={Boolean(dictionary.version)}
                onReady={setDictionary}
              />
            ) : (
              <Navigate to="/import" replace />
            )
          }
        />
        <Route
          element={
            hasCollection && !dictionary.version ? (
              <Navigate to="/dictionaries" replace />
            ) : (
              <Outlet />
            )
          }
        >
          <Route
            path="/search"
            element={
              snapshot ? (
                <Suspense fallback={<LoadingScreen />}>
                  <SearchPage
                      {...unstudiedPreference}
                    key={collectionId ?? "legacy"}
                    snapshot={snapshot}
                    savedQuery={savedSearch}
                    config={status?.config || null}
                      hasAnkiSession={hasAnkiSession}
                      onSync={syncFromPage}
                  />
                </Suspense>
              ) : (
                <Navigate
                  to={status?.hasCollection ? "/setup" : "/import"}
                  replace
                />
              )
            }
          />
          <Route
            path="/setup"
            element={
              hasCollection ? (
                <SetupPage
                    {...unstudiedPreference}
                  key={collectionId ?? "legacy"}
                  initialConfig={status?.config || null}
                  snapshotVersion={snapshot?.snapshotVersion}
                    hasUnstudiedData={hasUnstudiedData}
                    hasAnkiSession={hasAnkiSession}
                    onSync={syncFromPage}
                  onReady={(next, config) => {
                    setSnapshot(next);
                    setStatus(
                      (current) =>
                        current && {
                          ...current,
                          hasCollection: true,
                          hasSnapshot: true,
                          config,
                        },
                    );
                  }}
                />
              ) : (
                <Navigate to="/import" replace />
              )
            }
          />
          <Route
            path="/duplicates"
            element={
              status?.hasCollection ? (
                <DuplicatesPage
                  initialConfig={status.config}
                  snapshotVersion={snapshot?.snapshotVersion}
                  showUnstudied={showUnstudied}
                />
              ) : (
                <Navigate to="/import" replace />
              )
            }
          />
          <Route
            path="/corrections"
            element={
              status?.hasCollection ? (
                <CorrectionsPage
                  initialConfig={status.config}
                  snapshotVersion={snapshot?.snapshotVersion}
                  showUnstudied={showUnstudied}
                  onSnapshot={setSnapshot}
                />
              ) : (
                <Navigate to="/import" replace />
              )
            }
          />
          <Route
            path="/word"
            element={
              <WordRoute
                  {...unstudiedPreference}
                snapshot={snapshot}
                status={status}
                similar={dictionary.similar}
                  onSync={syncFromPage}
              />
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/import" replace />} />
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
      <Toaster closeButton/>
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
