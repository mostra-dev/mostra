/**
 * `docs_search` (INTERFACES §12): finds the topics of Mostra's bundled reference that answer a
 * query, with a snippet of each and the resource URI that reads it whole. Scoring is plain and
 * predictable: every query word found in a topic's slug or title counts most, then how often the
 * words appear in its text, guide pages first on a tie.
 */
import type { McpDocs } from "./ports.ts";

/** One hit. */
export interface DocsHit {
  /** The topic's slug. */
  readonly topic: string;
  /** Its title. */
  readonly title: string;
  /** The resource that reads the whole topic: `mostra://docs/<topic>`. */
  readonly uri: string;
  /** The docs site's page. */
  readonly url: string;
  /** The passage that matched best, up to about 400 characters. */
  readonly snippet: string;
}

/** The URI of a topic's resource. */
export function docsUri(topic: string): string {
  return `mostra://docs/${topic}`;
}

/** The words of a query or a text, lowercased; words of one character don't count. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((word) => word.length > 1);
}

/** Splits Markdown into passages: paragraphs, list items and code blocks, kept whole. */
function passages(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block !== "");
}

function clip(text: string, max = 400): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** The best hits for `query`, at most `limit`. */
export function searchDocs(docs: McpDocs, query: string, limit = 5): DocsHit[] {
  const wanted = [...new Set(words(query))];
  if (wanted.length === 0) return [];
  const exact = query.trim().toUpperCase();
  const scored: { hit: DocsHit; score: number; order: number }[] = [];
  for (const [order, topic] of docs.topics().entries()) {
    const text = docs.read(topic.topic) ?? "";
    const head = new Set(words(`${topic.topic} ${topic.title}`));
    const body = words(text);
    const counts = new Map<string, number>();
    for (const word of body) counts.set(word, (counts.get(word) ?? 0) + 1);
    let score = topic.topic.toUpperCase() === exact ? 1000 : 0;
    let matched = 0;
    for (const word of wanted) {
      const inHead = head.has(word);
      const inBody = counts.get(word) ?? 0;
      if (inHead || inBody > 0) matched++;
      score += (inHead ? 20 : 0) + Math.min(inBody, 10);
    }
    if (matched === 0) continue;
    // Topics that have every word come first.
    score += matched === wanted.length ? 50 : 0;
    let best = "";
    let bestScore = -1;
    for (const passage of passages(text)) {
      const own = new Set(words(passage));
      const value = wanted.filter((word) => own.has(word)).length;
      if (value > bestScore) {
        bestScore = value;
        best = passage;
      }
    }
    scored.push({
      hit: {
        topic: topic.topic,
        title: topic.title,
        uri: docsUri(topic.topic),
        url: topic.url,
        snippet: clip(best),
      },
      score,
      order,
    });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.hit);
}
