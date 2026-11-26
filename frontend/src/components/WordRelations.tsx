import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LinkProps } from "react-router-dom";
import { groupNames, groupOrder, kanjiOf, readingOf, relatedGroups, uniqueGroups, } from "../relations";
import type { Group, Word } from "../types";
import { RelatedWordList } from "./RelatedWordList";
import { RubyText } from "./RubyText";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

const pageSize = 50;

export function WordRelations({
  word,
  words,
  similar,
  wordLink,
  entryKey,
}: {
  word: Word;
  words: Word[];
  similar: Record<string, string[]>;
  wordLink: (word: Word) => LinkProps;
  entryKey: string;
}) {
  const paginationKey = `relation-pages:${entryKey}`;
  const [limits, setLimits] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(paginationKey) ?? "{}") ?? {};
    } catch {
      return {};
    }
  });
  const [group, setGroup] = useState<Group | "all">("all");
  const [selectedKanji, setSelectedKanji] = useState<string | null>(null);
  const [selectedReading, setSelectedReading] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<Group | "all" | undefined>();
  const relationTabs = useRef<HTMLDivElement>(null);
  const relationPages = useRef<HTMLDivElement>(null);
  const relationScrollTimer = useRef<number | undefined>(undefined);
  const groups = useMemo(
    () => relatedGroups(word, words, similar),
    [word, words, similar],
  );
  const allGroups = useMemo(() => uniqueGroups(groups), [groups]);
  const allCount = groupOrder.reduce(
    (count, kind) => count + allGroups[kind].length,
    0,
  );
  const availableTabs = useMemo<(Group | "all")[]>(() => {
    const kinds = groupOrder.filter((kind) => groups[kind].length > 0);
    return kinds.length > 1 ? ["all", ...kinds] : kinds;
  }, [groups]);
  const activeTab = availableTabs.includes(group) ? group : availableTabs[0];
  const visibleTab = previewTab ?? activeTab;
  const visibleIndex = availableTabs.indexOf(visibleTab);

  useEffect(() => {
    const list = relationTabs.current;
    const tab = list?.querySelector('[role="tab"][data-state="active"]');
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    const listBounds = list.getBoundingClientRect();
    const tabBounds = tab.getBoundingClientRect();
    if (tabBounds.left < listBounds.left) {
      list.scrollBy({ left: tabBounds.left - listBounds.left });
    } else if (tabBounds.right > listBounds.right) {
      list.scrollBy({ left: tabBounds.right - listBounds.right });
    }
  }, [visibleTab, availableTabs, selectedKanji]);

  useLayoutEffect(() => {
    setPreviewTab(undefined);
    const pages = relationPages.current;
    const panel = pages?.children[availableTabs.indexOf(activeTab)];
    if (!pages || !(panel instanceof HTMLElement)) return;
    const fitPanel = () => {
      pages.style.height = `${panel.offsetHeight}px`;
    };
    fitPanel();
    if (Math.abs(pages.scrollLeft - panel.offsetLeft) > 1) {
      pages.scrollTo({ left: panel.offsetLeft, behavior: "instant" });
    }
    const observer = new ResizeObserver(fitPanel);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [activeTab, availableTabs, selectedKanji]);

  useEffect(() => () => window.clearTimeout(relationScrollTimer.current), []);

  function filterByKanji(kanji: string | null) {
    setSelectedKanji(kanji);
    setSelectedReading(null);
    setGroup("all");
  }

  function scrollToTab(kind: string) {
    const pages = relationPages.current;
    const index = availableTabs.findIndex((tab) => tab === kind);
    const panel = pages?.children[index];
    if (!pages || !(panel instanceof HTMLElement)) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    pages.scrollTo({
      left: panel.offsetLeft,
      behavior: reduceMotion ? "instant" : "smooth",
    });
  }

  function selectGroupFromList(kind: Group) {
    relationTabs.current
        ?.querySelector<HTMLButtonElement>(`[role="tab"][data-group="${kind}"]`)
        ?.focus();
    scrollToTab(kind);
  }

  function nearestRelationTab(pages: HTMLDivElement) {
    if (!pages.clientWidth) return;
    return availableTabs[Math.round(pages.scrollLeft / pages.clientWidth)];
  }

  function settleRelationTab(pages: HTMLDivElement) {
    if (pages !== relationPages.current) return;
    const kind = nearestRelationTab(pages);
    if (!kind || kind === activeTab) return;
    setGroup(kind);
  }

  const matches = selectedKanji
    ? groups.same.filter((item) => kanjiOf(item).includes(selectedKanji))
    : [];
  const readings = [
    ...new Set(
      matches
        .map((item) => readingOf(item, selectedKanji!))
        .filter((item): item is string => Boolean(item)),
    ),
  ];
  const filtered = matches.filter(
    (item) =>
      !selectedReading || readingOf(item, selectedKanji!) === selectedReading,
  );
  function listProps(pageKey: string) {
    const limit = limits[pageKey] ?? pageSize;
    return {
      word,
      wordLink,
      similar,
      selectedKanji,
      limit,
      onShowMore: () => {
        const next = { ...limits, [pageKey]: limit + pageSize };
        setLimits(next);
        sessionStorage.setItem(paginationKey, JSON.stringify(next));
      },
    };
  }

  return (
    <>
      <div className="word-hero">
        <div className="selected-word">
          <RubyText
            word={word}
            interactive
            selected={selectedKanji}
            onKanji={(character) =>
              filterByKanji(selectedKanji === character ? null : character)
            }
          />
        </div>
        <div className="selected-meaning">{word.translations.join(" · ")}</div>
      </div>
      {selectedKanji && (
        <div className="border-b px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>
              Same kanji: {selectedKanji} ({filtered.length})
            </strong>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => filterByKanji(null)}
            >
              Clear ×
            </Button>
          </div>
          {readings.length > 1 && (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              className="mt-2 flex-wrap"
              aria-label="Filter by reading"
              value={selectedReading ?? ""}
              onValueChange={(reading) => setSelectedReading(reading || null)}
            >
              {readings.map((reading) => (
                <ToggleGroupItem key={reading} value={reading}>
                  {reading}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </div>
      )}
      <div className="flex grow flex-col p-4">
        {selectedKanji ? (
          <RelatedWordList
            groups={{ same: filtered }}
            {...listProps(`kanji:${selectedKanji}:${selectedReading ?? ""}`)}
          />
        ) : availableTabs.length ? (
          <Tabs
            className="grow"
            value={visibleTab}
            activationMode="manual"
            onValueChange={scrollToTab}
          >
            <TabsList
              ref={relationTabs}
              className="w-full flex-nowrap justify-start overflow-x-auto p-1 scrollbar-none group-data-[orientation=horizontal]/tabs:h-auto"
              aria-label="Relationship types"
            >
              {availableTabs.map((kind) => (
                <TabsTrigger
                  key={kind}
                  className="relation-label h-auto flex-[1_0_auto] text-base"
                  data-group={kind}
                  value={kind}
                >
                  {kind === "all" ? "All" : groupNames[kind]}
                  <Badge variant="secondary" className="text-sm">
                    {kind === "all" ? allCount : groups[kind].length}
                  </Badge>
                </TabsTrigger>
              ))}
            </TabsList>
            <div
              ref={relationPages}
              className="relative flex grow shrink-0 snap-x snap-mandatory items-start overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-none"
              onScrollEnd={(event) => settleRelationTab(event.currentTarget)}
              onScroll={(event) => {
                const pages = event.currentTarget;
                setPreviewTab(nearestRelationTab(pages));
                if ("onscrollend" in pages) return;
                window.clearTimeout(relationScrollTimer.current);
                relationScrollTimer.current = window.setTimeout(
                  () => settleRelationTab(pages),
                  180,
                );
              }}
            >
              {availableTabs.map((kind, index) => (
                <TabsContent
                  key={kind}
                  value={kind}
                  forceMount
                  inert={kind !== visibleTab}
                  aria-hidden={kind !== visibleTab}
                  tabIndex={kind === visibleTab ? 0 : -1}
                  className="min-w-0 flex-[0_0_100%] snap-start snap-always"
                >
                  {Math.abs(index - visibleIndex) <= 1 && (
                    <RelatedWordList
                      groups={
                        kind === "all" ? allGroups : { [kind]: groups[kind] }
                      }
                      onSelectGroup={
                        kind === "all" ? selectGroupFromList : undefined
                      }
                      {...listProps(kind)}
                    />
                  )}
                </TabsContent>
              ))}
            </div>
          </Tabs>
        ) : (
          <RelatedWordList groups={{}} {...listProps("all")} />
        )}
      </div>
    </>
  );
}
