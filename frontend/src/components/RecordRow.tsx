import { Link, type To } from "react-router-dom";
import type { Word } from "../types";
import { RubyText } from "./RubyText";
import { Item, ItemContent, ItemDescription, ItemTitle } from "./ui/item";

type Props = {
  word: Pick<Word, "spelling" | "ruby" | "translations">;
  selectedKanji?: string | null;
  visualMatch?: string;
  link?: { to: To; state?: { trail: string[] } };
};

export function RecordRow({ word, selectedKanji, visualMatch, link }: Props) {
  const content = (
    <ItemContent className="grid min-w-0 grid-cols-2 items-center gap-3 sm:gap-4">
      <ItemTitle className="word-row-word min-w-0 max-w-full flex-wrap items-baseline gap-0 wrap-anywhere">
        <RubyText word={word} selected={selectedKanji} />
      </ItemTitle>
      <div className="min-w-0 space-y-1 text-right wrap-anywhere">
        {visualMatch && (
          <ItemDescription className="line-clamp-none text-wrap text-[var(--look)]">
            Similar kanji: {visualMatch}
          </ItemDescription>
        )}
        <ItemDescription className="line-clamp-none text-base text-wrap">
          {word.translations.join(" · ")}
        </ItemDescription>
      </div>
    </ItemContent>
  );

  return link ? (
    <Item asChild variant="outline">
      <Link
        to={link.to}
        state={link.state}
        className="text-foreground no-underline"
      >
        {content}
      </Link>
    </Item>
  ) : (
    <Item role="listitem" variant="outline">
      {content}
    </Item>
  );
}
