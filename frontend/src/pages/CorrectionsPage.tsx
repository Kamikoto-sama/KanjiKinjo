import { Badge } from "../components/ui/badge";
import { Empty, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../components/ui/field";
import { Item, ItemGroup } from "../components/ui/item";
import { Separator } from "../components/ui/separator";
import { Spinner } from "../components/ui/spinner";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { FormError } from "../components/FormError";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { goBack } from "../navigation";
import { readSetupDraft } from "../setupDraft";
import type { Config, Preview, Snapshot, UnresolvedWord } from "../types";

type Props = {
  initialConfig: Config | null;
  onSnapshot: (snapshot: Snapshot) => void;
};

export function CorrectionsPage({ initialConfig, onSnapshot }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const noteTypeId =
    Number(new URLSearchParams(location.search).get("type")) || null;
  const [draft] = useState(readSetupDraft);
  const config = draft || initialConfig;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState("");
  const [spelling, setSpelling] = useState("");
  const [reading, setReading] = useState("");
  const [ruby, setRuby] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const items =
    preview?.unresolved.filter(
      (item) => noteTypeId === null || item.noteTypeId === noteTypeId,
    ) || [];
  const active = items.find((item) => item.noteId === selected) || items[0];

  function select(item: UnresolvedWord) {
    setSelected(item.noteId);
    setSpelling(item.spelling);
    setReading(item.reading || "");
    setRuby(item.spelling);
    setError("");
  }

  useEffect(() => {
    if (!config) return;
    let active = true;
    api
      .preview(config)
      .then((next) => {
        if (!active) return;
        setPreview(next);
        const first = next.unresolved.find(
          (item) => noteTypeId === null || item.noteTypeId === noteTypeId,
        );
        if (first) select(first);
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [config, noteTypeId, location.key]);

  async function save() {
    if (!active || !config) return;
    setBusy(true);
    setError("");
    try {
      await api.saveCorrection(active.noteId, spelling, reading, ruby);
      const next = await api.preview(config);
      setPreview(next);
      const first = next.unresolved.find(
        (item) => noteTypeId === null || item.noteTypeId === noteTypeId,
      );
      if (first) select(first);
      else setSelected("");
      try {
        const snapshot = await api.snapshot();
        onSnapshot(snapshot);
      } catch {
        // A snapshot is created only after the deck settings have been saved.
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save correction",
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
            onClick={() => goBack(navigate, "/setup")}
          >
            <ArrowLeftIcon className="size-5" aria-hidden="true" />
          </Button>
          <h1>Word corrections</h1>
        </CardHeader>
        <CardContent className="setup-content">
          {!config ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Choose a deck and fields first.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : !preview && !error ? (
            <Empty role="status">
              <Spinner aria-hidden="true" />
              Checking words…
            </Empty>
          ) : !items.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  All studied words{" "}
                  {noteTypeId === null ? "" : "in this card type "}are resolved.
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <p className="m-0 mb-4 text-sm text-muted-foreground">
                {items.length} words cannot be imported until corrected.
                Uncorrected words will be skipped.
              </p>
              <ItemGroup
                role="group"
                aria-label="Words to correct"
                className="mb-4 flex-row flex-wrap gap-2"
              >
                {items.map((item) => (
                  <Item
                    asChild
                    key={item.noteId}
                    variant="outline"
                    size="sm"
                    className="hover:bg-accent aria-pressed:border-primary aria-pressed:bg-accent"
                  >
                    <button
                      type="button"
                      aria-pressed={item.noteId === active?.noteId}
                      disabled={busy}
                      onClick={() => select(item)}
                    >
                      {item.spelling}
                      <Badge variant="secondary">
                        {item.reason === "needsRuby"
                          ? "Furigana needed"
                          : "Reading needed"}
                      </Badge>
                    </button>
                  </Item>
                ))}
              </ItemGroup>
              {active && (
                <FieldGroup className="gap-4">
                  <Separator />
                  <Field>
                    <FieldLabel htmlFor="correct-spelling">
                      Word / spelling
                    </FieldLabel>
                    <Input
                      disabled={busy}
                      id="correct-spelling"
                      value={spelling}
                      onChange={(event) => setSpelling(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="correct-reading">
                      Reading (optional)
                    </FieldLabel>
                    <Input
                      disabled={busy}
                      id="correct-reading"
                      value={reading}
                      onChange={(event) => setReading(event.target.value)}
                      placeholder="Calculated from furigana"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="correct-ruby">Furigana</FieldLabel>
                    <Input
                      disabled={busy}
                      id="correct-ruby"
                      value={ruby}
                      onChange={(event) => setRuby(event.target.value)}
                      placeholder="工[こう]場[じょう]"
                      aria-describedby="furigana-help"
                    />
                    <FieldDescription id="furigana-help">
                      Put each kanji or kanji group before its reading in
                      brackets, for example 工[こう]場[じょう]. Reading is
                      calculated from furigana if left blank.
                    </FieldDescription>
                  </Field>
                  {error && <FormError message={error} />}
                  <Button
                    className="self-start"
                    size="lg"
                    type="button"
                    disabled={busy}
                    aria-busy={busy}
                    onClick={save}
                  >
                    {busy ? "Saving…" : "Save correction"}{" "}
                    {busy ? (
                      <Spinner aria-hidden="true" />
                    ) : (
                      <ArrowRightIcon aria-hidden="true" />
                    )}
                  </Button>
                </FieldGroup>
              )}
            </>
          )}
          {error && !active && <FormError message={error} />}
        </CardContent>
      </Card>
    </main>
  );
}
