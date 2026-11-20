import type { Group, RubyPart, Word } from "./types";

export const groupOrder: Group[] = [
  "same",
  "lookalikes",
  "sameReading",
  "similarReading",
];
export const groupNames: Record<Group, string> = {
  same: "Same kanji",
  lookalikes: "Lookalikes",
  sameReading: "Same reading",
  similarReading: "Similar reading",
};

export type Groups = Record<Group, Word[]>;

export function kanjiOf(word: Word): string[] {
  return [...word.spelling].filter((char) =>
    /[\u3400-\u9fff\uf900-\ufaff]/u.test(char),
  );
}

export function readingOf(word: Word, character: string): string | null {
  const part = word.ruby?.find(
    (piece) => piece.text === character && piece.reading,
  );
  return part?.reading ?? null;
}

export function lookalikePairs(
  selected: Word,
  candidate: Word,
  similar: Record<string, string[]>,
): string[] {
  const source = kanjiOf(selected);
  const target = kanjiOf(candidate);
  const pairs = source.flatMap((left) =>
    target
      .filter((right) => isLookalike(left, right, similar))
      .map((right) => `${left} ↔ ${right}`),
  );
  return [...new Set(pairs)];
}

function normalizedReading(reading: string): string {
  return reading.replace(/[うっ]/g, "");
}

function sameRank(selected: Word, candidate: Word): number {
  if (selected.spelling === candidate.spelling) return 0;
  const source = [...selected.spelling];
  const target = [...candidate.spelling];
  if (
    source.some(
      (char, index) =>
        /[\u3400-\u9fff\uf900-\ufaff]/u.test(char) && target[index] === char,
    )
  )
    return 1;
  return 2;
}

function matchingReading(selected: Word, candidate: Word): boolean {
  return kanjiOf(selected).some(
    (char) =>
      kanjiOf(candidate).includes(char) &&
      readingOf(selected, char) !== null &&
      readingOf(selected, char) === readingOf(candidate, char),
  );
}

function isLookalike(
  left: string,
  right: string,
  similar: Record<string, string[]>,
): boolean {
  return (
    left !== right &&
    (similar[left]?.includes(right) || similar[right]?.includes(left))
  );
}

function lookalikeRank(
  source: string[],
  target: string[],
  similar: Record<string, string[]>,
): number {
  if (
    source.length === target.length &&
    source.every((char, index) => isLookalike(char, target[index], similar))
  )
    return 0;
  if (
    source.some((char) =>
      target.some((other) => isLookalike(char, other, similar)),
    )
  )
    return 1;
  return -1;
}

export function relatedGroups(
  selected: Word,
  words: Word[],
  similar: Record<string, string[]>,
): Groups {
  const groups: Groups = {
    same: [],
    lookalikes: [],
    sameReading: [],
    similarReading: [],
  };
  const selectedKanji = kanjiOf(selected);
  const lookRanks = new Map<string, number>();
  for (const candidate of words) {
    if (candidate.wordId === selected.wordId) continue;
    const candidateKanji = kanjiOf(candidate);
    if (selectedKanji.some((char) => candidateKanji.includes(char)))
      groups.same.push(candidate);
    const rank = lookalikeRank(selectedKanji, candidateKanji, similar);
    if (rank >= 0) {
      groups.lookalikes.push(candidate);
      lookRanks.set(candidate.wordId, rank);
    }
    if (
      candidate.reading === selected.reading &&
      candidate.spelling !== selected.spelling &&
      (candidate.translations.length !== selected.translations.length ||
        candidate.translations.some(
          (translation) => !selected.translations.includes(translation),
        ))
    )
      groups.sameReading.push(candidate);
    if (
      candidate.reading !== selected.reading &&
      normalizedReading(candidate.reading) ===
        normalizedReading(selected.reading)
    )
      groups.similarReading.push(candidate);
  }
  groups.same.sort(
    (left, right) =>
      sameRank(selected, left) - sameRank(selected, right) ||
      Number(matchingReading(selected, right)) -
        Number(matchingReading(selected, left)) ||
      left.spelling.localeCompare(right.spelling, "ja"),
  );
  groups.lookalikes.sort(
    (left, right) =>
      (lookRanks.get(left.wordId) ?? 1) - (lookRanks.get(right.wordId) ?? 1) ||
      left.spelling.localeCompare(right.spelling, "ja"),
  );
  return groups;
}

export function uniqueGroups(groups: Groups): Groups {
  const seen = new Set<string>();
  const result: Groups = {
    same: [],
    lookalikes: [],
    sameReading: [],
    similarReading: [],
  };
  for (const group of groupOrder) {
    result[group] = groups[group].filter((word) => {
      if (seen.has(word.wordId)) return false;
      seen.add(word.wordId);
      return true;
    });
  }
  return result;
}

export function rubyParts(word: Pick<Word, "spelling" | "ruby">): RubyPart[] {
  return word.ruby ?? [...word.spelling].map((text) => ({ text }));
}
