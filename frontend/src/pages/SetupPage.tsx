import { Field, FieldLabel } from "../components/ui/field";
import { Spinner } from "../components/ui/spinner";
import {
  Card,
  CardContent,
  CardHeader,
  CardFooter,
} from "../components/ui/card";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { SetupMappingForm } from "../components/SetupMappingForm";
import { useSetupPreview } from "../components/useSetupPreview";
import { useSetupSave } from "../components/useSetupSave";
import { FormError } from "../components/FormError";
import { ReplaceDeckDialog } from "../components/ReplaceDeckDialog";
import { SkipWordsDialog } from "../components/SkipWordsDialog";
import { Button } from "../components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "../components/ui/native-select";
import { Switch } from "../components/ui/switch";
import { goBack } from "../navigation";
import { readSetupDraft } from "../setupDraft";
import type { Config, Deck, Mapping, NoteType, Snapshot } from "../types";

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
  const [error, setError] = useState("");
  const deckTrigger = useRef<HTMLSelectElement>(null);
  const [pendingDeckId, setPendingDeckId] = useState<number | null>(null);
  const config = useMemo(
    () =>
      deckId && types.length ? { deckId, includeChildren, mappings } : null,
    [deckId, includeChildren, mappings, types.length],
  );
  const {
    preview,
    error: previewError,
    getPrepared,
    showPrepared,
  } = useSetupPreview(config, snapshotVersion);
  const { busy, save, skipWarning, dismissSkip, confirmSkip } = useSetupSave({
    getPrepared,
    showPrepared,
    onSaved: openWords,
    setError,
  });

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

  const current = types[selectedType];
  const mapping = current ? mappings[String(current.id)] : null;
  const ready = types.filter(
    (type) => mappings[String(type.id)]?.status !== "unconfigured",
  ).length;
  const canContinue =
    types.length > 0 &&
    ready === types.length &&
    types.some((type) => mappings[String(type.id)]?.status === "configured");

  function change(field: keyof Mapping, value: string) {
    if (!current || !mapping) return;
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

  function openWords(snapshot: Snapshot, config: Config) {
    onReady(snapshot, config);
    sessionStorage.removeItem("setupDraft");
    const pending = sessionStorage.getItem("pendingWord");
    sessionStorage.removeItem("pendingWord");
    if (pending) navigate(pending, { replace: true });
    else navigate("/search");
  }

  async function continueToWords(trigger: HTMLButtonElement) {
    if (canContinue) await save(trigger);
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
                  setIncludeChildren(checked);
                }}
              />
            </Field>
          </div>
          {deckId > 0 && types.length > 0 && (
            <SetupMappingForm
              types={types}
              mappings={mappings}
              selectedType={selectedType}
              setSelectedType={setSelectedType}
              preview={preview}
              busy={busy}
              change={change}
              changeStatus={changeStatus}
              continueToWords={continueToWords}
              setError={setError}
            />
          )}
          {(error || previewError) && (
            <FormError message={error || previewError} />
          )}
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
      {skipWarning && (
        <SkipWordsDialog
          {...skipWarning}
          onCancel={dismissSkip}
          onManage={() => {
            dismissSkip();
            navigate("/corrections");
          }}
          onContinue={confirmSkip}
        />
      )}
    </main>
  );
}
