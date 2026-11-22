import type { LinkProps } from "react-router-dom";
import { groupNames, groupOrder, lookalikePairs } from "../relations";
import type { Group, Word } from "../types";
import { RecordRow } from "./RecordRow";
import { Button } from "./ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "./ui/empty";
import { ItemGroup } from "./ui/item";

export function RelatedWordList({
  groups,
  grouped = false,
  word,
  wordLink,
  similar,
  selectedKanji,
  limit,
  onShowMore,
}: {
  groups: Partial<Record<Group, Word[]>>;
  grouped?: boolean;
  word: Word;
  wordLink: (word: Word) => LinkProps;
  similar: Record<string, string[]>;
  selectedKanji: string | null;
  limit: number;
  onShowMore: () => void;
}) {
  const count = groupOrder.reduce(
    (total, kind) => total + (groups[kind]?.length ?? 0),
    0,
  );
  let remaining = limit;
  const visibleGroups = groupOrder.flatMap((kind) => {
    const rows = groups[kind]?.slice(0, remaining) ?? [];
    remaining -= rows.length;
    return rows.length ? [{ kind, rows }] : [];
  });
  if (!count) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No similar words found.</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="grid gap-2">
      {visibleGroups.map(({ kind, rows }) => (
        <ItemGroup
          key={kind}
          role="group"
          aria-label={groupNames[kind]}
          className="gap-2"
        >
          {grouped && (
            <h2
              className="relation-label m-0 rounded-md bg-[color-mix(in_srgb,currentColor_24%,var(--background))] px-3 py-1.5 text-center text-base font-semibold"
              data-group={kind}
            >
              {groupNames[kind]}
            </h2>
          )}
          {rows.map((item) => (
            <RecordRow
              key={item.wordId}
              word={item}
              selectedKanji={selectedKanji}
              visualMatch={
                kind === "lookalikes"
                  ? lookalikePairs(word, item, similar).join(" · ")
                  : undefined
              }
              link={wordLink(item)}
            />
          ))}
        </ItemGroup>
      ))}
      {count > limit && (
        <Button
          type="button"
          variant="outline"
          className="justify-self-center"
          onClick={onShowMore}
        >
          Show more
        </Button>
      )}
    </div>
  );
}
