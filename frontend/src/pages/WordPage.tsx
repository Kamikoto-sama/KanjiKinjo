import {
  ArrowLeftIcon,
  EllipsisIcon,
  ImportIcon,
  Link2Icon,
  RefreshCwIcon,
  SearchIcon,
  SlidersHorizontal,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { toast } from "sonner";
import { api, type SyncResult } from "../api";
import { goBack } from "../navigation";
import { MissingWordSyncDialog } from "../components/MissingWordSyncDialog";
import { RecordRow } from "../components/RecordRow";
import { RubyText } from "../components/RubyText";
import { WordSearch, type WordSearchState } from "../components/WordSearch";
import { Badge } from "../components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../components/ui/breadcrumb";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "../components/ui/field";
import { ItemGroup } from "../components/ui/item";
import { Spinner } from "../components/ui/spinner";
import { Toaster } from "../components/ui/sonner";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { useDialogFocus } from "../components/useDialogFocus";
import {
  groupNames,
  groupOrder,
  kanjiOf,
  lookalikePairs,
  readingOf,
  relatedGroups,
  uniqueGroups,
} from "../relations";
import type { Config, Group, NoteType, Snapshot, Word } from "../types";
import { wordPath } from "../wordPath";

type Props = {
  snapshot: Snapshot;
  word?: Word;
  search?: WordSearchState;
  config: Config | null;
  hasAnkiSession: boolean;
  similar: Record<string, string[]>;
  onSync: (returnFocus?: HTMLElement) => Promise<SyncResult | null>;
};

export default function WordPage({
  snapshot,
  word,
  search,
  config,
  hasAnkiSession,
  similar,
  onSync,
}: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkFeedback, setLinkFeedback] = useState("");
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([]);
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<Group | "all">("all");
  const [selectedKanji, setSelectedKanji] = useState<string | null>(null);
  const [selectedReading, setSelectedReading] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<Group | "all" | undefined>();
  const crumbs = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const relationTabs = useRef<HTMLDivElement>(null);
  const relationPages = useRef<HTMLDivElement>(null);
  const relationScrollTimer = useRef<number | undefined>(undefined);
  const menuButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const focusSearchOnClose = useRef(false);
  const linkDialogFocus = useDialogFocus(menuButton);
  const cardLinkTemplates = config
    ? Object.entries(config.mappings)
        .filter(([, mapping]) => mapping.status === "configured")
        .map(([noteTypeId, mapping]) => ({
          noteTypeId,
          link: `${window.location.origin}/word?spelling={{text:${mapping.spelling}}}${mapping.reading ? `&reading={{text:${mapping.reading}}}` : ""}`,
        }))
    : [];
  useEffect(() => {
    if (!linkDialogOpen || !config) return;
    let active = true;
    api
      .noteTypes(config.deckId, config.includeChildren)
      .then((types) => {
        if (active) setNoteTypes(types);
      })
      .catch(() => {
        if (active) setNoteTypes([]);
      });
    return () => {
      active = false;
    };
  }, [linkDialogOpen, config]);
  const wordId = word?.wordId;
  const trail: string[] =
    Array.isArray(location.state?.trail) &&
    location.state.trail.at(-1) === wordId
      ? location.state.trail
      : wordId
        ? [wordId]
        : [];
  const groups = useMemo(
    () => (word ? relatedGroups(word, snapshot.words, similar) : null),
    [word, snapshot, similar],
  );
  const allGroups = useMemo(
    () => (groups ? uniqueGroups(groups) : null),
    [groups],
  );
  const allCount = allGroups
    ? groupOrder.reduce((count, kind) => count + allGroups[kind].length, 0)
    : 0;
  const availableTabs = useMemo<(Group | "all")[]>(() => {
    const kinds = groups
      ? groupOrder.filter((kind) => groups[kind].length > 0)
      : [];
    return kinds.length > 1 ? ["all", ...kinds] : kinds;
  }, [groups]);
  const activeTab = availableTabs.includes(group) ? group : availableTabs[0];
  const visibleTab = previewTab ?? activeTab;

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
    return () => {
      observer.disconnect();
      window.clearTimeout(relationScrollTimer.current);
    };
  }, [activeTab, availableTabs, selectedKanji]);

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

  async function sync(trigger: HTMLButtonElement) {
    setBusy(true);
    try {
      const result = await onSync(trigger);
      if (
        result &&
        !result.newUnresolved.length &&
        !result.newDuplicates.length
      )
        toast.success("Deck synced");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  function renderWordContent(
    word: Word,
    groups: Record<Group, Word[]>,
    allGroups: Record<Group, Word[]>,
  ) {
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
    function relatedList(
      panelShown: Partial<Record<Group, Word[]>>,
      grouped = false,
    ) {
      const visibleGroups = groupOrder.filter(
        (kind) => panelShown[kind]?.length,
      );
      if (!visibleGroups.length) {
        return (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No similar words found.</EmptyTitle>
            </EmptyHeader>
          </Empty>
        );
      }
      return (
        <div className="grid gap-2">
          {visibleGroups.map((kind) => (
            <ItemGroup
              key={kind}
              role="group"
              aria-label={groupNames[kind]}
              className="gap-2"
            >
              {grouped && (
                <h2
                  className="relation-label m-0 rounded-md bg-[color-mix(in_srgb,currentColor_24%,var(--background))] px-3 py-1.5 text-center text-base font-semibold"
                  data-group={kind}
                >
                  {groupNames[kind]}
                </h2>
              )}
              {panelShown[kind]?.map((item) => (
                <RecordRow
                  key={item.wordId}
                  word={item}
                  selectedKanji={selectedKanji}
                  visualMatch={
                    kind === "lookalikes"
                      ? lookalikePairs(word, item, similar).join(" · ")
                      : undefined
                  }
                  link={wordLink(item)}
                />
              ))}
            </ItemGroup>
          ))}
        </div>
      );
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
          <div className="selected-meaning">
            {word.translations.join(" · ")}
          </div>
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
            relatedList({ same: filtered })
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
                {availableTabs.map((kind) => (
                  <TabsContent
                    key={kind}
                    value={kind}
                    forceMount
                    inert={kind !== visibleTab}
                    aria-hidden={kind !== visibleTab}
                    tabIndex={kind === visibleTab ? 0 : -1}
                    className="min-w-0 flex-[0_0_100%] snap-start snap-always"
                  >
                    {relatedList(
                      kind === "all" ? allGroups : { [kind]: groups[kind] },
                      kind === "all",
                    )}
                  </TabsContent>
                ))}
              </div>
            </Tabs>
          ) : (
            relatedList({})
          )}
        </div>
      </>
    );
  }

  return (
    <main className="screen active word-screen">
      <div className="word-window">
        <header className="word-header">
          <Button
            variant="ghost"
            size="icon-lg"
            type="button"
            aria-label="Back"
            onClick={() => goBack(navigate, search ? "/setup" : "/search")}
          >
            <ArrowLeftIcon className="size-5" aria-hidden="true" />
          </Button>
          <div className="deck-heading">
            <strong>{snapshot.deck.name}</strong>
            <span>
              Last synced{" "}
              {new Date(snapshot.syncedAt).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <div className="header-actions">
            {hasAnkiSession && (
              <Button
                variant="ghost"
                size="sm"
                className="sync-button"
                type="button"
                disabled={busy}
                aria-busy={busy}
                onClick={(event) => void sync(event.currentTarget)}
              >
                {busy ? (
                  <Spinner aria-hidden="true" />
                ) : (
                  <RefreshCwIcon aria-hidden="true" />
                )}
                {busy ? "Syncing…" : "Sync"}
              </Button>
            )}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={menuButton}
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  aria-label="Open menu"
                >
                  <EllipsisIcon className="size-5" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(event) => {
                  if (focusSearchOnClose.current) {
                    focusSearchOnClose.current = false;
                    event.preventDefault();
                    searchInput.current?.focus();
                  }
                  if (linkDialogOpen) event.preventDefault();
                }}
              >
                <DropdownMenuItem
                  onSelect={() => {
                    if (search) focusSearchOnClose.current = true;
                    else navigate("/search");
                  }}
                >
                  <SearchIcon aria-hidden="true" />
                  Search words
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/import")}>
                  <ImportIcon aria-hidden="true" />
                  Re-import deck
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/setup")}>
                  <SlidersHorizontal aria-hidden="true" />
                  Configure Deck &amp; fields
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setLinkFeedback("");
                    setLinkDialogOpen(true);
                  }}
                >
                  <Link2Icon aria-hidden="true" />
                  Show card link template
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {trail.length > 0 && (
          <Breadcrumb
            ref={crumbs}
            className="shrink-0 overflow-x-auto overflow-y-hidden border-b px-4 py-3 scrollbar-none"
            aria-label="Word history"
          >
            <BreadcrumbList className="m-0 w-max list-none flex-nowrap p-0 text-base">
              {trail.map((id, index) => {
                const item = snapshot.words.find(
                  (entry) => entry.wordId === id,
                );
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
        {search ? (
          <WordSearch
            {...search}
            words={snapshot.words}
            inputRef={searchInput}
          />
        ) : (
          <div
            className="word-content flex flex-col [&>*]:shrink-0"
            ref={content}
          >
            {word && groups && allGroups ? (
              renderWordContent(word, groups, allGroups)
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    <h1 className="m-0 text-lg">Word unavailable</h1>
                  </EmptyTitle>
                  <EmptyDescription>
                    This word is not in the current studied deck.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        )}
      </div>
      {!search && !word && hasAnkiSession && (
        <MissingWordSyncDialog
          key={location.key}
          spelling={params.get("spelling")}
          reading={params.get("reading")}
          onSync={() => onSync(menuButton.current ?? undefined)}
          returnFocus={menuButton}
        />
      )}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent {...linkDialogFocus} showCloseButton={false}>
          <DialogTitle>Card link template</DialogTitle>
          <DialogDescription>
            Add this link to an Anki card template to open the matching studied
            word in KanjiGraph. Anki replaces the field names with values from
            each card. Use each link in the card templates belonging to the
            named note type.
          </DialogDescription>
          {cardLinkTemplates.length ? (
            cardLinkTemplates.map(({ noteTypeId, link }) => (
              <Field className="gap-2" key={noteTypeId}>
                <FieldLabel htmlFor={`card-link-${noteTypeId}`}>
                  {`For note type: ${noteTypes.find((type) => String(type.id) === noteTypeId)?.name || noteTypeId}`}
                </FieldLabel>
                <Textarea
                  id={`card-link-${noteTypeId}`}
                  readOnly
                  value={link}
                  rows={3}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  variant="outline"
                  className="justify-self-start"
                  type="button"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(link)
                      .then(() => setLinkFeedback("Card link template copied"))
                      .catch(() => setLinkFeedback("Could not copy the link"));
                  }}
                >
                  Copy link
                </Button>
              </Field>
            ))
          ) : (
            <p className="m-0 text-sm">
              Configure the deck fields first to generate a link template.
            </p>
          )}
          <DialogFooter>
            <FieldDescription className="m-0 mr-auto self-center" role="status">
              {linkFeedback}
            </FieldDescription>
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Toaster closeButton />
    </main>
  );
}
