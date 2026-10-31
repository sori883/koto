export const conceptTypes = ["rule", "principle", "knowledge", "procedure", "decision"] as const;
export const governanceValues = ["context", "constraint", "hold"] as const;
const fields = ["title", "tags", "description", "id", "body"] as const;
const weights = { title: 4, tags: 3.5, description: 2.5, id: 2, body: 1 };
const particles = new Set(["の", "は", "が", "を", "に", "へ", "と", "で", "も", "や"]);
const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
const governanceRank = { hold: 0, constraint: 1, context: 2 };
const maxQueryCharacters = 1000;
const maxQueryTerms = 50;
const prefixWeight = 0.7;
const k1 = 1.2;
const b = 0.75;

export type ConceptType = (typeof conceptTypes)[number];
export type Governance = (typeof governanceValues)[number];
export type SearchField = (typeof fields)[number];

export interface SearchDocument {
  readonly id: string;
  readonly type: ConceptType;
  readonly title: string;
  readonly description: string;
  readonly body: string;
  readonly tags?: readonly string[];
  readonly governance?: Governance;
}

export interface SearchOptions {
  readonly type?: ConceptType;
  readonly limit?: number;
  readonly all?: boolean;
}

export interface SearchResult {
  concept_id: string;
  type: ConceptType;
  title: string;
  description: string;
  governance: Governance;
  score: number;
  matched_on: (SearchField | "type" | "filter")[];
  tags?: string[];
}

export interface SearchIndex {
  search(query: string, options?: SearchOptions): SearchResult[];
}

interface IndexedDocument {
  document: SearchDocument;
  lengths: Record<SearchField, number>;
}

interface Posting {
  documentIndex: number;
  frequency: number;
}

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function* tokenize(text: string): Generator<string> {
  for (const chunk of text.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{M}\p{Nd}]+/u)) {
    for (const word of segmenter.segment(chunk)) {
      if (word.isWordLike && !particles.has(word.segment)) yield word.segment;
    }
  }
}

function queryTerms(query: string): string[] {
  let bounded = "";
  let characters = 0;
  for (const character of query) {
    if (characters++ === maxQueryCharacters) break;
    bounded += character;
  }
  const terms = new Set<string>();
  let count = 0;
  for (const term of tokenize(bounded)) {
    if (count++ === maxQueryTerms) break;
    terms.add(term);
  }
  return [...terms].sort(compare);
}

function lowerBound(vocabulary: readonly string[], prefix: string): number {
  let low = 0;
  let high = vocabulary.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (vocabulary[middle]! < prefix) low = middle + 1;
    else high = middle;
  }
  return low;
}

function snapshot(document: SearchDocument): SearchDocument {
  for (const field of ["id", "title", "description", "body"] as const) {
    if (typeof document[field] !== "string" || (field !== "body" && !document[field].trim())) {
      throw new TypeError(`Search document ${field} must be ${field === "body" ? "a string" : "a nonempty string"}.`);
    }
  }
  if (!conceptTypes.includes(document.type)) throw new TypeError("Unknown search document type.");
  if (document.governance !== undefined && !governanceValues.includes(document.governance)) {
    throw new TypeError("Unknown search document governance.");
  }
  if (document.tags !== undefined && (!Array.isArray(document.tags)
    || document.tags.some(tag => typeof tag !== "string" || !tag.trim()))) {
    throw new TypeError("Search document tags must be an array of nonempty strings.");
  }
  return {
    id: document.id, type: document.type, title: document.title,
    description: document.description, body: document.body,
    governance: document.governance ?? "context",
    ...(document.tags === undefined ? {} : { tags: [...document.tags] }),
  };
}

export function resultLimit(options: SearchOptions): number {
  if (options.type !== undefined && !conceptTypes.includes(options.type)) throw new TypeError("Unknown search type.");
  if (options.all !== undefined && typeof options.all !== "boolean") throw new TypeError("all must be a boolean.");
  if (options.all && options.limit !== undefined) throw new TypeError("all and limit cannot be combined.");
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1)) {
    throw new RangeError("limit must be a positive integer.");
  }
  return options.all ? Infinity : Math.min(options.limit ?? 10, 100);
}

