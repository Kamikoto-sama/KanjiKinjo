import { useEffect, useState, type RefObject } from "react";
import { api } from "../api";
import type { Config, NoteType } from "../types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldDescription, FieldLabel } from "./ui/field";
import { Textarea } from "./ui/textarea";
import { useDialogFocus } from "./useDialogFocus";

export function CardLinkTemplateDialog({
  config,
  open,
  onOpenChange,
  returnFocus,
}: {
  config: Config | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const [linkFeedback, setLinkFeedback] = useState("");
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([]);
  const focus = useDialogFocus(returnFocus);
  const cardLinkTemplates = config
    ? Object.entries(config.mappings)
        .filter(([, mapping]) => mapping.status === "configured")
        .map(([noteTypeId, mapping]) => ({
          noteTypeId,
          link: `${window.location.origin}/word?spelling={{text:${mapping.spelling}}}${mapping.reading ? `&reading={{text:${mapping.reading}}}` : ""}`,
        }))
    : [];
  useEffect(() => {
    if (!open || !config) return;
    let active = true;
    api
      .noteTypes(config.deckId, config.includeChildren)
      .then((types) => {
        if (active) setNoteTypes(types);
      })
      .catch(() => {
        if (active) setNoteTypes([]);
      });
    return () => {
      active = false;
    };
  }, [open, config]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setLinkFeedback("");
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent {...focus} showCloseButton={false}>
        <DialogTitle>Card link template</DialogTitle>
        <DialogDescription>
          Add this link to an Anki card template to open the matching studied
          word in KanjiGraph. Anki replaces the field names with values from
          each card. Use each link in the card templates belonging to the named
          note type.
        </DialogDescription>
        {cardLinkTemplates.length ? (
          cardLinkTemplates.map(({ noteTypeId, link }) => (
            <Field className="gap-2" key={noteTypeId}>
              <FieldLabel htmlFor={`card-link-${noteTypeId}`}>
                {`For note type: ${noteTypes.find((type) => String(type.id) === noteTypeId)?.name || noteTypeId}`}
              </FieldLabel>
              <Textarea
                id={`card-link-${noteTypeId}`}
                readOnly
                value={link}
                rows={3}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                variant="outline"
                className="justify-self-start"
                type="button"
                onClick={() => {
                  navigator.clipboard
                    .writeText(link)
                    .then(() => setLinkFeedback("Card link template copied"))
                    .catch(() => setLinkFeedback("Could not copy the link"));
                }}
              >
                Copy link
              </Button>
            </Field>
          ))
        ) : (
          <p className="m-0 text-sm">
            Configure the deck fields first to generate a link template.
          </p>
        )}
        <DialogFooter>
          <FieldDescription className="m-0 mr-auto self-center" role="status">
            {linkFeedback}
          </FieldDescription>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
