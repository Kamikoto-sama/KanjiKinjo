import { SearchIcon } from "lucide-react";
import { type Ref, type RefObject, useMemo, useRef, useState } from "react";
import type { Word } from "../types";
import { wordPath } from "../wordPath";
import { RecordRow } from "./RecordRow";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ItemGroup } from "./ui/item";

const pageSize = 50;

export function WordSearch({
  words,
                               showingUnstudied,
  savedQuery,
  inputRef,
}: {
  words: Word[];
    showingUnstudied: boolean;
  inputRef: Ref<HTMLInputElement>;
  savedQuery: RefObject<string>;
}) {
  const [query, setQuery] = useState(() => savedQuery.current);
  const [limit, setLimit] = useState(pageSize);
  const results = useRef<HTMLDivElement>(null);
  const spelling = query.trim().normalize("NFC");
    const emptyDeck = showingUnstudied ? "No words in this deck." : "No studied words in this deck.";
  const matches = useMemo(() => {
    if (!spelling) return [];
    const exact: Word[] = [];
    const prefixes: Word[] = [];
    const substrings: Word[] = [];
    for (const word of words) {
      if (word.spelling === spelling) exact.push(word);
      else if (word.spelling.startsWith(spelling)) prefixes.push(word);
      else if (word.spelling.includes(spelling)) substrings.push(word);
    }
    return exact.concat(prefixes, substrings);
  }, [words, spelling]);

  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-labelledby="word-search-heading"
    >
      <div className="mx-auto w-full max-w-2xl shrink-0 px-4 pt-5 pb-3">
        <h1 id="word-search-heading" className="mb-3 text-lg font-semibold">
          <label htmlFor="word-search">Search by spelling</label>
        </h1>
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={inputRef}
            id="word-search"
            type="search"
            value={query}
            onChange={(event) => {
              savedQuery.current = event.currentTarget.value;
              setQuery(event.currentTarget.value);
              setLimit(pageSize);
              results.current?.scrollTo({ top: 0 });
            }}
            placeholder="e.g. 転勤"
            autoComplete="off"
            spellCheck={false}
            className="pl-9"
          />
        </div>
      </div>
      <div className="word-content" ref={results}>
        <div className="mx-auto grid w-full max-w-2xl gap-3 px-4 pb-5">
          <p className="m-0 text-sm text-muted-foreground" role="status">
            {!words.length
                ? emptyDeck
              : spelling &&
                (matches.length
                  ? `${matches.length} ${matches.length === 1 ? "result" : "results"}`
                  : "No matching words.")}
          </p>
          {matches.length > 0 && (
            <ItemGroup
              role="group"
              aria-label="Search results"
              className="gap-2"
            >
              {matches.slice(0, limit).map((word) => (
                <RecordRow
                  key={word.wordId}
                  word={word}
                  link={{ to: wordPath(word) }}
                />
              ))}
            </ItemGroup>
          )}
          {matches.length > limit && (
            <Button
              type="button"
              variant="outline"
              className="justify-self-center"
              onClick={() => setLimit((current) => current + pageSize)}
            >
              Show more
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
