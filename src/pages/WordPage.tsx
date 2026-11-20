import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { api, type SyncResult } from "../api";
import { goBack } from "../navigation";
import { MissingWordSyncDialog } from "../components/MissingWordSyncDialog";
import { RubyText } from "../components/RubyText";
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
  onSync: () => Promise<SyncResult | null>;
};

export function WordPage({
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const crumbs = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const tabList = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const pageNodes = useRef<Partial<Record<Group | "all", HTMLDivElement | null>>>(
    {},
  );
  const scrollTimer = useRef<number | null>(null);
  const scrollOverride = useRef<number | null>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const suppressPageClickUntil = useRef(0);
  const menu = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
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
    api.noteTypes(config.deckId, config.includeChildren)
      .then((types) => { if (active) setNoteTypes(types); })
      .catch(() => { if (active) setNoteTypes([]); });
    return () => { active = false; };
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
  const previousWord = previousId && snapshot.words.find((entry) => entry.wordId === previousId);
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
  const showTabs = !selectedKanji && availableTabs.length > 0;
  const [activeTab, setActiveTab] = useState<Group | "all">(group);
  const [pageHeight, setPageHeight] = useState<number | null>(null);
  const tabKeys = availableTabs.join(":");

  useEffect(() => {
    crumbs.current?.scrollTo({ left: crumbs.current.scrollWidth });
  }, [wordId]);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        menu.current?.contains(target) ||
        menuButton.current?.contains(target)
      )
        return;
      setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);
  useEffect(() => {
    const key = `scroll:${location.key}`;
    const prior = scrollOverride.current ?? sessionStorage.getItem(key);
    scrollOverride.current = null;
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
  useLayoutEffect(() => {
    if (!showTabs) return;
    const scroller = pages.current;
    if (!scroller) return;
    const next = availableTabs.includes(group) ? group : "all";
    setActiveTab(next);
    const target = availableTabs.indexOf(next) * scroller.clientWidth;
    if (Math.abs(scroller.scrollLeft - target) > 2) scroller.scrollLeft = target;
  }, [group, wordId, showTabs, tabKeys]);
  useLayoutEffect(() => {
    if (!showTabs) return;
    const panel = pageNodes.current[activeTab];
    if (!panel) return;
    const measure = () => setPageHeight(panel.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [activeTab, wordId, showTabs, tabKeys]);
  useEffect(
    () => () => {
      if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current);
    },
    [wordId, selectedKanji],
  );
  useEffect(() => {
    const tabs = tabList.current;
    const active = tabs?.querySelector<HTMLElement>(".relation-tab.active");
    if (!tabs || !active) return;
    const tabBounds = tabs.getBoundingClientRect();
    const activeBounds = active.getBoundingClientRect();
    tabs.scrollTo({
      left:
        tabs.scrollLeft +
        activeBounds.left -
        tabBounds.left -
        (tabs.clientWidth - active.clientWidth) / 2,
      behavior: "smooth",
    });
  }, [activeTab, wordId]);

  function openWord(next: Word) {
    const existing = trail.indexOf(next.wordId);
    const nextTrail =
      existing >= 0 ? trail.slice(0, existing + 1) : [...trail, next.wordId];
    navigate(wordPath(next), { state: { trail: nextTrail } });
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

  function onPagesScroll() {
    const scroller = pages.current;
    if (!scroller || !scroller.clientWidth) return;
    suppressPageClickUntil.current = Date.now() + 350;
    const index = Math.max(
      0,
      Math.min(
        availableTabs.length - 1,
        Math.round(scroller.scrollLeft / scroller.clientWidth),
      ),
    );
    setActiveTab(availableTabs[index]);
    if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => {
      scrollTimer.current = null;
      commitPage();
    }, 250);
  }

  function commitPage() {
    const scroller = pages.current;
    if (!scroller || !scroller.clientWidth) return;
    const settled = availableTabs[
      Math.max(
        0,
        Math.min(
          availableTabs.length - 1,
          Math.round(scroller.scrollLeft / scroller.clientWidth),
        ),
      )
    ];
    if (settled === group) return;
    scrollOverride.current = content.current?.scrollTop ?? 0;
    setFilter({ group: settled === "all" ? null : settled });
  }

  function onPagesScrollEnd() {
    if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current);
    scrollTimer.current = null;
    commitPage();
  }

  async function sync() {
    setBusy(true);
    setMessage("");
    try {
      const result = await onSync();
      if (result && !result.newUnresolved.length && !result.newDuplicates.length) setMessage("Deck synced");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Sync failed");
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
    const shown: Partial<Record<Group, Word[]>> = selectedKanji
      ? { same: filtered }
      : group === "all"
        ? allGroups
        : { [group]: groups[group] || [] };

    function relatedList(
      panelShown: Partial<Record<Group, Word[]>>,
      withDividers: boolean,
    ) {
      const visibleBlocks = groupOrder.filter((kind) => panelShown[kind]?.length);
      return (
        <div className="related-list">
          {visibleBlocks.length ? (
            visibleBlocks.map((kind) => (
              <div className="group-block" key={kind}>
                {withDividers && (
                  <div className={`group-divider ${kind}`}>
                    {groupNames[kind]}
                  </div>
                )}
                {panelShown[kind]?.map((item) => {
                  const visualMatch =
                    kind === "lookalikes"
                      ? lookalikePairs(word, item, similar).join(" · ")
                      : "";
                  return (
                    <button
                      key={item.wordId}
                      className="word-row"
                      type="button"
                      onClick={() => openWord(item)}
                    >
                      <span className="word-row-word">
                        <RubyText word={item} selected={selectedKanji} />
                      </span>
                      <span className="word-row-details">
                        {visualMatch && (
                          <span className="word-row-relation">
                            Similar kanji: {visualMatch}
                          </span>
                        )}
                        <span className="word-row-meaning">
                          {item.translations.join(" · ")}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          ) : (
            <div className="empty-state">No studied related words yet.</div>
          )}
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
        {showTabs && (
          <div
            ref={tabList}
            className="relation-tabs"
            role="tablist"
            aria-label="Relationship types"
          >
            {availableTabs.map((kind) => {
              const count = kind === "all" ? allCount : groups[kind].length;
              return (
                <button
                  key={kind}
                  className={`relation-tab ${activeTab === kind ? "active" : ""}`}
                  data-group={kind}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === kind}
                  onClick={() => {
                    const scroller = pages.current;
                    if (!scroller) return;
                    scroller.scrollTo({
                      left: availableTabs.indexOf(kind) * scroller.clientWidth,
                      behavior: "smooth",
                    });
                  }}
                >
                  {kind === "all" ? "All" : groupNames[kind]} ({count})
                </button>
              );
            })}
          </div>
        )}
        {selectedKanji && (
          <div className="kanji-filter">
            <div className="kanji-filter-heading">
              <strong>
                Same kanji: {selectedKanji} ({filtered.length})
              </strong>
              <button
                type="button"
                onClick={() => setFilter({ kanji: null, reading: null })}
              >
                Clear ×
              </button>
            </div>
            {readings.length > 1 && (
              <div className="reading-options">
                {readings.map((reading) => (
                  <button
                    key={reading}
                    className={reading === selectedReading ? "active" : ""}
                    type="button"
                    onClick={() =>
                      setFilter({
                        filterReading: reading === selectedReading ? null : reading,
                      })
                    }
                  >
                    {reading}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {showTabs ? (
          <div
            className="relation-pages"
            ref={pages}
            onScroll={onPagesScroll}
            onScrollEnd={onPagesScrollEnd}
            onTouchStart={(event) => {
              if (event.touches.length !== 1) return;
              touchStart.current = {
                x: event.touches[0].clientX,
                y: event.touches[0].clientY,
              };
              suppressPageClickUntil.current = 0;
            }}
            onTouchMove={(event) => {
              const start = touchStart.current;
              if (!start || event.touches.length !== 1) return;
              if (
                Math.abs(event.touches[0].clientX - start.x) > 12 ||
                Math.abs(event.touches[0].clientY - start.y) > 12
              )
                suppressPageClickUntil.current = Date.now() + 350;
            }}
            onTouchEnd={(event) => {
              const start = touchStart.current;
              touchStart.current = null;
              if (!start || event.changedTouches.length !== 1) return;
              const deltaX = event.changedTouches[0].clientX - start.x;
              const deltaY = event.changedTouches[0].clientY - start.y;
              if (Math.abs(deltaX) > 12 || Math.abs(deltaY) > 12)
                suppressPageClickUntil.current = Date.now() + 350;
            }}
            onTouchCancel={() => {
              if (touchStart.current)
                suppressPageClickUntil.current = Date.now() + 350;
              touchStart.current = null;
            }}
            onPointerDown={(event) => {
              pointerStart.current = { x: event.clientX, y: event.clientY };
              suppressPageClickUntil.current = 0;
            }}
            onPointerMove={(event) => {
              const start = pointerStart.current;
              if (
                start &&
                (Math.abs(event.clientX - start.x) > 12 ||
                  Math.abs(event.clientY - start.y) > 12)
              )
                suppressPageClickUntil.current = Date.now() + 350;
            }}
            onPointerUp={() => {
              pointerStart.current = null;
            }}
            onPointerCancel={() => {
              pointerStart.current = null;
            }}
            onClickCapture={(event) => {
              if (Date.now() >= suppressPageClickUntil.current) return;
              suppressPageClickUntil.current = 0;
              event.preventDefault();
              event.stopPropagation();
            }}
            style={pageHeight === null ? undefined : { height: pageHeight }}
          >
            {availableTabs.map((kind) => (
              <div
                className="relation-page"
                key={kind}
                ref={(element) => {
                  pageNodes.current[kind] = element;
                }}
                role="tabpanel"
                aria-label={kind === "all" ? "All" : groupNames[kind]}
              >
                {relatedList(
                  kind === "all" ? allGroups : { [kind]: groups[kind] },
                  kind === "all",
                )}
              </div>
            ))}
          </div>
        ) : (
          relatedList(shown, false)
        )}
      </>
    );
  }

  return (
    <main className="screen active word-screen">
      <div className="word-window">
        <header className={`word-header ${hasAnkiSession ? "has-sync" : ""}`}>
          <button
            className="icon-button"
            type="button"
            aria-label={word ? "Previous word" : "Back"}
            disabled={Boolean(word && !previousWord)}
            onClick={() => {
              if (previousWord) {
                navigate(wordPath(previousWord), { state: { trail: trail.slice(0, -1) } });
              } else if (!word) {
                const firstWord = snapshot.words[0];
                goBack(navigate, firstWord ? wordPath(firstWord) : "/setup");
              }
            }}
          >
            ←
          </button>
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
              <button
                className="sync-button"
                type="button"
                disabled={busy}
                onClick={sync}
              >
                {busy ? "Syncing…" : "↻ Sync"}
              </button>
            )}
            <button
              ref={menuButton}
              className="icon-button"
              type="button"
              aria-label="Open menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              ⋯
            </button>
          </div>
          {menuOpen && (
            <div className="word-menu" ref={menu}>
              <button type="button" onClick={() => navigate("/import")}>Re-import deck</button>
              <button type="button" onClick={() => navigate("/setup")}>
                Configure Deck &amp; fields
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setLinkDialogOpen(true);
                }}
              >
                Show card link template
              </button>
            </div>
          )}
        </header>
        {trail.length > 0 && (
          <nav ref={crumbs} className="breadcrumbs" aria-label="Word history">
            {trail.map((id, index) => {
              const item = snapshot.words.find((entry) => entry.wordId === id);
              return (
                <span className="crumb-item" key={`${id}:${index}`}>
                  {index > 0 && (
                    <span className="crumb-separator" aria-hidden="true">
                      ›
                    </span>
                  )}
                  <button
                    type="button"
                    className={id === wordId ? "current" : ""}
                    onClick={() =>
                      navigate(wordPath(item!), {
                        state: { trail: trail.slice(0, index + 1) },
                      })
                    }
                  >
                    {item?.spelling || "…"}
                  </button>
                </span>
              );
            })}
          </nav>
        )}
        <div className="word-content" ref={content}>
          {word && groups && allGroups ? (
            renderWordContent(word, groups, allGroups)
          ) : (
            <div className="empty-state">
              <h1>Word unavailable</h1>
              <p>This word is not in the current studied deck.</p>
            </div>
          )}
        </div>
      </div>
      {!word && hasAnkiSession && (
        <MissingWordSyncDialog
          key={location.key}
          spelling={params.get("spelling")}
          reading={params.get("reading")}
          onSync={onSync}
        />
      )}
      {linkDialogOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setLinkDialogOpen(false);
        }}>
          <section className="confirmation-dialog card-link-dialog" role="dialog" aria-modal="true"
            aria-labelledby="card-link-title" aria-describedby="card-link-description"
            onKeyDown={(event) => { if (event.key === "Escape") setLinkDialogOpen(false); }}>
            <h2 id="card-link-title">Card link template</h2>
            <p id="card-link-description">Add this link to an Anki card template to open the matching studied word in KanjiGraph. Anki replaces the field names with values from each card. Use each link in the card templates belonging to the named note type.</p>
            {cardLinkTemplates.length ? cardLinkTemplates.map(({ noteTypeId, link }) => (
              <div className="card-link-entry" key={noteTypeId}>
                <label className="card-link-label" htmlFor={`card-link-${noteTypeId}`}>
                  {`For note type: ${noteTypes.find((type) => String(type.id) === noteTypeId)?.name || noteTypeId}`}
                </label>
                <textarea id={`card-link-${noteTypeId}`} readOnly value={link} rows={3}
                  onFocus={(event) => event.currentTarget.select()} />
                <button className="secondary-button" type="button" onClick={() => {
                  navigator.clipboard.writeText(link)
                    .then(() => setMessage("Card link template copied"))
                    .catch(() => setMessage("Could not copy the link"));
                }}>Copy link</button>
              </div>
            )) : (
              <p>Configure the deck fields first to generate a link template.</p>
            )}
            <div className="confirmation-actions">
              <button className="secondary-button" type="button" autoFocus onClick={() => setLinkDialogOpen(false)}>Close</button>
            </div>
          </section>
        </div>
      )}
      {message && (
        <div className="toast" role="status" onClick={() => setMessage("")}>
          {message}
        </div>
      )}
    </main>
  );
}
