import { type RefObject, useState } from "react";
import type { SyncResult } from "../api";
import { FormError } from "./FormError";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, } from "./ui/dialog";
import { useDialogFocus } from "./useDialogFocus";

export function MissingWordSyncDialog({
  spelling,
  reading,
  onSync,
  returnFocus,
}: {
  spelling: string | null;
  reading: string | null;
  onSync: () => Promise<SyncResult | null>;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const focus = useDialogFocus(returnFocus);

  async function sync() {
    setBusy(true);
    setError("");
    try {
      if (await onSync()) setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <DialogContent
        {...focus}
        showCloseButton={false}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogTitle>Word not found</DialogTitle>
        <DialogDescription>
          {spelling ? (
            <>
              The word <strong>{spelling}</strong>
            </>
          ) : (
            "This word"
          )}
          {reading && (
            <>
              {" "}
              with the reading <strong>{reading}</strong>
            </>
          )}
          {
              " was not found in this deck. The deck may be out of date. Sync the deck?"
          }
        </DialogDescription>
        {error && <FormError message={error} />}
        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={busy} aria-busy={busy} onClick={sync}>
            {busy ? "Syncing…" : "Sync"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
