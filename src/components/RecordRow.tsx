import { RubyText } from "./RubyText";
import type { Word } from "../types";

export function RecordRow({ word }: { word: Pick<Word, "spelling" | "ruby" | "translations"> }) {
  return (
    <div className="word-row">
      <span className="word-row-word"><RubyText word={word} /></span>
      <span className="word-row-meaning">{word.translations.join(" · ")}</span>
    </div>
  );
}
