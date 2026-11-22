import { Badge } from "../components/ui/badge";
import { Field, FieldLabel } from "../components/ui/field";
import { Separator } from "../components/ui/separator";
import { Spinner } from "../components/ui/spinner";
import {
  Card,
  CardContent,
  CardHeader,
  CardFooter,
} from "../components/ui/card";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { FormError } from "../components/FormError";
import { MappingField } from "../components/MappingField";
import { RecordPreview } from "../components/RecordPreview";
import { ReplaceDeckDialog } from "../components/ReplaceDeckDialog";
import { SkipWordsDialog } from "../components/SkipWordsDialog";
import {
  DuplicateWordsNotice,
  UnresolvedWordsNotice,
} from "../components/WordNotices";
import { Button } from "../components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "../components/ui/native-select";
import { Switch } from "../components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { goBack } from "../navigation";
import { readSetupDraft } from "../setupDraft";
import type {
  Config,
  Deck,
  Mapping,
  NoteType,
  Preview,
  Snapshot,
} from "../types";

type Props = {
  initialConfig: Config | null;
  snapshotVersion?: string;
  onReady: (snapshot: Snapshot, config: Config) => void;
};

function guessMapping(type: NoteType): Mapping {
  const find = (pattern: RegExp) =>
    type.fields.find((field) => pattern.test(field)) || "";
  return {
    status: "unconfigured",
    spelling: find(/expression|word|front|japanese/i) || type.fields[0] || "",
    translation:
      find(/meaning|translation|back|english/i) || type.fields[1] || "",
    reading: "",
  };
}

function savedDraft(initialConfig: Config | null, entryKey: string) {
  const draft = readSetupDraft();
  if (!initialConfig) return draft;
  return draft?.entryKey === entryKey &&
    draft.baseConfig === JSON.stringify(initialConfig)
    ? draft
    : null;
}

