import type { IndexEntry } from "./onet/types";

// Career search over O*NET® titles: the occupation title, common titles and alternate titles.
// Token-based (so "nurse" doesn't match "nursery"), with light stemming. When nothing matches
// word for word, a looser pass allows an unfinished last word ("electri") and typos.

const STOPWORDS = new Set(["a", "an", "and", "the", "of", "or", "for", "in", "at", "to", "on", "except", "all"]);

// Everyday words O*NET titles don't use.
const SYNONYMS = new Map([
  ["doctor", "physician"],
  ["dr", "physician"],
  ["cop", "police"],
  ["coder", "programmer"],
  ["dev", "developer"],
]);

export function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.length > 4 && /(ches|shes|xes|sses)$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export function tokenize(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t && !STOPWORDS.has(t))
    .map((t) => stem(SYNONYMS.get(t) ?? t));
}

/** True when a and b differ by at most `max` insertions, deletions or substitutions. */
export function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) return false;
    previous = current;
  }
  return previous[b.length] <= max;
}

/** Typos allowed in a query word: none for short words, one from 5 letters, two from 8. */
const allowedTypos = (word: string) => (word.length >= 8 ? 2 : word.length >= 5 ? 1 : 0);

/** How well one query word matches a title word: 1 exact, 0.8 prefix, 0.7 with typos, 0 none. */
function wordMatch(query: string, word: string, isLast: boolean, loose: boolean): number {
  if (query === word) return 1;
  if (!loose) return 0;
  if (isLast && query.length >= 3 && word.startsWith(query)) return 0.8;
  if (allowedTypos(query) && withinEdits(query, word, allowedTypos(query))) return 0.7;
  return 0;
}

function titleScore(query: string[], title: string[], loose: boolean): number {
  let quality = 0;
  for (let i = 0; i < query.length; i++) {
    let best = 0;
    for (const word of title) {
      best = Math.max(best, wordMatch(query[i], word, i === query.length - 1, loose));
    }
    if (best === 0) return 0;
    quality += best;
  }
  quality /= query.length;
  const coverage = Math.min(1, query.length / title.length);
  const exact = query.length === title.length && query.every((q, i) => q === title[i]);
  return quality * (0.6 + 0.4 * coverage) + (exact ? 0.2 : 0);
}

type Prepared = {
  entry: IndexEntry;
  title: string[];
  titles: { text: string; tokens: string[]; common: boolean }[];
};

export type SearchResult = {
  entry: IndexEntry;
  score: number;
  /** The common or alternate title that matched best, when it isn't the occupation title. */
  matchedTitle: string | null;
};

export function prepareIndex(index: IndexEntry[]): Prepared[] {
  return index.map((entry) => ({
    entry,
    title: tokenize(entry.title),
    titles: entry.titles.map((text, i) => ({ text, tokens: tokenize(text), common: i < entry.commonCount })),
  }));
}

export function searchCareers(prepared: Prepared[], rawQuery: string, limit = 20): SearchResult[] {
  const query = tokenize(rawQuery);
  if (!query.length) return [];
  // The loose pass only runs when nothing matches word for word, so it can't add noise
  // ("lawyer" finding "sawyer", "nurse" finding "nursery") to a search that already works.
  const exact = rank(prepared, query, false);
  return (exact.length ? exact : rank(prepared, query, true)).slice(0, limit);
}

function rank(prepared: Prepared[], query: string[], loose: boolean): SearchResult[] {
  const results: SearchResult[] = [];
  for (const p of prepared) {
    let best = titleScore(query, p.title, loose);
    let matchedTitle: string | null = null;
    let matches = best > 0 ? 1 : 0;
    for (const t of p.titles) {
      const score = titleScore(query, t.tokens, loose) * (t.common ? 0.95 : 0.85);
      if (score === 0) continue;
      matches++;
      if (score > best) {
        best = score;
        matchedTitle = t.text;
      }
    }
    if (best === 0) continue;
    // Words of the query that also appear in the occupation title, and how many of the job's
    // titles match, break ties between occupations that share an alternate title.
    const overlap = query.filter((q) => p.title.includes(q)).length / query.length;
    const score = best + 0.15 * overlap + 0.03 * Math.log2(1 + matches);
    results.push({ entry: p.entry, score, matchedTitle });
  }
  return results.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
}
