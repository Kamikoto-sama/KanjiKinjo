import { Fragment, useEffect, useRef } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type { CachedDictionary } from "../cache";
import { MissingWordSyncDialog } from "../components/MissingWordSyncDialog";
import { type WordHeaderProps, WordLayout } from "../components/WordLayout";
import { WordRelations } from "../components/WordRelations";
import { Badge } from "../components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../components/ui/breadcrumb";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle, } from "../components/ui/empty";
import { Item, ItemContent, ItemGroup, ItemTitle } from "../components/ui/item";
import { snapshotWords } from "../snapshot";
import type { Word } from "../types";
import { wordPath } from "../wordPath";

export function WordReadings({ readings, ...header }: WordHeaderProps & { readings: Word[] }) {
  const menuButton = useRef<HTMLButtonElement>(null);
  return (
      <WordLayout {...header} menuButton={menuButton}>
        <section className="word-content">
          <div className="mx-auto w-full max-w-2xl space-y-3 px-4 py-5">
            <h1 className="text-lg font-semibold">Choose a reading</h1>
            {readings.length ? (
                <ItemGroup role="group" aria-label="Available readings" className="gap-2">
                  {readings.map((word) => (
                      <Item asChild key={word.wordId} variant="outline">
                        <Link
                            to={wordPath(word)}
                            replace
                            data-unstudied={word.unstudied}
                            className="text-foreground no-underline"
                        >
                          <ItemContent>
                            <ItemTitle>{word.spelling}</ItemTitle>
                          </ItemContent>
                          {word.unstudied && <Badge variant="secondary">Unstudied</Badge>}
                          <Badge variant="secondary">{word.reading}</Badge>
                        </Link>
                      </Item>
                  ))}
                </ItemGroup>
            ) : (
                <p className="text-muted-foreground">
                  Turn on Show unstudied words in the menu to see the available readings.
                </p>
            )}
          </div>
        </section>
      </WordLayout>
  );
}

export default function WordPage({
  word,
                                     dictionary,
  ...header
}: WordHeaderProps & {
  word?: Word;
    dictionary: CachedDictionary;
}) {
  const { snapshot, hasAnkiSession, onSync, showUnstudied } = header;
  const visibleWords = snapshotWords(snapshot, showUnstudied).words;
  const allWords = snapshotWords(snapshot, true).words;
  const location = useLocation();
  const [params] = useSearchParams();
  const crumbs = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const wordId = word?.wordId;
  const trail: string[] =
    Array.isArray(location.state?.trail) &&
    location.state.trail.at(-1) === wordId
      ? location.state.trail
      : wordId
        ? [wordId]
        : [];
  useEffect(() => {
    crumbs.current?.scrollTo({ left: crumbs.current.scrollWidth });
  }, [wordId]);
  useEffect(() => {
    const key = `scroll:${location.key}`;
    const prior = sessionStorage.getItem(key);
    const scroller = content.current;
    if (!scroller) return;
    const frame = requestAnimationFrame(() => {
      scroller.scrollTop = prior ? Number(prior) : 0;
    });
    const remember = () =>
      sessionStorage.setItem(key, String(scroller.scrollTop));
    scroller.addEventListener("scroll", remember, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", remember);
    };
  }, [location.key]);
  function wordLink(next: Word) {
    const existing = trail.indexOf(next.wordId);
    const nextTrail =
      existing >= 0 ? trail.slice(0, existing + 1) : [...trail, next.wordId];
    return { to: wordPath(next), state: { trail: nextTrail } };
  }

  return (
    <WordLayout
      {...header}
      menuButton={menuButton}
      cardPath={word ? wordPath(word) : undefined}
      after={
        !word &&
        hasAnkiSession && (
          <MissingWordSyncDialog
            key={location.key}
            spelling={params.get("spelling")}
            reading={params.get("reading")}
            onSync={() => onSync(menuButton.current ?? undefined)}
            returnFocus={menuButton}
          />
        )
      }
    >
      {trail.length > 0 && (
        <Breadcrumb
          ref={crumbs}
          className="shrink-0 overflow-x-auto overflow-y-hidden border-b px-4 py-3 scrollbar-none"
          aria-label="Word history"
        >
          <BreadcrumbList className="m-0 w-max list-none flex-nowrap p-0 text-base">
            {trail.map((id, index) => {
              const item = allWords.find((entry) => entry.wordId === id);
              if (!item) return null;
              return (
                <Fragment key={id}>
                  {index > 0 && <BreadcrumbSeparator className="flex" />}
                  <BreadcrumbItem>
                    {id === wordId ? (
                      <BreadcrumbPage>{item.spelling}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink
                        asChild
                        className="text-muted-foreground no-underline focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <Link
                          to={wordPath(item)}
                          state={{ trail: trail.slice(0, index + 1) }}
                        >
                          {item.spelling}
                        </Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      )}

      <div className="word-content flex flex-col [&>*]:shrink-0" ref={content}>
        {word ? (
          <WordRelations
            word={word}
            words={visibleWords}
            similar={dictionary.similar}
            kanjiMeanings={dictionary.kanjiMeanings}
            wordLink={wordLink}
            entryKey={location.key}
          />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                <h1 className="m-0 text-lg">Word unavailable</h1>
              </EmptyTitle>
              <EmptyDescription>
                This word is not in the current deck.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </WordLayout>
  );
}
