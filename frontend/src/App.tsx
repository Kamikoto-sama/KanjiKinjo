import { ArrowLeftIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { api, waitForJob, type SyncResult } from "./api";
import { cachedSimilar, cachedSnapshot, loadDictionary } from "./cache";
import { SyncResultsDialog } from "./components/SyncResultsDialog";
import { Badge } from "./components/ui/badge";
import { Card, CardContent, CardHeader } from "./components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "./components/ui/empty";
import { Item, ItemContent, ItemGroup, ItemTitle } from "./components/ui/item";
import { Spinner } from "./components/ui/spinner";
import { Button } from "./components/ui/button";
import { LoginPage } from "./pages/LoginPage";
import { ImportPage } from "./pages/ImportPage";
import { goBack } from "./navigation";
import { CorrectionsPage } from "./pages/CorrectionsPage";
import { DuplicatesPage } from "./pages/DuplicatesPage";
import { SetupPage } from "./pages/SetupPage";
import type { Snapshot, Status } from "./types";
import { wordPath } from "./wordPath";

let automaticSyncStarted = false;
const WordPage = lazy(() => import("./pages/WordPage"));

function LoadingScreen() {
  return (
    <main className="screen active loading-screen">
      <Empty role="status">
        <EmptyHeader>
          <Spinner aria-hidden="true" />
          <EmptyTitle>Loading KanjiGraph…</EmptyTitle>
        </EmptyHeader>
      </Empty>
    </main>
  );
}

function WordRoute({
  snapshot,
  status,
  similar,
  onSync,
}: {
  snapshot: Snapshot | null;
  status: Status | null;
  similar: Record<string, string[]>;
  onSync: (returnFocus?: HTMLElement) => Promise<SyncResult | null>;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const spelling = params.get("spelling");
  const reading = params.get("reading");
  const normalizedSpelling = spelling?.normalize("NFC") || "";
  const normalizedReading =
    reading
      ?.normalize("NFC")
      .replace(/[ァ-ヶ]/g, (char) =>
        String.fromCharCode(char.charCodeAt(0) - 96),
      ) || "";
  const matches =
    snapshot?.words.filter(
      (word) =>
        word.spelling === normalizedSpelling &&
        (!normalizedReading || word.reading === normalizedReading),
    ) ?? [];
  const word = matches.length === 1 ? matches[0] : undefined;

  useEffect(() => {
    if (!normalizedSpelling) {
      navigate("/search", { replace: true });
      return;
    }
    const search = new URLSearchParams(location.search);
    const legacyFilters = ["group", "kanji", "filterReading"];
    const hasLegacyFilters = legacyFilters.some((key) => search.has(key));
    for (const key of legacyFilters) search.delete(key);
    if (!snapshot) {
      const query = search.toString();
      sessionStorage.setItem(
        "pendingWord",
        query ? `${location.pathname}?${query}` : location.pathname,
      );
      navigate("/setup", { replace: true });
      return;
    }
    const replace = { replace: true, state: location.state };
    if (
      word &&
      (hasLegacyFilters ||
        spelling !== word.spelling ||
        reading !== word.reading)
    ) {
      navigate(wordPath(word), replace);
    } else if (hasLegacyFilters) {
      navigate(
        { pathname: location.pathname, search: search.toString() },
        replace,
      );
    }
  }, [
    location,
    navigate,
    normalizedSpelling,
    reading,
    snapshot,
    spelling,
    word,
  ]);

  if (!normalizedSpelling) return null;
  if (snapshot) {
    if (matches.length <= 1)
      return (
        <Suspense fallback={<LoadingScreen />}>
          <WordPage
            key={location.key}
            snapshot={snapshot}
            word={word}
            config={status?.config || null}
            hasAnkiSession={Boolean(status?.hasAnkiSession)}
            similar={similar}
            onSync={onSync}
          />
        </Suspense>
      );
    return (
      <main className="screen active">
        <Card className="setup-window gap-0 py-0">
          <CardHeader className="setup-header">
            <Button
              variant="ghost"
              size="icon-lg"
              type="button"
              aria-label="Back"
              onClick={() => goBack(navigate, "/search")}
            >
              <ArrowLeftIcon className="size-5" aria-hidden="true" />
            </Button>
            <h1>Choose a reading</h1>
          </CardHeader>
          <CardContent className="setup-content">
            <ItemGroup
              role="group"
              aria-label="Available readings"
              className="gap-2"
            >
              {matches.map((word) => (
                <Item asChild key={word.wordId} variant="outline">
                  <Link
                    to={wordPath(word)}
                    replace
                    className="text-foreground no-underline"
                  >
                    <ItemContent>
                      <ItemTitle>{word.spelling}</ItemTitle>
                    </ItemContent>
                    <Badge variant="secondary">{word.reading}</Badge>
                  </Link>
                </Item>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
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
  const [searchQuery, setSearchQuery] = useState("");
  const [similar, setSimilar] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [dictionaryProgress, setDictionaryProgress] = useState("");
  const [syncIssues, setSyncIssues] = useState<{
    unresolvedCount: number;
    duplicateCount: number;
    returnFocus?: HTMLElement;
  } | null>(null);
  const pendingSync = useRef<Promise<SyncResult | null> | null>(null);
  const syncReturnFocus = useRef<HTMLElement | undefined>(undefined);

  function onSynced(
    { snapshot: updated, newUnresolved, newDuplicates }: SyncResult,
    returnFocus?: HTMLElement,
  ) {
    if (updated) setSnapshot(updated);
    if (newUnresolved.length || newDuplicates.length) {
      setSyncIssues({
        unresolvedCount: newUnresolved.length,
        duplicateCount: newDuplicates.length,
        returnFocus,
      });
    }
  }

  function syncDeck(
    shouldApply?: () => Promise<boolean>,
    returnFocus?: HTMLElement,
  ): Promise<SyncResult | null> {
    if (returnFocus) syncReturnFocus.current = returnFocus;
    if (!pendingSync.current) {
      async function runSync() {
        const { jobId } = await api.sync();
        const downloaded = await waitForJob(jobId);
        if (shouldApply && !(await shouldApply())) return null;
        const result = await api.applySync(downloaded);
        onSynced(result, syncReturnFocus.current);
        return result;
      }

      pendingSync.current = runSync().finally(() => {
        pendingSync.current = null;
        syncReturnFocus.current = undefined;
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
            return (
              Boolean(latestStatus.config) &&
              JSON.stringify(latestStatus.config) ===
                JSON.stringify(current.config) &&
              !["/import", "/login"].includes(window.location.pathname)
            );
          }).catch(() => {
            automaticSyncStarted = false;
          });
        }
        void api
          .manifest()
          .then((manifest) =>
            loadDictionary(manifest, (done, total) =>
              setDictionaryProgress(`Loading dictionary ${done}/${total}`),
            ),
          )
          .then(async () => {
            if (active) {
              setSimilar(await cachedSimilar());
              setDictionaryProgress("");
            }
          })
          .catch(() => {
            if (active && navigator.onLine)
              setDictionaryProgress("Dictionary download paused");
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

  if (loading) return <LoadingScreen />;

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/import" replace />} />
        <Route
          path="/search"
          element={
            snapshot ? (
              <Suspense fallback={<LoadingScreen />}>
                <WordPage
                  snapshot={snapshot}
                  search={{ query: searchQuery, onQueryChange: setSearchQuery }}
                  config={status?.config || null}
                  hasAnkiSession={Boolean(status?.hasAnkiSession)}
                  similar={similar}
                  onSync={(returnFocus) => syncDeck(undefined, returnFocus)}
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
          path="/import"
          element={
            <ImportPage
              status={status}
              fallback={snapshot ? "/search" : "/login"}
            />
          }
        />
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
              <DuplicatesPage
                initialConfig={status.config}
                snapshotVersion={snapshot?.snapshotVersion}
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
              snapshot={snapshot}
              status={status}
              similar={similar}
              onSync={(returnFocus) => syncDeck(undefined, returnFocus)}
            />
          }
        />
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
      {dictionaryProgress && (
        <Badge
          variant="secondary"
          className="fixed bottom-4 left-4"
          role="status"
        >
          {dictionaryProgress.startsWith("Loading") && (
            <Spinner aria-hidden="true" />
          )}
          {dictionaryProgress}
        </Badge>
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
