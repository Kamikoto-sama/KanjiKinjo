import { type RefObject, useRef } from "react";
import { type WordHeaderProps, WordLayout } from "../components/WordLayout";
import { WordSearch } from "../components/WordSearch";
import { snapshotWords } from "../snapshot";

export default function SearchPage({
  savedQuery,
  ...header
}: WordHeaderProps & {
  savedQuery: RefObject<string>;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  return (
    <WordLayout {...header} searchInput={searchInput} menuButton={menuButton}>
      <WordSearch
          words={snapshotWords(header.snapshot, header.showUnstudied).words}
          showingUnstudied={header.showUnstudied && Boolean(header.snapshot.includingUnstudied)}
        savedQuery={savedQuery}
        inputRef={searchInput}
      />
    </WordLayout>
  );
}
