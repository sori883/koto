#!/usr/bin/env bun
// Manage koto Knowledge under <project-root>/.space/kb/.
// Each entry is an OKF v0.2 markdown file and is the source of truth.
// This script creates entries, searches them, matches code_refs, builds
// index.md, checks the bundle, and answers Claude Code hooks.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const USAGE = `Usage:
  knowledge.ts new      <project-root> <decision|constraint|reference> <slug> <title> --description <text>
                        [--tags <a,b>] [--code-refs <path,glob>] [--source <path-or-url>]... [--resource <url>]
                        [--review-when <text>] [--status <draft|stable>] [--by <actor>]
  knowledge.ts list     <project-root> [--type <type>] [--tag <tag>] [--status <status>] [--query <text>]
  knowledge.ts for-path <project-root> <path>
  knowledge.ts index    <project-root>
  knowledge.ts check    <project-root>
  knowledge.ts hook     <session-start|subagent-start|pre-tool-use>   (reads the hook input JSON on stdin)`;

export class KnowledgeError extends Error {}

export const KINDS = {
  decision: { type: "Decision", folder: "decisions", label: "判断", headings: ["結論", "理由", "見送った案"] },
  constraint: { type: "Constraint", folder: "constraints", label: "制約", headings: ["制約", "出所", "守り方", "本当はどうしたいか"] },
  reference: { type: "Reference", folder: "documents", label: "参照", headings: ["要点", "読む場面", "開き方", "目次"] },
} as const;
export type Kind = keyof typeof KINDS;
export const STATUSES = ["draft", "stable", "deprecated"] as const;
export type Status = (typeof STATUSES)[number];

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Above this many entries, hooks print a summary instead of the whole index. */
export const INDEX_LIMIT = 100;
/** Upper bound for the text one PreToolUse hook adds to the context. */
const HOOK_TEXT_LIMIT = 20_000;

// ---------------------------------------------------------------------------
// A small YAML subset: scalars, quoted strings, flow lists and flow maps, and
// block lists whose items are scalars or flow maps. That covers every value
// this script writes and the OKF fields koto uses.

export type Value = string | Value[] | { [key: string]: Value };

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      current += c;
      if (c === "\\" && quote === '"') current += text[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += c;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim());
}

function keyValue(text: string): [string, string] | null {
  const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(?:\s+|$)(.*)$/s.exec(text.trim());
  return match ? [match[1]!, match[2]!] : null;
}

export function parseValue(raw: string): Value {
  const text = raw.trim();
  if (text.startsWith('"')) {
    try {
      return JSON.parse(text) as string;
    } catch {
      throw new KnowledgeError(`bad double-quoted string: ${text}`);
    }
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) throw new KnowledgeError(`bad single-quoted string: ${text}`);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) throw new KnowledgeError(`unclosed list: ${text}`);
    return splitTopLevel(text.slice(1, -1)).map(parseValue);
  }
  if (text.startsWith("{")) {
    if (!text.endsWith("}")) throw new KnowledgeError(`unclosed map: ${text}`);
    const map: { [key: string]: Value } = {};
    for (const part of splitTopLevel(text.slice(1, -1))) {
      const pair = keyValue(part);
      if (!pair) throw new KnowledgeError(`bad map entry: ${part}`);
      map[pair[0]] = parseValue(pair[1]);
    }
    return map;
  }
  return text.replace(/\s+#.*$/, "");
}

export type Entry = {
  /** Path relative to .space/kb/, with forward slashes. */
  path: string;
  meta: { [key: string]: Value };
  body: string;
  raw: string;
};

export function parseEntry(text: string, path: string): Entry {
  const fail = (why: string): never => {
    throw new KnowledgeError(`${path}: ${why}`);
  };
  if (!text.startsWith("---\n")) fail("frontmatter must start with a '---' line");
  const end = text.indexOf("\n---", 3);
  if (end < 0 || (text[end + 4] !== "\n" && end + 4 !== text.length)) fail("frontmatter has no closing '---' line");
  const meta: { [key: string]: Value } = {};
  let listKey: string | null = null;
  for (const line of text.slice(4, end).split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (meta[listKey] as Value[]).push(parseValue(item[1]!));
      continue;
    }
    if (/^\s/.test(line)) fail(`unsupported indented line: ${line.trim()}`);
    const pair = keyValue(line);
    if (!pair) fail(`frontmatter line is not 'key: value': ${line}`);
    const [key, value] = pair!;
    if (key in meta) fail(`duplicate frontmatter key '${key}'`);
    if (value.trim() === "") {
      meta[key] = [];
      listKey = key;
    } else {
      meta[key] = parseValue(value);
      listKey = null;
    }
  }
  return { path, meta, body: text.slice(text.indexOf("\n", end + 1) + 1 || text.length), raw: text };
}

const str = (value: Value | undefined): string => (typeof value === "string" ? value : "");
const strings = (value: Value | undefined): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : typeof value === "string" && value ? [value] : [];

export const typeOf = (entry: Entry) => str(entry.meta.type);
export const statusOf = (entry: Entry): string => str(entry.meta.status) || "stable";
export const codeRefsOf = (entry: Entry) => strings(entry.meta.code_refs);

// ---------------------------------------------------------------------------
// Files

function isPlainDirectory(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

export function kbDir(root: string): string {
  if (!isPlainDirectory(root)) throw new KnowledgeError(`not a directory: ${root}`);
  const dir = join(root, ".space", "kb");
  if (!existsSync(dir)) throw new KnowledgeError(`missing ${dir}. Run the setup skill first.`);
  if (!isPlainDirectory(dir)) throw new KnowledgeError(`not a plain directory: ${dir}`);
  return dir;
}

/** Read every entry in the type folders. A broken file stops the command. */
export function loadEntries(dir: string): Entry[] {
  const entries: Entry[] = [];
  for (const kind of Object.values(KINDS)) {
    const folder = join(dir, kind.folder);
    if (!isPlainDirectory(folder)) continue;
    for (const name of readdirSync(folder).sort()) {
      if (!name.endsWith(".md") || name === "index.md" || name === "log.md") continue;
      const path = `${kind.folder}/${name}`;
      entries.push(parseEntry(readFileSync(join(dir, path), "utf8"), path));
    }
  }
  return entries;
}

function writeAtomically(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

const timestamp = (now: Date) => now.toISOString().replace(/\.\d{3}Z$/, "Z");

function oneLine(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

/** Quote a scalar when plain YAML would misread it. */
export function scalar(value: string): string {
  return /^[^\s"'#\[\]{},:&*!|>%@`-][^#:\[\]{},]*$/.test(value) && !/\s$/.test(value) ? value : JSON.stringify(value);
}

