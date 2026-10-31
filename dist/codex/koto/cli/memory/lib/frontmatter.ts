import { YAML } from "bun";
import { conceptTypes, governanceValues, type SearchDocument } from "./search.ts";

export type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
export type Metadata = Record<string, JsonValue>;
export interface Document { metadata: Metadata; body: string }
export interface Concept extends Document { id: string; path: string; raw_content: string }

export const typeDirectories = {
  rule: "rules", principle: "principles", knowledge: "knowledge", procedure: "procedures", decision: "decisions",
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseMetadata(raw: string): Metadata {
  const parsed: unknown = YAML.parse(raw);
  if (!record(parsed)) throw new Error("Frontmatter must be a YAML mapping.");
  let nodes = 0;
  const ancestors = new Set<object>();
  function json(value: unknown, depth: number): JsonValue {
    if (++nodes > 100_000 || depth > 64) throw new Error("Frontmatter exceeds the size or nesting limit.");
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || value === null) throw new Error("Frontmatter requires JSON-compatible values.");
    if (ancestors.has(value)) throw new Error("Cyclic YAML aliases are not supported.");
    ancestors.add(value);
    const result = Array.isArray(value)
      ? value.map(child => json(child, depth + 1))
      : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, json(child, depth + 1)]));
    ancestors.delete(value);
    return result;
  }
  const metadata = json(parsed, 0);
  if (!record(metadata)) throw new Error("Frontmatter must be a YAML mapping.");
  return metadata;
}

export function parseDocument(raw: string): Document {
  const opening = /^\uFEFF?---[\t ]*\r?\n/.exec(raw);
  if (!opening) throw new Error("Missing frontmatter opening delimiter.");
  const rest = raw.slice(opening[0].length);
  const closing = /^---[\t ]*(?:\r?\n|$)/m.exec(rest);
  if (!closing) throw new Error("Missing frontmatter closing delimiter.");
  return { metadata: parseMetadata(rest.slice(0, closing.index)), body: rest.slice(closing.index + closing[0].length) };
}

export function serializeDocument(document: Document): string {
  return `---\n${YAML.stringify(document.metadata, null, 2).trimEnd()}\n---\n${document.body}`;
}

export function validActor(value: string): boolean {
  return /^(?:[a-zA-Z][\w.-]*:\S+|[^\s/]+\/[^\s/]+)$/.test(value);
}

export function timestamp(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return false;
  const [, y, m, d, h, min, s, zone] = parts;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return days !== undefined && day >= 1 && day <= days && Number(h) < 24 && Number(min) < 60
    && Number(s) < 60 && zone !== undefined
    && (zone === "Z" || (Number(zone.slice(1, 3)) < 24 && Number(zone.slice(4)) < 60))
    && Number.isFinite(Date.parse(value));
}

export function searchDocument(concept: Concept): SearchDocument {
  const m = concept.metadata;
  const type = conceptTypes.find(value => value === m.type);
  if (!type) throw new Error("type: expected rule, principle, knowledge, procedure or decision.");
  if (concept.id.split("/")[0] !== typeDirectories[type]) throw new Error("type does not match the ID directory.");
  if (!nonempty(m.title) || /[\r\n]/.test(m.title)) throw new Error("title: expected a nonempty single-line string.");
  if (!nonempty(m.description) || /[\r\n]/.test(m.description)) throw new Error("description: expected a nonempty single-line string.");
  const governance = m.governance === undefined ? "context" : governanceValues.find(value => value === m.governance);
  if (!governance) throw new Error("governance: expected hold, constraint or context.");
  if (m.status !== undefined && !["draft", "stable", "deprecated"].some(value => value === m.status)) {
    throw new Error("status: expected draft, stable or deprecated.");
  }
  if (m.resource !== undefined && !nonempty(m.resource)) throw new Error("resource: expected a nonempty string.");
  function strings(field: string): string[] | undefined {
    const value = m[field];
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || !value.every(nonempty) || new Set(value).size !== value.length) {
      throw new Error(`${field}: expected unique, nonempty strings.`);
    }
    return value;
  }
  const tags = strings("tags");
  const refs = strings("code_refs");
  if (refs?.some(ref => ref.startsWith("/") || /^[a-zA-Z]:/.test(ref) || ref.includes("\\") || ref.split("/").includes("..") || /[\u0000-\u001f\u007f]/.test(ref))) {
    throw new Error("code_refs: expected relative paths/globs without '..' or backslashes.");
  }
  function event(value: JsonValue, field: string, human: boolean): void {
    if (!record(value) || typeof value.by !== "string" || !timestamp(value.at)
      || !(human ? /^human:\S+$/ : /^(?:[a-zA-Z][\w.-]*:\S+|[^\s/]+\/[^\s/]+)$/).test(value.by)) {
      throw new Error(`${field}: expected {by, at} with ${human ? "a human:<id> reviewer" : "an actor"} and a timezone timestamp.`);
    }
  }
  if (m.generated !== undefined) event(m.generated, "generated", false);
  if (m.verified !== undefined) {
    if (!Array.isArray(m.verified)) throw new Error("verified: expected an array.");
    m.verified.forEach((value, i) => event(value, `verified[${i}]`, true));
  }
  if (m.stale_after !== undefined && !timestamp(m.stale_after)) throw new Error("stale_after: expected a timezone timestamp.");
  if (m.sources !== undefined) {
    if (!Array.isArray(m.sources)) throw new Error("sources: expected an array.");
    const ids = new Set<string>();
    for (const source of m.sources) {
      if (!record(source) || !nonempty(source.resource)) throw new Error("sources: each entry needs resource.");
      for (const key of ["id", "title", "author"]) {
        if (source[key] !== undefined && !nonempty(source[key])) throw new Error(`sources.${key}: expected a nonempty string.`);
      }
      if (typeof source.id === "string") {
        if (ids.has(source.id)) throw new Error("sources.id: duplicate ID.");
        ids.add(source.id);
      }
      if (source.last_modified !== undefined && !timestamp(source.last_modified)) throw new Error("sources.last_modified: expected a timezone timestamp.");
      if (source.usage_count !== undefined && (typeof source.usage_count !== "number" || !Number.isSafeInteger(source.usage_count) || source.usage_count < 0)) {
        throw new Error("sources.usage_count: expected a nonnegative integer.");
      }
    }
  }
  return { id: concept.id, type, title: m.title, description: m.description, body: concept.body, governance,
    ...(tags === undefined ? {} : { tags }) };
}
