import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  DownloadIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type DictionaryManifest } from "../api";
import {
  loadDictionary,
  readDictionary,
  type CachedDictionary,
} from "../cache";
import { FormError } from "../components/FormError";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "../components/ui/card";
import { goBack } from "../navigation";

function formatDownloadSize(manifest: DictionaryManifest) {
  const bytes = manifest.files.reduce((total, file) => total + file.bytes, 0);
  if (bytes >= 1_000_000) return `${Math.round(bytes / 100_000) / 10} MB`;
  return `${Math.ceil(bytes / 1_000)} KB`;
}

export function DictionariesPage({
  ready,
  onReady,
}: {
  ready: boolean;
  onReady: (dictionary: CachedDictionary) => void;
}) {
  const navigate = useNavigate();
  const [manifest, setManifest] = useState<DictionaryManifest | null>(null);
  const [detailsAttempt, setDetailsAttempt] = useState(0);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState<number | null>(null);
  const downloadRequest = useRef<AbortController | null>(null);
  const downloading = completed !== null;
  const checkingSize = !ready && !manifest && !error;

  useEffect(() => {
    if (ready) return;
    const controller = new AbortController();
    void api
      .manifest(controller.signal)
      .then((details) => {
        if (controller.signal.aborted) return;
        if (details.datasetVersion === "unavailable")
          throw new Error("Dictionaries are unavailable on the server.");
        setManifest(details);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "Try again.");
      });
    return () => controller.abort();
  }, [detailsAttempt, ready]);

  useEffect(() => () => downloadRequest.current?.abort(), []);

  async function download(details: DictionaryManifest) {
    if (downloadRequest.current) return;
    const controller = new AbortController();
    downloadRequest.current = controller;
    setError("");
    setCompleted(0);
    try {
      await loadDictionary(details, controller.signal, setCompleted);
      const dictionary = await readDictionary();
      controller.signal.throwIfAborted();
      onReady(dictionary);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : "Try again.");
    } finally {
      downloadRequest.current = null;
      if (!controller.signal.aborted) setCompleted(null);
    }
  }

  function handleAction() {
    if (downloading || checkingSize) return;
    if (ready) navigate("/setup", { replace: true });
    else if (manifest) void download(manifest);
    else {
      setError("");
      setDetailsAttempt((attempt) => attempt + 1);
    }
  }

  let action = "Download";
  if (ready) action = "Continue to deck setup";
  else if (downloading) action = "Downloading…";
  else if (error) action = manifest ? "Retry download" : "Retry";

  let downloadSize = "Unavailable";
  if (manifest) downloadSize = `About ${formatDownloadSize(manifest)}`;
  else if (ready) downloadSize = "Already downloaded";
  else if (checkingSize) downloadSize = "Checking…";

  return (
    <main className="screen active">
      <Card className="setup-window gap-0 py-0">
        <CardHeader className="setup-header">
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Back"
            onClick={() => {
              downloadRequest.current?.abort();
              goBack(navigate, "/import");
            }}
          >
            <ArrowLeftIcon className="size-5" aria-hidden="true" />
          </Button>
          <h1>Dictionaries</h1>
        </CardHeader>

        <CardContent className="setup-content">
          <section
            className="mx-auto grid w-full max-w-xl gap-5 py-4 sm:py-10"
            aria-labelledby="dictionary-data"
          >
            <div className="flex items-start gap-4">
              <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                <BookOpenIcon className="size-6" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="m-0 text-xl font-semibold" id="dictionary-data">
                  Japanese dictionary data
                </h2>
                <p className="mt-2 mb-0 text-sm leading-relaxed text-muted-foreground">
                  KanjiKinjo uses dictionary data to find readings, add
                  furigana, and find words in your deck with visually similar
                  kanji. The data is stored on this device for offline use.
                </p>
              </div>
            </div>

            <Card className="gap-3 p-4 sm:p-5">
              <dl className="m-0 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Download size</dt>
                <dd className="m-0 font-medium tabular-nums">{downloadSize}</dd>
              </dl>
              {downloading && manifest && (
                <div className="grid gap-2 border-t border-border pt-3 [border-top-style:solid]">
                  <progress
                    className="h-2 w-full accent-primary"
                    aria-label="Dictionary download"
                    value={completed}
                    max={manifest.files.length || 1}
                  />
                  <p
                    className="m-0 text-xs text-muted-foreground"
                    role="status"
                  >
                    {completed} of {manifest.files.length} files downloaded
                  </p>
                </div>
              )}
              {ready && manifest && (
                <p className="m-0 text-sm text-muted-foreground" role="status">
                  Dictionaries are ready to use.
                </p>
              )}
              {error && (
                <FormError
                  message={`${manifest ? "Could not load dictionaries" : "Could not check download size"}. ${error}`}
                />
              )}
            </Card>
          </section>
        </CardContent>

        <CardFooter className="setup-footer">
          <Button
            className="ml-auto w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-50 sm:w-auto"
            size="lg"
            onClick={handleAction}
            disabled={checkingSize}
            aria-disabled={downloading}
          >
            {ready ? (
              <ArrowRightIcon aria-hidden="true" />
            ) : (
              <DownloadIcon aria-hidden="true" />
            )}
            {action}
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
