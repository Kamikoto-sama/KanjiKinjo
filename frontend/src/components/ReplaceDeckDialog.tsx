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
  onCancel: () => void;
  onConfirm: () => void;
  description?: string;
  returnFocus?: HTMLElement | null;
};

export function ReplaceDeckDialog({
  onCancel,
  onConfirm,
  returnFocus,
  description = "Your current deck, field settings, and word corrections will be deleted when you import a new deck. You will start setup again.",
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
        <AlertDialogTitle>Replace current deck?</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Continue
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
