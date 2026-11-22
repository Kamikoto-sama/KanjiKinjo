import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "./ui/dialog";
import { useDialogFocus } from "./useDialogFocus";

type Props = {
  unresolvedCount: number;
  duplicateCount: number;
  onDismiss: () => void;
  onOpenSetup: () => void;
  returnFocus?: HTMLElement;
};

export function SyncResultsDialog({
  unresolvedCount,
  duplicateCount,
  onDismiss,
  onOpenSetup,
  returnFocus,
}: Props) {
  const focus = useDialogFocus(returnFocus);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent {...focus} showCloseButton={false}>
        <DialogTitle>Review synced words</DialogTitle>
        <DialogDescription asChild>
          <div className="grid gap-2">
            {unresolvedCount > 0 && (
              <p className="m-0">
                {unresolvedCount} new {unresolvedCount === 1 ? "word" : "words"}{" "}
                cannot be imported.
              </p>
            )}
            {duplicateCount > 0 && (
              <p className="m-0">
                {duplicateCount} new duplicate{" "}
                {duplicateCount === 1 ? "record" : "records"} will be merged.
              </p>
            )}
          </div>
        </DialogDescription>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button onClick={onOpenSetup}>Deck &amp; fields</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
