import type { Word } from "../types";
import { rubyParts } from "../relations";

const kanjiPattern = /[\u3400-\u9fff\uf900-\ufaff]/u;

type Props = {
  word: Pick<Word, "spelling" | "ruby">;
  interactive?: boolean;
  selected?: string | null;
  onKanji?: (character: string) => void;
};

export function RubyText({
  word,
  interactive = false,
  selected,
  onKanji,
}: Props) {
  return (
    <>
      {rubyParts(word).map((part, index) => {
        const characters = [...part.text].map((character, position) => {
          if (interactive && kanjiPattern.test(character))
            return (
              <button
                key={position}
                className={selected === character ? "selected" : ""}
                type="button"
                onClick={() => onKanji?.(character)}
                aria-label={`Show words with ${character}${part.reading ? `; group reading ${part.reading}` : ""}`}
              >
                {character}
              </button>
            );
          return (
            <span
              key={position}
              className={
                !interactive && selected === character ? "kanji-highlight" : ""
              }
            >
              {character}
            </span>
          );
        });
        return (
          <span key={index} className={part.reading ? "" : "kana-part"}>
            {part.reading ? (
              <ruby>
                {characters}
                <rt>{part.reading}</rt>
              </ruby>
            ) : (
              characters
            )}
          </span>
        );
      })}
    </>
  );
}
