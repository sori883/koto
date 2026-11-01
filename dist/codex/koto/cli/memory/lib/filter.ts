import type { JsonValue, Metadata } from "./frontmatter.ts";

type Scalar = null | boolean | number | string;
export type MetadataFilter = { path: readonly string[]; operator: "present" } | { path: readonly string[]; operator: "missing" } | { path: readonly string[]; operator: "equal" | "unequal"; value: Scalar };

export function parseFilters(expressions: readonly string[]): MetadataFilter[] {
  if (expressions.length > 50) throw new Error("At most 50 --filter conditions are supported.");
  return expressions.map(expression => {
    if (expression.length > 4096) throw new Error("A --filter condition must not exceed 4096 characters.");
    const input = expression.trim(), comparison = /^(.+?)(!=|=)(.*)$/.exec(input);
    let key: string, operator: MetadataFilter["operator"], raw: string | undefined;
    if (comparison) { key = comparison[1]?.trim() ?? ""; operator = comparison[2] === "=" ? "equal" : "unequal"; raw = comparison[3]?.trim() ?? ""; }
    else if (input.startsWith("!")) { key = input.slice(1); operator = "missing"; }
    else if (input.endsWith("?")) { key = input.slice(0, -1); operator = "present"; }
    else throw new Error(`Invalid --filter '${expression}'; use field=value, field!=value, field? or !field.`);
    if (!/^[\p{L}\p{M}\p{N}_-]+(?:\.[\p{L}\p{M}\p{N}_-]+)*$/u.test(key) || key.split(".").length > 64) throw new Error("Filter fields use dot-separated names containing letters, numbers, '_' or '-'.");
    const path = key.split(".");
    if (operator === "present" || operator === "missing") return { path, operator };
    if (raw === undefined || raw === "") throw new Error('A filter value is required; use field="" for an empty string.');
    let value: Scalar = raw;
    if (/^["[{]/.test(raw) || /^(?:true|false|null)$/.test(raw) || /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { throw new Error(`Invalid JSON scalar in --filter '${expression}'.`); }
      if (parsed !== null && typeof parsed !== "string" && typeof parsed !== "boolean" && (typeof parsed !== "number" || !Number.isFinite(parsed))) throw new Error("Filter values must be strings, finite numbers, booleans or null.");
      value = parsed as Scalar;
    }
    return { path, operator, value };
  });
}

function valuesAt(value: JsonValue, path: readonly string[], index = 0): JsonValue[] {
  if (index === path.length) return [value];
  if (Array.isArray(value)) return value.flatMap(child => valuesAt(child, path, index));
  const key = path[index];
  if (value === null || typeof value !== "object" || key === undefined || !Object.hasOwn(value, key)) return [];
  return valuesAt(value[key]!, path, index + 1);
}

function contains(value: JsonValue, expected: Scalar): boolean {
  return Array.isArray(value) ? value.some(child => contains(child, expected)) : value === expected;
}

export function matchesFilters(metadata: Metadata, filters: readonly MetadataFilter[]): boolean {
  return filters.every(filter => {
    let values = valuesAt(metadata, filter.path);
    if (filter.operator === "present") return values.length > 0;
    if (filter.operator === "missing") return values.length === 0;
    if (!values.length && filter.path.length === 1) {
      if (filter.path[0] === "status") values = ["stable"];
      if (filter.path[0] === "governance") values = ["context"];
    }
    if (!values.length) return false;
    const equal = values.some(value => contains(value, filter.value));
    return filter.operator === "equal" ? equal : !equal;
  });
}
