import { InfoIcon, TriangleAlertIcon } from "lucide-react";
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