export function SetupPage({ initialConfig, snapshotVersion, onReady }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const [draft] = useState(() => savedDraft(initialConfig, location.key));
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckId, setDeckId] = useState(
    draft?.deckId || initialConfig?.deckId || 0,
  );
  const [includeChildren, setIncludeChildren] = useState(
    draft?.includeChildren ?? initialConfig?.includeChildren ?? true,
  );
  const [types, setTypes] = useState<NoteType[]>([]);
  const [mappings, setMappings] = useState<Record<string, Mapping>>(
    draft?.mappings || initialConfig?.mappings || {},
  );
  const [selectedType, setSelectedType] = useState(draft?.selectedType || 0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const previewRequest = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingSkip, setPendingSkip] = useState<{
    count: number;
    config: Config;
    trigger: HTMLButtonElement;
  } | null>(null);
  const deckTrigger = useRef<HTMLSelectElement>(null);
  const noteTabs = useRef<HTMLDivElement>(null);
  const [pendingDeckId, setPendingDeckId] = useState<number | null>(null);
  const previewSignature = JSON.stringify(
    Object.entries(mappings).map(([id, item]) => [
      id,
      item.spelling,
      item.reading,
      item.translation,
      item.status === "skipped",
    ]),
  );

  useEffect(() => {
    api
      .decks()
      .then(setDecks)
      .catch((reason) => setError(reason.message));
  }, []);
  useEffect(() => {
    sessionStorage.setItem(
      "setupDraft",
      JSON.stringify({
        deckId,
        includeChildren,
        mappings,
        selectedType,
        entryKey: location.key,
        baseConfig: initialConfig ? JSON.stringify(initialConfig) : null,
      }),
    );
  }, [
    deckId,
    includeChildren,
    mappings,
    selectedType,
    location.key,
    initialConfig,
  ]);
  useEffect(() => {
    if (!deckId) {
      setTypes([]);
      setPreview(null);
      return;
    }
    let active = true;
    api
      .noteTypes(deckId, includeChildren)
      .then((items) => {
        if (!active) return;
        setTypes(items);
        setSelectedType((index) =>
          Math.max(0, Math.min(index, items.length - 1)),
        );
        setMappings((previous) =>
          Object.fromEntries(
            items.map((item) => [
              String(item.id),
              previous[String(item.id)] || guessMapping(item),
            ]),
          ),
        );
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [deckId, includeChildren, snapshotVersion]);

  useEffect(() => {
    if (!deckId || !types.length) {
      ++previewRequest.current;
      return;
    }
    const request = ++previewRequest.current;
    const timer = window.setTimeout(() => {
      api
        .preview({ deckId, includeChildren, mappings })
        .then((result) => {
          if (request === previewRequest.current) setPreview(result);
        })
        .catch((reason) => {
          if (request === previewRequest.current) setError(reason.message);
        });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [deckId, includeChildren, previewSignature, types, snapshotVersion]);

  const current = types[selectedType];
  useEffect(() => {
    const list = noteTabs.current;
    const tab = list?.querySelector('[role="tab"][data-state="active"]');
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    const listBounds = list.getBoundingClientRect();
    const tabBounds = tab.getBoundingClientRect();
    list.scrollTo({
      left:
        list.scrollLeft +
        tabBounds.left -
        listBounds.left +
        (tabBounds.width - list.clientWidth) / 2,
    });
  }, [selectedType, types]);

  const mapping = current ? mappings[String(current.id)] : null;
  const unresolvedInType = current
    ? preview?.unresolved.filter((word) => word.noteTypeId === current.id) || []
    : [];
  const duplicateCount =
    preview?.duplicateGroups.reduce(
      (count, { records }) =>
        count +
        records.filter((record) => record.noteTypeId === current?.id).length,
      0,
    ) ?? 0;
  const ready = types.filter(
    (type) => mappings[String(type.id)]?.status !== "unconfigured",
  ).length;
  const canContinue =
    types.length > 0 &&
    ready === types.length &&
    types.some((type) => mappings[String(type.id)]?.status === "configured");

  function change(field: keyof Mapping, value: string) {
    if (!current || !mapping) return;
    setPreview(null);
    setError("");
    setMappings((previous) => ({
      ...previous,
      [String(current.id)]: {
        ...mapping,
        [field]: value,
        status: "unconfigured",
      },
    }));
  }

  function changeStatus(status: Mapping["status"]) {
    if (!current || !mapping) return;
    if (status === "skipped" || mapping.status === "skipped") setPreview(null);
    setError("");
    setMappings((previous) => ({
      ...previous,
      [String(current.id)]: { ...mapping, status },
    }));
  }

  function selectDeck(nextDeckId: number) {
    setError("");
    setDeckId(nextDeckId);
    setTypes([]);
    setMappings(
      nextDeckId === initialConfig?.deckId ? initialConfig.mappings : {},
    );
    if (nextDeckId === initialConfig?.deckId) {
      setIncludeChildren(initialConfig.includeChildren);
    }
    setSelectedType(0);
    setPreview(null);
  }

  function requestDeckChange(nextDeckId: number) {
    if (nextDeckId === deckId) return;
    if (
      nextDeckId > 0 &&
      initialConfig &&
      nextDeckId !== initialConfig.deckId
    ) {
      setPendingDeckId(nextDeckId);
      return;
    }
    selectDeck(nextDeckId);
  }

  async function continueToWords(trigger: HTMLButtonElement) {
    if (!canContinue || busy) return;
    setBusy(true);
    setError("");
    const config = { deckId, includeChildren, mappings };
    try {
      const latestPreview = await api.preview(config);
      setPreview(latestPreview);
      if (
        !Object.values(latestPreview.wordsByType).some((words) => words.length)
      ) {
        return;
      }
      if (latestPreview.unresolved.length) {
        setPendingSkip({
          count: latestPreview.unresolved.length,
          config,
          trigger,
        });
        return;
      }
      await saveAndOpenWords(config);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not build snapshot",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveAndOpenWords(config: Config) {
    await api.saveConfig(config);
    const snapshot = await api.snapshot();
    onReady(snapshot, config);
    sessionStorage.removeItem("setupDraft");
    const pending = sessionStorage.getItem("pendingWord");
    sessionStorage.removeItem("pendingWord");
    if (pending) navigate(pending, { replace: true });
    else navigate("/search");
  }

  async function continueAfterWarning() {
    if (!pendingSkip) return;
    const config = pendingSkip.config;
    setPendingSkip(null);
    setBusy(true);
    setError("");
    try {
      await saveAndOpenWords(config);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not build snapshot",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen active">
      <Card className="setup-window gap-0 py-0">
        <CardHeader className="setup-header">
          <Button
            variant="ghost"
            size="icon-lg"
            type="button"
            aria-label="Back"
            onClick={() => goBack(navigate, "/import")}
          >
            <ArrowLeftIcon aria-hidden="true" className="size-5" />
          </Button>
          <h1>Deck &amp; fields</h1>
        </CardHeader>
        <CardContent className="setup-content">
          <div className="grid gap-4">
            <Field className="gap-1.5">
              <FieldLabel htmlFor="deck-select">Deck</FieldLabel>
              <NativeSelect
                id="deck-select"
                ref={deckTrigger}
                value={deckId}
                disabled={busy}
                onChange={(event) =>
                  requestDeckChange(Number(event.target.value))
                }
              >
                <NativeSelectOption value={0}>Select a deck</NativeSelectOption>
                {decks
                  .filter((deck) => deck.id !== 1)
                  .map((deck) => (
                    <NativeSelectOption key={deck.id} value={deck.id}>
                      {deck.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </Field>
            <Field orientation="horizontal" className="justify-between">
              <FieldLabel htmlFor="subdecks-toggle">
                Include subdecks
              </FieldLabel>
              <Switch
                id="subdecks-toggle"
                checked={includeChildren}
                disabled={busy}
                onCheckedChange={(checked) => {
                  setTypes([]);
                  setPreview(null);
                  setIncludeChildren(checked);
                }}
              />
            </Field>
          </div>
          {deckId > 0 && types.length > 0 && (
            <section className="mt-6" aria-label="Note type field mapping">
              <Separator />
              <Tabs
                value={String(selectedType)}
                onValueChange={(value) => setSelectedType(Number(value))}
                className="mt-3 gap-4"
              >
                <TabsList
                  ref={noteTabs}
                  className="max-w-full justify-start overflow-x-auto scroll-smooth p-1 group-data-[orientation=horizontal]/tabs:h-auto"
                  aria-label="Note types"
                >
                  {types.map((type, index) => {
                    const status =
                      mappings[String(type.id)]?.status || "unconfigured";
                    return (
                      <TabsTrigger
                        key={type.id}
                        className="flex-none data-[state=active]:border-primary data-[state=active]:bg-accent"
                        value={String(index)}
                        aria-label={`${type.name}, ${type.count.toLocaleString()} cards, ${status}`}
                      >
                        {status !== "unconfigured" && (
                          <span aria-hidden="true">
                            {status === "configured" ? "✓" : "✕"}
                          </span>
                        )}
                        <span>{type.name}</span>
                        <Badge variant="secondary">
                          {type.count.toLocaleString()}
                        </Badge>
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
                {types.map((type, index) => (
                  <TabsContent key={type.id} value={String(index)}>
                    {current?.id === type.id && mapping && (
                      <>
                        {mapping.status === "skipped" && (
                          <div className="mb-4 flex items-center justify-between gap-2 rounded-md bg-card p-3 text-sm">
                            <span>This card type is excluded</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              type="button"
                              disabled={busy}
                              onClick={() => changeStatus("unconfigured")}
                            >
                              Include
                            </Button>
                          </div>
                        )}
                        <div className="grid gap-4 sm:grid-cols-3">
                          <MappingField
                            label="Word / spelling"
                            value={mapping.spelling}
                            options={current.fields}
                            onChange={(value) => change("spelling", value)}
                            disabled={busy || mapping.status === "skipped"}
                          />
                          <MappingField
                            label="Reading / furigana"
                            value={mapping.reading}
                            options={["", ...current.fields]}
                            onChange={(value) => change("reading", value)}
                            disabled={busy || mapping.status === "skipped"}
                          />
                          <MappingField
                            label="Translation"
                            value={mapping.translation}
                            options={["", ...current.fields]}
                            emptyLabel="No translation"
                            onChange={(value) => change("translation", value)}
                            disabled={busy || mapping.status === "skipped"}
                          />
                        </div>
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                          <Button
                            variant="ghost"
                            type="button"
                            disabled={selectedType === 0}
                            onClick={() => setSelectedType(selectedType - 1)}
                          >
                            Back
                          </Button>
                          <div className="ml-auto flex flex-wrap justify-end gap-2">
                            {mapping.status !== "skipped" && (
                              <Button
                                variant="ghost"
                                type="button"
                                disabled={busy}
                                onClick={() => changeStatus("skipped")}
                              >
                                Skip this type
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              type="button"
                              disabled={busy}
                              onClick={(event) => {
                                if (mapping.status !== "unconfigured") {
                                  if (selectedType < types.length - 1)
                                    setSelectedType(selectedType + 1);
                                  else
                                    void continueToWords(event.currentTarget);
                                  return;
                                }
                                if (
                                  !mapping.spelling ||
                                  (mapping.translation &&
                                    mapping.spelling === mapping.translation)
                                ) {
                                  setError(
                                    !mapping.spelling
                                      ? "Choose a field for the Japanese word."
                                      : "Choose different fields for word and translation.",
                                  );
                                  return;
                                }
                                setError("");
                                changeStatus("configured");
                              }}
                            >
                              {mapping.status !== "unconfigured"
                                ? "Next"
                                : "Save fields"}
                            </Button>
                          </div>
                        </div>
                        {unresolvedInType.length > 0 && (
                          <UnresolvedWordsNotice
                            count={unresolvedInType.length}
                            inCardType
                            onManage={() =>
                              navigate(`/corrections?type=${current.id}`)
                            }
                          />
                        )}
                        {duplicateCount > 0 && (
                          <DuplicateWordsNotice
                            count={duplicateCount}
                            inCardType
                            onView={() =>
                              navigate(`/duplicates?type=${current.id}`)
                            }
                          />
                        )}
                        {mapping.status !== "skipped" &&
                          (preview ? (
                            <RecordPreview
                              key={current.id}
                              words={
                                preview.wordsByType[String(current.id)] || []
                              }
                            />
                          ) : (
                            <p
                              className="flex items-center gap-2 text-sm text-muted-foreground"
                              role="status"
                            >
                              <Spinner aria-hidden="true" /> Checking examples…
                            </p>
                          ))}
                      </>
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            </section>
          )}
          {error && <FormError message={error} />}
        </CardContent>
        <CardFooter className="setup-footer">
          <span aria-live="polite">
            {types.length ? `${ready} of ${types.length} types ready` : ""}
          </span>
          <Button
            size="lg"
            aria-busy={busy}
            type="button"
            disabled={
              !canContinue ||
              busy ||
              (preview !== null &&
                !Object.values(preview.wordsByType).some(
                  (words) => words.length,
                ))
            }
            onClick={(event) => void continueToWords(event.currentTarget)}
          >
            {busy ? "Preparing…" : "Continue"}{" "}
            {busy ? (
              <Spinner aria-hidden="true" />
            ) : (
              <ArrowRightIcon aria-hidden="true" />
            )}
          </Button>
        </CardFooter>
      </Card>
      {pendingDeckId !== null && (
        <ReplaceDeckDialog
          returnFocus={deckTrigger.current}
          description="Choosing a different deck will reset the field settings shown here. Your current studied deck will be replaced when you finish setup."
          onCancel={() => setPendingDeckId(null)}
          onConfirm={() => {
            selectDeck(pendingDeckId);
            setPendingDeckId(null);
          }}
        />
      )}
      {pendingSkip && (
        <SkipWordsDialog
          count={pendingSkip.count}
          returnFocus={pendingSkip.trigger}
          onCancel={() => setPendingSkip(null)}
          onManage={() => {
            setPendingSkip(null);
            navigate("/corrections");
          }}
          onContinue={() => void continueAfterWarning()}
        />
      )}
    </main>
  );
}
