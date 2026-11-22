import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { useDialogFocus } from "./useDialogFocus";

type Props = {
  count: number;
  onCancel: () => void;
  onManage: () => void;
  onContinue: () => void;
  returnFocus: HTMLElement;
};

export function SkipWordsDialog({
  count,
  onCancel,
  onManage,
  onContinue,
  returnFocus,
}: Props) {
  const focus = useDialogFocus(returnFocus);
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent {...focus} onBackdropClick={onCancel}>
        <AlertDialogTitle>
          Continue without {count} {count === 1 ? "word" : "words"}?
        </AlertDialogTitle>
        <AlertDialogDescription>
          These words in the selected deck cannot be imported and will be
          skipped. You can correct them before continuing.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
          <Button type="button" variant="outline" onClick={onManage}>
            Manage words
          </Button>
          <Button type="button" onClick={onContinue}>
            Continue
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
