import type { Word } from "./types";

export function wordPath(word: Pick<Word, "spelling" | "reading">): string {
  const params = new URLSearchParams({ spelling: word.spelling, reading: word.reading });
  return `/word?${params.toString()}`;
}
