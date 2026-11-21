import { Link, type To } from "react-router-dom";
import type { Word } from "../types";
import { RubyText } from "./RubyText";
import { Item, ItemContent, ItemDescription, ItemTitle } from "./ui/item";

type Props = {
  word: Pick<Word, "spelling" | "ruby" | "translations">;
  selectedKanji?: string | null;
  visualMatch?: string;
  link?: { to: To; state: { trail: string[] } };
};

export function RecordRow({ word, selectedKanji, visualMatch, link }: Props) {
  const content = (
    <ItemContent className="min-w-0">
      <ItemTitle className="word-row-word max-w-full flex-wrap gap-0">
        <RubyText word={word} selected={selectedKanji} />
      </ItemTitle>
      {visualMatch && (
        <ItemDescription className="text-[var(--look)]">
          Similar kanji: {visualMatch}
        </ItemDescription>
      )}
      <ItemDescription className="line-clamp-none wrap-anywhere">
        {word.translations.join(" · ")}
      </ItemDescription>
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
