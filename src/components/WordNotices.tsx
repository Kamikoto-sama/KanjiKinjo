type Props = {
  count: number;
  inCardType: boolean;
};

function WordsNotice({ message, action, onAction }: { message: string; action: string; onAction: () => void }) {
  return (
    <div className="invalid-words">
      <span role="status">{message}</span>
      <button className="secondary-button" type="button" onClick={onAction}>{action}</button>
    </div>
  );
}

export function UnresolvedWordsNotice({ count, inCardType, onManage }: Props & { onManage: () => void }) {
  const message = `${count} ${count === 1 ? "word" : "words"}${inCardType ? " in this card type" : ""} cannot be imported`;
  return <WordsNotice message={message} action="Manage" onAction={onManage} />;
}

export function DuplicateWordsNotice({ count, inCardType, onView }: Props & { onView: () => void }) {
  const message = `${count} duplicate ${count === 1 ? "record" : "records"}${inCardType ? " in this card type" : ""} will be merged`;
  return <WordsNotice message={message} action="View" onAction={onView} />;
}
