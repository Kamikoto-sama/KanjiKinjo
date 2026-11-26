import { Empty, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { ItemGroup } from "../components/ui/item";
import { Spinner } from "../components/ui/spinner";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { RecordRow } from "../components/RecordRow";
import { FormError } from "../components/FormError";
import { Button } from "../components/ui/button";
import { goBack } from "../navigation";
import { readSetupDraft } from "../setupDraft";
import type { Config, DuplicateGroup } from "../types";

type Props = { initialConfig: Config | null; snapshotVersion?: string; showUnstudied: boolean };

export function DuplicatesPage({ initialConfig, snapshotVersion, showUnstudied }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const noteTypeId =
    Number(new URLSearchParams(location.search).get("type")) || null;
  const [draft] = useState(readSetupDraft);
  const config = draft || initialConfig;
  const [previewGroups, setPreviewGroups] = useState<DuplicateGroup[] | null>(
    null,
  );
  const [error, setError] = useState("");

  useEffect(() => {
    if (!config) return;
    let active = true;
    setPreviewGroups(null);
    setError("");
    api
        .preview(config, showUnstudied)
      .then((preview) => {
        if (active) setPreviewGroups(preview.duplicateGroups);
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load duplicates",
          );
      });
    return () => {
      active = false;
    };
  }, [config, snapshotVersion, showUnstudied]);

  const visibleGroups = previewGroups?.filter(
    ({ records }) =>
      noteTypeId === null ||
      records.some((record) => record.noteTypeId === noteTypeId),
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
            onClick={() => goBack(navigate, "/setup")}
          >
            <ArrowLeftIcon className="size-5" aria-hidden="true" />
          </Button>
          <h1>Duplicate words</h1>
        </CardHeader>
        <CardContent className="setup-content">
          {error ? (
            <FormError message={error} />
          ) : !config ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Choose a deck and fields first.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : !visibleGroups ? (
            <Empty role="status">
              <Spinner aria-hidden="true" />
              Checking words…
            </Empty>
          ) : !visibleGroups.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  No duplicate words
                  {noteTypeId === null ? "" : " in this card type"}.
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="m-0 grid list-none gap-4 p-0">
              {visibleGroups.map(({ wordId, records }) => (
                <li key={wordId}>
                  <ItemGroup className="gap-2">
                    {records.map((record) => (
                      <RecordRow key={record.noteId} word={record} />
                    ))}
                  </ItemGroup>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
