import { useRef, type RefObject } from "react";
import { WordLayout, type WordHeaderProps } from "../components/WordLayout";
import { WordSearch } from "../components/WordSearch";

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
        words={header.snapshot.words}
        savedQuery={savedQuery}
        inputRef={searchInput}
      />
    </WordLayout>
  );
}