const list = (values: string[]) => `[${values.map(scalar).join(", ")}]`;

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRef(ref: string): string {
  const clean = ref.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  if (!clean || isAbsolute(clean) || clean.split("/").includes("..") || clean.includes("\\")) {
    throw new KnowledgeError(`code_refs must be paths or globs relative to the project root: '${ref}'`);
  }
  return clean;
}

export type NewOptions = {
  description: string;
  tags?: string[];
  codeRefs?: string[];
  sources?: string[];
  resource?: string;
  reviewWhen?: string;
  status?: Status;
  by?: string;
  now?: Date;
};

export function createEntry(root: string, kindName: string, slug: string, title: string, options: NewOptions): string {
  const dir = kbDir(root);
  if (!(kindName in KINDS)) throw new KnowledgeError(`unknown type '${kindName}'. Use one of: ${Object.keys(KINDS).join(", ")}`);
  const kind = KINDS[kindName as Kind];
  if (!SLUG_PATTERN.test(slug)) {
    throw new KnowledgeError(`invalid slug '${slug}'. Use 1-64 lowercase English letters, digits or hyphens, starting with a letter or digit.`);
  }
  const cleanTitle = oneLine(title);
  const description = oneLine(options.description ?? "");
  if (!cleanTitle) throw new KnowledgeError("title is empty");
  if (!description) throw new KnowledgeError("--description is required");
  const status = options.status ?? "draft";
  if (status !== "draft" && status !== "stable") throw new KnowledgeError("a new entry is draft or stable");
  if (options.resource && kindName !== "reference") throw new KnowledgeError("--resource is only for reference");
  if (options.codeRefs?.length && kindName === "reference") throw new KnowledgeError("--code-refs is for decision and constraint");

  const folder = join(dir, kind.folder);
  const file = join(folder, `${slug}.md`);
  if (existsSync(file)) throw new KnowledgeError(`entry already exists: ${file}`);
  const codeRefs = (options.codeRefs ?? []).map(normalizeRef);
  const now = timestamp(options.now ?? new Date());
  const by = oneLine(options.by ?? "") || "claude-code";

  const lines = ["---", `type: ${kind.type}`, `title: ${scalar(cleanTitle)}`, `description: ${scalar(description)}`];
  if (options.tags?.length) lines.push(`tags: ${list(options.tags)}`);
  lines.push(`status: ${status}`);
  lines.push(`generated: { by: ${scalar(by)}, at: ${now} }`);
  if (status === "stable" && by.startsWith("human:")) lines.push(`verified: [{ by: ${scalar(by)}, at: ${now} }]`);
  if (options.resource) lines.push(`resource: ${scalar(options.resource)}`);
  if (options.sources?.length) {
    lines.push("sources:");
    for (const source of options.sources) lines.push(`  - { resource: ${scalar(source)} }`);
  }
  if (codeRefs.length) lines.push(`code_refs: ${list(codeRefs)}`);
  if (options.reviewWhen) lines.push(`review_when: ${scalar(oneLine(options.reviewWhen))}`);
  lines.push("---", "", `# ${cleanTitle}`, "");
  for (const heading of kind.headings) lines.push(`## ${heading}`, "");

  mkdirSync(folder, { recursive: true });
  writeFileSync(file, lines.join("\n").replace(/\n+$/, "\n"), { flag: "wx" });
  buildIndex(root);
  return file;
}

