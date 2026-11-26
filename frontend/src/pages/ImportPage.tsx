import { Separator } from "../components/ui/separator";
import { Spinner } from "../components/ui/spinner";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, } from "../components/ui/card";
import { ArrowLeftIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { ReplaceDeckDialog } from "../components/ReplaceDeckDialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useDialogFocus } from "../components/useDialogFocus";
import { canGoBack } from "../navigation";
import type { CollectionData, Status } from "../types";

type Props = {
  status: Status | null;
  onReplace: (collection: CollectionData, auth: null) => Promise<void>;
};

export function ImportPage({ status, onReplace }: Props) {
  const navigate = useNavigate();
  const upload = useRef<HTMLInputElement>(null);
  const chooseFile = useRef<HTMLButtonElement>(null);
  const errorDialogFocus = useDialogFocus(chooseFile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    kind: "account" | "file";
    trigger: HTMLButtonElement;
  } | null>(null);
  const importedFromFile = status?.hasCollection && !status?.hasAnkiSession
  const importedFromAnki = status?.hasCollection && status?.hasAnkiSession

  function cancelReplacement() {
    setPendingImport(null);
    if (upload.current) upload.current.value = "";
  }

  function requestAccountSwitch(trigger: HTMLButtonElement) {
    if (status?.hasCollection) setPendingImport({ kind: "account", trigger });
    else navigate("/login");
  }

  function requestFileSelection(trigger: HTMLButtonElement) {
    if (status?.hasCollection) setPendingImport({ kind: "file", trigger });
    else upload.current?.click();
  }

  function confirmReplacement() {
    const choice = pendingImport?.kind;
    setPendingImport(null);
    if (choice === "account")
      navigate("/login", { state: { replaceDeckConfirmed: true } });
    else if (choice === "file") upload.current?.click();
  }

  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await onReplace(await api.importFile(file), null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Import failed");
      setBusy(false);
      if (upload.current) upload.current.value = "";
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
            disabled={!canGoBack()}
            onClick={() => navigate(-1)}
          >
            <ArrowLeftIcon className="size-5" aria-hidden="true" />
          </Button>
          <h1>Import deck</h1>
        </CardHeader>
        <CardContent className="setup-content flex flex-col justify-center-safe">
          <div className="mx-auto w-full max-w-xl text-center">
            <div className="mb-6">
              <h2 className="m-0 mb-2 text-xl font-semibold">
                Bring your deck into KanjiKinjo
              </h2>
              <p className="m-0 text-sm text-muted-foreground">
                {status?.hasSnapshot
                    ? "You have already imported a deck"
                    : "Connect AnkiWeb or choose a deck file to see your words and their connections."
                }
              </p>
            </div>
            <Card>
              <CardHeader>
                <h3 className="m-0 text-lg font-semibold">
                  AnkiWeb
                </h3>
                <CardDescription>
                  {status?.hasAnkiSession ? (
                    <>
                      Signed in as <strong>{status.ankiAccount || "[unknown account]"}</strong>
                    </>
                  ) : (
                      "Sign in to sync and import your cards from AnkiWeb."
                  )}
                </CardDescription>
              </CardHeader>
              <CardFooter className="flex-wrap justify-center gap-3">
                <Button
                  size="lg"
                  type="button"
                  variant={ !importedFromFile && !importedFromAnki ? "default" : "outline" }
                  disabled={busy}
                  onClick={(event) => requestAccountSwitch(event.currentTarget)}
                >
                  {status?.hasAnkiSession
                    ? "Switch Account"
                    : "Sign in to AnkiWeb"}
                </Button>
                {importedFromAnki && (
                  <Button
                    size="lg"
                    type="button"
                    disabled={busy}
                    onClick={() => navigate("/setup")}
                  >
                    Continue
                  </Button>
                )}
              </CardFooter>
            </Card>
            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
              <Separator className="flex-1" />
              <span>OR</span>
              <Separator className="flex-1" />
            </div>
            <Card>
              <CardHeader>
                <h3 className="m-0 text-lg font-semibold">
                  Import deck directly from file
                </h3>
                <CardDescription>
                  {importedFromFile && (
                    <>
                      Current deck was imported from a file.
                      <br />
                    </>
                  )}
                  Choose an Anki .apkg or .colpkg package with review history.
                </CardDescription>
              </CardHeader>
              <CardFooter className="flex-wrap justify-center gap-3">
                <Button
                  ref={chooseFile}
                  size="lg"
                  variant="outline"
                  type="button"
                  disabled={busy}
                  aria-busy={busy}
                  onClick={(event) => requestFileSelection(event.currentTarget)}
                >
                  {busy ? (
                    <>
                      <Spinner aria-hidden="true" /> Importing…
                    </>
                  ) : (
                    "Choose file"
                  )}
                </Button>
                <Input
                  ref={upload}
                  tabIndex={-1}
                  className="sr-only"
                  type="file"
                  accept=".apkg,.colpkg"
                  onChange={(event) => void importFile(event.target.files?.[0])}
                />
                {importedFromFile && (
                  <Button
                    size="lg"
                    type="button"
                    disabled={busy}
                    onClick={() => navigate("/setup")}
                  >
                    Continue
                  </Button>
                )}
              </CardFooter>
            </Card>
          </div>
        </CardContent>
      </Card>
      {pendingImport && (
        <ReplaceDeckDialog
          returnFocus={pendingImport.trigger}
          onCancel={cancelReplacement}
          onConfirm={confirmReplacement}
        />
      )}
      {error !== null && (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setError(null);
          }}
        >
          <AlertDialogContent {...errorDialogFocus}>
            <AlertDialogTitle>Import failed</AlertDialogTitle>
            <AlertDialogDescription>{error}</AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>OK</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </main>
  );
}
