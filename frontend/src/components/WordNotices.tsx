import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { SyncResult } from "../api";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";

type Props = {
  count: number;
  inCardType: boolean;
};

function WordsNotice({
  warning = false,
  message,
  action,
  onAction,
}: {
  warning?: boolean;
  message: string;
  action: string;
  onAction: () => void;
}) {
  const Icon = warning ? TriangleAlertIcon : InfoIcon;
  return (
    <Alert
      className="import-notice"
      variant={warning ? "warning" : "default"}
      role="status"
    >
      <Icon aria-hidden="true" />
      <AlertTitle>
        {warning ? "Import warning" : "Duplicate records"}
      </AlertTitle>
      <AlertDescription className="import-notice-actions">
        <span>{message}</span>
        <Button variant="outline" size="sm" type="button" onClick={onAction}>
          {action}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function UnresolvedWordsNotice({
  count,
  inCardType,
  onManage,
}: Props & { onManage: () => void }) {
  const message = `${count} ${count === 1 ? "word" : "words"}${inCardType ? " in this card type" : ""} cannot be imported`;
  return (
    <WordsNotice
      warning
      message={message}
      action="Manage"
      onAction={onManage}
    />
  );
}

export function DuplicateWordsNotice({
  count,
  inCardType,
  onView,
}: Props & { onView: () => void }) {
  const message = `${count} duplicate ${count === 1 ? "record" : "records"}${inCardType ? " in this card type" : ""} will be merged`;
  return <WordsNotice message={message} action="View" onAction={onView} />;
}

export function UnstudiedDataNotice({
                                        hasAnkiSession,
                                        onSync,
                                    }: {
    hasAnkiSession: boolean;
    onSync?: (returnFocus: HTMLElement) => Promise<SyncResult | null>;
}) {
    const [busy, setBusy] = useState(false);

    async function sync(trigger: HTMLButtonElement) {
        setBusy(true);
        try {
            await onSync?.(trigger);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Sync failed");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Alert>
            <InfoIcon aria-hidden="true"/>
            <AlertDescription className="import-notice-actions">
        <span role="status">
          {hasAnkiSession
              ? "Sync the deck to show unstudied words."
              : "Re-import the deck to show unstudied words."}
        </span>
                {hasAnkiSession ? (
                    onSync && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={(event) => void sync(event.currentTarget)}
                        >
                            {busy ? "Syncing…" : "Sync"}
                        </Button>
                    )
                ) : (
                    <Button asChild variant="outline" size="sm">
                        <Link to="/import">Re-import deck</Link>
                    </Button>
                )}
            </AlertDescription>
        </Alert>
    );
}
