import { ArrowLeftIcon, EllipsisIcon, RefreshCwIcon } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
  word: Word | undefined;
  config: Config | null;
  hasAnkiSession: boolean;
  similar: Record<string, string[]>;
  onSync: (returnFocus?: HTMLElement) => Promise<SyncResult | null>;
};

export default function WordPage({
  snapshot,
  word,
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
  const crumbs = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
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
  const previousId = trail.at(-2);
  const previousWord =
    previousId && snapshot.words.find((entry) => entry.wordId === previousId);
  const group = (params.get("group") || "all") as Group | "all";
  const selectedKanji = params.get("kanji");
  const selectedReading = params.get("filterReading");
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
  const availableTabs = useMemo<(Group | "all")[]>(
    () =>
      groups && allCount > 0
        ? ["all", ...groupOrder.filter((kind) => groups[kind].length > 0)]
        : [],
    [groups, allCount],
  );
  const activeTab = availableTabs.includes(group) ? group : "all";

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

  function setFilter(update: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(update))
      value ? next.set(key, value) : next.delete(key);
    navigate(
      { pathname: location.pathname, search: next.toString() },
      { state: { trail } },
    );
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
              <EmptyTitle>No studied related words yet.</EmptyTitle>
            </EmptyHeader>
          </Empty>
        );
      }
      return (
        <div className="grid gap-4">
          {visibleGroups.map((kind) => (
            <ItemGroup
              key={kind}
              role="group"
              aria-label={groupNames[kind]}
              className="gap-2"
            >
              {grouped && (
                <Badge
                  variant="outline"
                  className="w-fit relation-label"
                  data-group={kind}
                >
                  {groupNames[kind]}
                </Badge>
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
                setFilter({
                  kanji: selectedKanji === character ? null : character,
                  filterReading: null,
                  group: null,
                })
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
                onClick={() => setFilter({ kanji: null, filterReading: null })}
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
                onValueChange={(reading) =>
                  setFilter({ filterReading: reading || null })
                }
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
        <div className="p-4">
          {selectedKanji ? (
            relatedList({ same: filtered })
          ) : availableTabs.length ? (
            <Tabs
              value={activeTab}
              activationMode="manual"
              onValueChange={(kind) =>
                setFilter({ group: kind === "all" ? null : kind })
              }
            >
              <TabsList
                className="h-auto max-w-full flex-wrap justify-start"
                aria-label="Relationship types"
              >
                {availableTabs.map((kind) => (
                  <TabsTrigger
                    key={kind}
                    className="relation-label"
                    data-group={kind}
                    value={kind}
                  >
                    {kind === "all" ? "All" : groupNames[kind]}
                    <Badge variant="secondary">
                      {kind === "all" ? allCount : groups[kind].length}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
              {availableTabs.map((kind) => (
                <TabsContent key={kind} value={kind}>
                  {kind === activeTab &&
                    relatedList(
                      kind === "all" ? allGroups : { [kind]: groups[kind] },
                      kind === "all",
                    )}
                </TabsContent>
              ))}
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
        <header className={`word-header ${hasAnkiSession ? "has-sync" : ""}`}>
          <Button
            variant="ghost"
            size="icon-lg"
            className="justify-self-start"
            type="button"
            aria-label={word ? "Previous word" : "Back"}
            disabled={Boolean(word && !previousWord)}
            onClick={() => {
              if (previousWord) {
                navigate(wordPath(previousWord), {
                  state: { trail: trail.slice(0, -1) },
                });
              } else if (!word) {
                const firstWord = snapshot.words[0];
                goBack(navigate, firstWord ? wordPath(firstWord) : "/setup");
              }
            }}
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
                  if (linkDialogOpen) event.preventDefault();
                }}
              >
                <DropdownMenuItem onSelect={() => navigate("/import")}>
                  Re-import deck
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/setup")}>
                  Configure Deck &amp; fields
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setLinkFeedback("");
                    setLinkDialogOpen(true);
                  }}
                >
                  Show card link template
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {trail.length > 0 && (
          <Breadcrumb
            ref={crumbs}
            className="overflow-x-auto border-b px-4 py-3"
            aria-label="Word history"
          >
            <BreadcrumbList className="m-0 w-max list-none flex-nowrap p-0">
              {trail.map((id, index) => {
                const item = snapshot.words.find(
                  (entry) => entry.wordId === id,
                );
                if (!item) return null;
                return (
                  <Fragment key={id}>
                    {index > 0 && <BreadcrumbSeparator />}
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
        <div className="word-content" ref={content}>
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
      </div>
      {!word && hasAnkiSession && (
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