// ---------------------------------------------------------------------------
// Search and code_refs

export function listEntries(
  root: string,
  filters: { type?: string; tag?: string; status?: string; query?: string } = {},
): Entry[] {
  const wantedType = filters.type ? (KINDS[filters.type as Kind]?.type ?? filters.type) : undefined;
  const query = filters.query?.toLowerCase();
  return loadEntries(kbDir(root)).filter((entry) => {
    if (wantedType && typeOf(entry).toLowerCase() !== wantedType.toLowerCase()) return false;
    if (filters.tag && !strings(entry.meta.tags).includes(filters.tag)) return false;
    if (filters.status && statusOf(entry) !== filters.status) return false;
    if (query && !entry.raw.toLowerCase().includes(query)) return false;
    return true;
  });
}

export function matchCodeRef(ref: string, target: string): boolean {
  const clean = normalizeRef(ref);
  if (/[*?[{]/.test(clean)) return new Bun.Glob(clean).match(target);
  return target === clean || target.startsWith(`${clean}/`);
}

/** Relative path inside root with forward slashes, or null when outside. */
export function projectPath(root: string, path: string): string | null {
  const rel = relative(resolve(root), resolve(root, path));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/** Decisions and constraints in effect for a path. Deprecated entries are left out. */
export function entriesForPath(root: string, path: string): Entry[] {
  const target = projectPath(root, path);
  if (!target) throw new KnowledgeError(`path is outside the project root: ${path}`);
  return loadEntries(kbDir(root)).filter(
    (entry) => statusOf(entry) !== "deprecated" && codeRefsOf(entry).some((ref) => matchCodeRef(ref, target)),
  );
}

// ---------------------------------------------------------------------------
// index.md

export function renderIndex(entries: Entry[]): string {
  const lines = ["このファイルは knowledge.ts index で作り直す。手で編集しない。", ""];
  for (const kind of Object.values(KINDS)) {
    const items = entries.filter((entry) => typeOf(entry) === kind.type && statusOf(entry) !== "deprecated");
    lines.push(`# ${kind.label}（${kind.type}）`, "");
    if (!items.length) lines.push("（なし）");
    for (const entry of items) {
      const mark = statusOf(entry) === "draft" ? "（未確認）" : "";
      lines.push(`* [${str(entry.meta.title) || entry.path}](${entry.path}) - ${mark}${str(entry.meta.description)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function buildIndex(root: string): string {
  const dir = kbDir(root);
  const file = join(dir, "index.md");
  writeAtomically(file, renderIndex(loadEntries(dir)));
  return file;
}

// ---------------------------------------------------------------------------
// check

export type Finding = { level: "error" | "warn" | "info"; path: string; message: string };

function refExists(root: string, ref: string): boolean {
  if (!/[*?[{]/.test(ref)) return existsSync(join(root, ref));
  for (const _ of new Bun.Glob(ref).scanSync({ cwd: root, onlyFiles: false, dot: true })) return true;
  return false;
}

export function checkBundle(root: string, now = new Date()): Finding[] {
  const dir = kbDir(root);
  const findings: Finding[] = [];
  const types = new Map<string, string>(Object.values(KINDS).map((kind) => [kind.folder, kind.type]));
  for (const kind of Object.values(KINDS)) {
    const folder = join(dir, kind.folder);
    if (!isPlainDirectory(folder)) continue;
    for (const name of readdirSync(folder).sort()) {
      if (!name.endsWith(".md")) continue;
      const path = `${kind.folder}/${name}`;
      let entry: Entry;
      try {
        entry = parseEntry(readFileSync(join(dir, path), "utf8"), path);
      } catch (error) {
        findings.push({ level: "error", path, message: (error as Error).message.replace(`${path}: `, "") });
        continue;
      }
      const add = (level: Finding["level"], message: string) => findings.push({ level, path, message });
      const type = typeOf(entry);
      if (!type) add("error", "missing type");
      else if (type !== types.get(kind.folder)) add("error", `type '${type}' does not belong in ${kind.folder}/`);
      if (!SLUG_PATTERN.test(name.slice(0, -3))) add("warn", "file name is not a lowercase English slug");
      if (!str(entry.meta.title)) add("warn", "missing title");
      if (!str(entry.meta.description)) add("warn", "missing description");
      const status = statusOf(entry);
      if (!(STATUSES as readonly string[]).includes(status)) add("error", `unknown status '${status}'`);
      if (status === "draft") add("info", "draft: waiting for a person to confirm");
      if (status === "deprecated") continue;
      for (const ref of codeRefsOf(entry)) {
        try {
          if (!refExists(root, normalizeRef(ref))) add("warn", `code_refs points to nothing: ${ref}`);
        } catch (error) {
          add("error", (error as Error).message);
        }
      }
      const staleAfter = str(entry.meta.stale_after);
      if (staleAfter) {
        const at = Date.parse(staleAfter);
        if (Number.isNaN(at)) add("error", `stale_after is not a date: ${staleAfter}`);
        else if (at <= now.getTime()) add("warn", `stale since ${staleAfter}`);
      }
      if (str(entry.meta.review_when)) add("info", `review when: ${str(entry.meta.review_when)}`);
      for (const match of entry.body.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = match[1]!.split("#")[0]!;
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
        const file = target.startsWith("/") ? join(dir, target) : join(dir, dirname(path), target);
        if (!existsSync(file)) add("warn", `broken link: ${match[1]}`);
      }
    }
  }
  const index = join(dir, "index.md");
  if (!existsSync(index)) findings.push({ level: "warn", path: "index.md", message: "missing. Run knowledge.ts index" });
  else if (readFileSync(index, "utf8") !== renderIndex(loadEntriesQuietly(dir))) {
    findings.push({ level: "warn", path: "index.md", message: "out of date. Run knowledge.ts index" });
  }
  return findings;
}

function loadEntriesQuietly(dir: string): Entry[] {
  try {
    return loadEntries(dir);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Hooks

/** Walk up from start to the nearest folder that has .space/kb/. */
export function findRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (isPlainDirectory(join(current, ".space", "kb"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function indexContext(root: string): string | null {
  const file = join(root, ".space", "kb", "index.md");
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const count = (text.match(/^\* \[/gm) ?? []).length;
  if (count === 0) return null;
  const head =
    "このプロジェクトのKnowledge（.space/kb/）の目次です。指摘や変更の提案の前に、触る箇所の判断・制約を確かめてください。（未確認）は、まだ人が確かめていない1件です。";
  if (count <= INDEX_LIMIT) return `${head}\n\n${text}`;
  const counts = Object.values(KINDS).map((kind) => {
    const section = text.split(/^# /m).find((part) => part.startsWith(`${kind.label}（`)) ?? "";
    return `${kind.label} ${(section.match(/^\* \[/gm) ?? []).length}件`;
  });
  return `このプロジェクトにはKnowledge（.space/kb/）が${count}件あります（${counts.join("、")}）。目次は長いので読み込んでいません。必要なときは knowledge スキルで探してください。`;
}

export function pathContext(root: string, file: string): string | null {
  const target = projectPath(root, file);
  if (!target || target.startsWith(".space/")) return null;
  const entries = entriesForPath(root, target);
  if (!entries.length) return null;
  let text = `これから編集する ${target} には、Knowledge（.space/kb/）の次の判断・制約が結びついています。従ってください。変える必要があるなら、編集の前に利用者に確かめてください。\n`;
  for (const entry of entries) {
    const block = `\n--- .space/kb/${entry.path} ---\n${entry.raw.trim()}\n`;
    if (text.length + block.length > HOOK_TEXT_LIMIT) {
      text += `\n（ほかにも結びついた1件があります。knowledge.ts for-path で確かめてください。）\n`;
      break;
    }
    text += block;
  }
  return text;
}

export function hookOutput(event: string, input: { cwd?: string; tool_input?: { file_path?: string; notebook_path?: string } }): object | null {
  const cwd = input.cwd || process.cwd();
  if (event === "session-start" || event === "subagent-start") {
    const root = findRoot(cwd);
    const context = root ? indexContext(root) : null;
    if (!context) return null;
    return { hookSpecificOutput: { hookEventName: event === "session-start" ? "SessionStart" : "SubagentStart", additionalContext: context } };
  }
  if (event === "pre-tool-use") {
    const path = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (!path) return null;
    const absolute = resolve(cwd, path);
    const root = findRoot(dirname(absolute));
    const context = root ? pathContext(root, absolute) : null;
    if (!context) return null;
    return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: context } };
  }
  throw new KnowledgeError(`unknown hook '${event}'`);
}

// ---------------------------------------------------------------------------
// CLI

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  const options = {
    description: { type: "string" },
    tags: { type: "string" },
    "code-refs": { type: "string" },
    source: { type: "string", multiple: true },
    resource: { type: "string" },
    "review-when": { type: "string" },
    status: { type: "string" },
    by: { type: "string" },
    type: { type: "string" },
    tag: { type: "string" },
    query: { type: "string" },
  } as const;
  const { values, positionals } = parseArgs({ args: rest, options, allowPositionals: true });
  const need = (count: number) => {
    if (positionals.length !== count) throw new KnowledgeError(USAGE);
  };
  switch (command) {
    case "new": {
      need(4);
      const [root, kind, slug, title] = positionals as [string, string, string, string];
      const status = values.status as Status | undefined;
      console.log(
        createEntry(resolve(root), kind, slug, title, {
          description: values.description ?? "",
          tags: csv(values.tags),
          codeRefs: csv(values["code-refs"]),
          sources: values.source,
          resource: values.resource,
          reviewWhen: values["review-when"],
          status,
          by: values.by,
        }),
      );
      return;
    }
    case "list": {
      need(1);
      for (const entry of listEntries(resolve(positionals[0]!), values)) {
        console.log([`.space/kb/${entry.path}`, typeOf(entry), statusOf(entry), str(entry.meta.title), str(entry.meta.description)].join("\t"));
      }
      return;
    }
    case "for-path": {
      need(2);
      const root = resolve(positionals[0]!);
      for (const entry of entriesForPath(root, resolve(root, positionals[1]!))) {
        console.log(`--- .space/kb/${entry.path} ---\n${entry.raw.trim()}\n`);
      }
      return;
    }
    case "index": {
      need(1);
      console.log(buildIndex(resolve(positionals[0]!)));
      return;
    }
    case "check": {
      need(1);
      const findings = checkBundle(resolve(positionals[0]!));
      for (const { level, path, message } of findings) console.log(`${level}\t.space/kb/${path}\t${message}`);
      if (findings.some((finding) => finding.level === "error")) process.exit(1);
      return;
    }
    case "hook": {
      need(1);
      let input = {};
      try {
        const text = readFileSync(0, "utf8");
        input = text.trim() ? JSON.parse(text) : {};
      } catch {
        throw new KnowledgeError("hook input on stdin is not JSON");
      }
      const output = hookOutput(positionals[0]!, input);
      if (output) console.log(JSON.stringify(output));
      return;
    }
    default:
      throw new KnowledgeError(USAGE);
  }
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof KnowledgeError)) throw error;
    console.error(`error: ${error.message}`);
    process.exit(2);
  }
}