function result(document: SearchDocument, score: number, matched: (SearchField | "type")[]): SearchResult {
  return {
    concept_id: document.id, type: document.type, title: document.title,
    description: document.description, governance: document.governance ?? "context",
    score: Math.round(score * 100) / 100, matched_on: matched,
    ...(document.tags === undefined ? {} : { tags: [...document.tags] }),
  };
}

export function createSearchIndex(input: readonly SearchDocument[]): SearchIndex {
  const documents = input.map(snapshot).sort((left, right) => compare(left.id, right.id));
  const seen = new Set<string>();
  const postings = new Map<string, Map<SearchField, Posting[]>>();
  const averages: Record<SearchField, number> = { title: 0, tags: 0, description: 0, id: 0, body: 0 };
  const indexed: IndexedDocument[] = documents.map((document, documentIndex) => {
    if (seen.has(document.id)) throw new TypeError(`Duplicate concept ID: ${document.id}`);
    seen.add(document.id);
    const lengths: Record<SearchField, number> = { title: 0, tags: 0, description: 0, id: 0, body: 0 };
    for (const field of fields) {
      const frequencies = new Map<string, number>();
      const text = field === "tags" ? (document.tags ?? []).join(" ") : document[field];
      for (const term of tokenize(text)) {
        frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
        lengths[field]++;
      }
      averages[field] += lengths[field];
      for (const [term, frequency] of frequencies) {
        let byField = postings.get(term);
        if (!byField) postings.set(term, byField = new Map());
        let entries = byField.get(field);
        if (!entries) byField.set(field, entries = []);
        entries.push({ documentIndex, frequency });
      }
    }
    return { document, lengths };
  });
  for (const field of fields) averages[field] /= Math.max(documents.length, 1);
  const vocabulary = [...postings.keys()].sort(compare);

  return Object.freeze({
    search(query: string, options: SearchOptions = {}): SearchResult[] {
      if (typeof query !== "string") throw new TypeError("query must be a string.");
      const limit = resultLimit(options);
      if (!query.trim() && options.type !== undefined) {
        return documents.filter(document => document.type === options.type)
          .sort((left, right) => governanceRank[left.governance ?? "context"] - governanceRank[right.governance ?? "context"]
            || compare(left.id, right.id))
          .slice(0, limit).map(document => result(document, 0, ["type"]));
      }

      const expanded = new Map<string, number>();
      for (const term of queryTerms(query)) {
        for (let i = lowerBound(vocabulary, term); i < vocabulary.length; i++) {
          const match = vocabulary[i]!;
          if (!match.startsWith(term)) break;
          expanded.set(match, Math.max(expanded.get(match) ?? 0, match === term ? 1 : prefixWeight));
        }
      }
      const candidates = new Map<number, { score: number; fields: Set<SearchField> }>();
      for (const [term, multiplier] of [...expanded].sort(([left], [right]) => compare(left, right))) {
        for (const [field, entries] of postings.get(term)!) {
          const idf = Math.log(1 + (documents.length - entries.length + 0.5) / (entries.length + 0.5));
          for (const entry of entries) {
            const { document, lengths } = indexed[entry.documentIndex]!;
            if (options.type !== undefined && document.type !== options.type) continue;
            const tf = entry.frequency * (k1 + 1)
              / (entry.frequency + k1 * (1 - b + b * lengths[field] / averages[field]));
            let candidate = candidates.get(entry.documentIndex);
            if (!candidate) candidates.set(entry.documentIndex, candidate = { score: 0, fields: new Set() });
            candidate.score += weights[field] * idf * tf * multiplier;
            candidate.fields.add(field);
          }
        }
      }
      return [...candidates].sort(([leftIndex, left], [rightIndex, right]) => right.score - left.score
        || compare(documents[leftIndex]!.id, documents[rightIndex]!.id))
        .slice(0, limit).map(([documentIndex, candidate]) => {
          const matched: (SearchField | "type")[] = fields.filter(field => candidate.fields.has(field));
          if (options.type !== undefined) matched.push("type");
          return result(documents[documentIndex]!, candidate.score, matched);
        });
    },
  });
}
