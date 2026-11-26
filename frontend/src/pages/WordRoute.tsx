import { lazy, Suspense, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { SyncResult } from "../api";
import { LoadingScreen } from "../components/LoadingScreen";
import { snapshotWords } from "../snapshot";
import type { Snapshot, Status, UnstudiedPreference, Word } from "../types";
import { wordPath } from "../wordPath";

const WordPage = lazy(() => import("./WordPage"));
const WordReadings = lazy(() =>
    import("./WordPage").then(({ WordReadings }) => ({ default: WordReadings })),
);

export function WordRoute({
  snapshot,
  status,
  similar,
  onSync,
                            ...preference
                          }: UnstudiedPreference & {
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
  const matchesQuery = (word: Word) =>
      word.spelling === normalizedSpelling &&
      (!normalizedReading || word.reading === normalizedReading);
  const allLists = snapshot && snapshotWords(snapshot, true);
  const visibleLists = snapshot && snapshotWords(snapshot, preference.showUnstudied);
  const matches = allLists?.words.filter(matchesQuery) ?? [];
  const visibleMatches =
      visibleLists === allLists ? matches : visibleLists?.words.filter(matchesQuery) ?? [];
  const word = matches.length === 1
      ? (visibleMatches[0] ?? matches[0])
      : undefined;

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
    const header = {
      ...preference,
      snapshot,
      config: status?.config ?? null,
      hasAnkiSession: Boolean(status?.hasAnkiSession),
      onSync,
    };
    return (
        <Suspense fallback={<LoadingScreen/>}>
          {matches.length > 1 ? (
              <WordReadings {...header} readings={visibleMatches}/>
          ) : (
          <WordPage
              {...header}
            key={location.key}
            word={word}
            similar={similar}
          />
          )}
        </Suspense>
    );
  }
  return null;
}
