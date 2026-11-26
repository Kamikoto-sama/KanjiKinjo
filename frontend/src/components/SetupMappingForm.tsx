import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { Mapping, NoteType, Preview } from "../types";
import { MappingField } from "./MappingField";
import { RecordPreview } from "./RecordPreview";
import { DuplicateWordsNotice, UnresolvedWordsNotice } from "./WordNotices";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { Spinner } from "./ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export function SetupMappingForm({
  types,
  mappings,
  selectedType,
  setSelectedType,
  preview,
                                     hasHiddenWords,
  busy,
  change,
  changeStatus,
  continueToWords,
  setError,
}: {
  types: NoteType[];
  mappings: Record<string, Mapping>;
  selectedType: number;
  setSelectedType: (index: number) => void;
  preview: Preview | null;
    hasHiddenWords: boolean;
  busy: boolean;
  change: (field: keyof Mapping, value: string) => void;
  changeStatus: (status: Mapping["status"]) => void;
  continueToWords: (trigger: HTMLButtonElement) => Promise<void>;
  setError: (message: string) => void;
}) {
  const navigate = useNavigate();
  const noteTabs = useRef<HTMLDivElement>(null);
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

  return (
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
            const status = mappings[String(type.id)]?.status || "unconfigured";
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
                <Badge variant="secondary">{type.count.toLocaleString()}</Badge>
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
                          else void continueToWords(event.currentTarget);
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
                    onManage={() => navigate(`/corrections?type=${current.id}`)}
                  />
                )}
                {duplicateCount > 0 && (
                  <DuplicateWordsNotice
                    count={duplicateCount}
                    inCardType
                    onView={() => navigate(`/duplicates?type=${current.id}`)}
                  />
                )}
                {mapping.status !== "skipped" &&
                  (preview ? (
                    <RecordPreview
                      key={current.id}
                      words={preview.wordsByType[String(current.id)] || []}
                      hasHiddenWords={hasHiddenWords}
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
  );
}
