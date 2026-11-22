import { ArrowLeftIcon } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { SyncResult } from "../api";
import { LoadingScreen } from "../components/LoadingScreen";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Item, ItemContent, ItemGroup, ItemTitle } from "../components/ui/item";
import { goBack } from "../navigation";
import type { Snapshot, Status } from "../types";
import { wordPath } from "../wordPath";

const WordPage = lazy(() => import("./WordPage"));

export function WordRoute({
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
