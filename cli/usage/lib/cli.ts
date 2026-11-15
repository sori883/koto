import { parseArgs } from "node:util";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { configuration, directory, eventNames, projectId, readJSON, recordActivity, setEnabled, uuidPattern, type ActivityEvent, type Component } from "./activity.ts";

const help = `koto-usage — project-local activity
Usage: bun usage.ts <command> --root <repository> [--project <name>] [--json]
  enable | disable
  stats [--component tasks|memory|recall] [--since ISO] [--until ISO]
  list [--component tasks|memory|recall] [--since ISO] [--until ISO] [--limit N | --all]
  record recall --id <uuid-v4> [--task-id ID] [--outcome success|failure]

Recording is disabled until enable. Tasks and Memory record completed CLI calls
automatically while enabled; --no-activity skips a call. Help and usage inspection
are not recorded. Recall is self-reported; reuse the same ID when retrying.
stats/list are read-only, even for an uninitialized project. Time filters apply
to events only. Savepoint counts existing .md files in .space/<project>/savepoint/.
Counts indicate observed use, not effectiveness or complete coverage. See README.md.
`;
const operations = {
  tasks: ["setup", "task add", "task list", "task show", "task update", "task start", "task set", "task complete", "task reopen", "task archive", "dependency add", "dependency remove", "workspace link", "artifact add", "artifact list", "checkpoint save", "checkpoint list", "checkpoint show", "history", "status", "doctor"],
  memory: ["init", "create", "update", "show", "search", "delete", "relate", "validate", "recover"],
  recall: ["run"],
};
function timestamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Use a timezone-qualified ISO timestamp.");
  return Date.parse(value);
}
function validateEvent(value: unknown, project: string, filename: string): ActivityEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid activity event.");
  const e = value as ActivityEvent;
  if (Object.keys(e).some(k => !["schema_version", "id", "at", "project", "component", "operation", "outcome", "task_id", "replayed", "concept_ids"].includes(k)) ||
    e.schema_version !== 1 || typeof e.id !== "string" || !uuidPattern.test(e.id) || `${e.id}.json` !== filename || e.project !== project ||
    !Object.hasOwn(operations, e.component) || !operations[e.component].includes(e.operation) || !["success", "failure"].includes(e.outcome) || typeof e.at !== "string") throw new Error("Invalid activity event.");
  timestamp(e.at);
  if (e.task_id !== undefined) { if (typeof e.task_id !== "string") throw new Error("Invalid task ID."); projectId(e.task_id); }
  if (e.replayed !== undefined && (e.component !== "tasks" || typeof e.replayed !== "boolean")) throw new Error("Invalid replay event.");
  if (e.concept_ids !== undefined && (e.component !== "memory" || !["search", "show"].includes(e.operation) || !Array.isArray(e.concept_ids) || e.concept_ids.some(id => typeof id !== "string" || !id.includes("/") || /[\u0000-\u001f\u007f]/.test(id)) || new Set(e.concept_ids).size !== e.concept_ids.length)) throw new Error("Invalid concept references.");
  if (e.component === "memory" && ["search", "show"].includes(e.operation) && e.outcome === "success" && (!e.concept_ids || e.operation === "show" && e.concept_ids.length !== 1)) throw new Error("Missing retrieval evidence.");
  return e;
}
async function readEvents(root: string, project: string) {
  const { dir, names } = await eventNames(root, project);
  const events: ActivityEvent[] = []; let pending = 0;
  for (const name of names.sort()) {
    if (name.startsWith(".pending-")) { pending++; continue; }
    if (!name.endsWith(".json")) throw new Error("Unexpected file in activity events.");
    try { events.push(validateEvent(await readJSON(join(dir!, name)), project, name)); }
    catch (cause) { throw new Error(`Unreadable or invalid activity event: ${name}`, { cause }); }
  }
  return { events: events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id)), pending };
}
async function savepoints(root: string, project: string) {
  const dir = await directory(root, project, ["savepoint"]);
  let files = 0, skipped_symlinks = 0;
  async function visit(path: string) {
    for (const name of await readdir(path)) {
      const child = join(path, name), info = await lstat(child);
      if (info.isSymbolicLink()) skipped_symlinks++;
      else if (info.isDirectory()) await visit(child);
      else if (info.isFile() && name.endsWith(".md")) files++;
    }
  }
  if (dir) await visit(dir);
  return { files, exists: !!dir, skipped_symlinks, scope: "current_files", path: `.space/${project}/savepoint` };
}
function counts(events: ActivityEvent[]) {
  return { calls: events.length, successes: events.filter(e => e.outcome === "success").length, failures: events.filter(e => e.outcome === "failure").length, replays: events.filter(e => e.replayed).length };
}
function summary(events: ActivityEvent[], component: Component) {
  const selected = events.filter(e => e.component === component);
  const byOperation = Object.fromEntries([...new Set(selected.map(e => e.operation))].sort().map(op => [op, counts(selected.filter(e => e.operation === op))]));
  return { ...counts(selected), operations: byOperation };
}
function memorySummary(events: ActivityEvent[]) {
  const reads = events.filter(e => e.component === "memory" && e.outcome === "success" && ["search", "show"].includes(e.operation));
  const concepts = new Map<string, { concept_id: string; search_results: number; shows: number }>();
  for (const e of reads) for (const id of e.concept_ids!) {
    const row = concepts.get(id) ?? { concept_id: id, search_results: 0, shows: 0 };
    if (e.operation === "show") row.shows++; else row.search_results++;
    concepts.set(id, row);
  }
  return { ...summary(events, "memory"), searches: reads.filter(e => e.operation === "search").length, shows: reads.filter(e => e.operation === "show").length, empty_searches: reads.filter(e => e.operation === "search" && !e.concept_ids!.length).length, concepts: [...concepts.values()].sort((a, b) => b.shows - a.shows || b.search_results - a.search_results || a.concept_id.localeCompare(b.concept_id)) };
}
export async function run(argv: string[]) {
  const json = argv.includes("--json");
  try {
    const { values: v, positionals: p, tokens } = parseArgs({ args: argv, strict: true, allowPositionals: true, tokens: true, options: {
      root: { type: "string" }, project: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean" },
      component: { type: "string" }, since: { type: "string" }, until: { type: "string" }, limit: { type: "string" }, all: { type: "boolean" },
      id: { type: "string" }, "task-id": { type: "string" }, outcome: { type: "string" },
    } });
    const seen = new Set<string>();
    for (const t of tokens) if (t.kind === "option") { if (seen.has(t.name)) throw new Error(`Duplicate option: ${t.name}`); seen.add(t.name); }
    if (v.help || !argv.length) { process.stdout.write(json ? JSON.stringify({ ok: true, data: { help } }) + "\n" : help); return 0; }
    const command = p[0];
    if (!["enable", "disable", "stats", "list", "record"].includes(command ?? "") || p.length !== (command === "record" ? 2 : 1) || command === "record" && p[1] !== "recall") throw new Error("Unknown command or extra arguments. Use --help.");
    const allowed = ["root", "project", "json", ...(command === "record" ? ["id", "task-id", "outcome"] : command === "stats" || command === "list" ? ["component", "since", "until", ...(command === "list" ? ["limit", "all"] : [])] : [])];
    if ([...seen].some(k => !allowed.includes(k))) throw new Error("An option does not apply to this command.");
    if (!v.root) throw new Error("--root is required.");
    const project = v.project ?? "default"; projectId(project);
    let data: unknown;
    if (command === "enable" || command === "disable") data = await setEnabled(v.root, project, command === "enable");
    else if (command === "record") {
      if (!v.id || !uuidPattern.test(v.id)) throw new Error("record recall requires --id with a UUID v4. Reuse it for retries.");
      if (v["task-id"] !== undefined) projectId(v["task-id"]);
      if (v.outcome !== undefined && !["success", "failure"].includes(v.outcome)) throw new Error("--outcome must be success or failure.");
      data = await recordActivity({ root: v.root, project, activity: { component: "recall", operation: "run", outcome: v.outcome === "failure" ? "failure" : "success", ...(v["task-id"] === undefined ? {} : { task_id: v["task-id"] }) } }, v.id);
    } else {
      if (v.component !== undefined && !Object.hasOwn(operations, v.component)) throw new Error("Unknown component.");
      const since = v.since === undefined ? -Infinity : timestamp(v.since), until = v.until === undefined ? Infinity : timestamp(v.until);
      if (since >= until) throw new Error("--since must precede --until.");
      if (v.limit !== undefined && (!/^[1-9]\d*$/.test(v.limit) || !Number.isSafeInteger(Number(v.limit))) || v.limit !== undefined && v.all) throw new Error("Use --limit with a positive safe integer, or --all.");
      const config = await configuration(v.root, project), all = await readEvents(v.root, project);
      const events = all.events.filter(e => (!v.component || e.component === v.component) && Date.parse(e.at) >= since && Date.parse(e.at) < until);
      if (command === "list") data = { total: events.length, pending_files: all.pending, events: v.all ? events : events.slice(0, Math.min(Number(v.limit ?? 20), 100)) };
      else data = { project, ...config, events: events.length, first_at: events.at(-1)?.at ?? null, last_at: events[0]?.at ?? null, pending_files: all.pending, tasks: summary(events, "tasks"), memory: memorySummary(events), recall: { ...summary(events, "recall"), evidence: "self_reported" }, savepoint: await savepoints(v.root, project) };
    }
    process.stdout.write(JSON.stringify({ ok: true, data }, null, json ? undefined : 2) + "\n"); return 0;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (json) process.stdout.write(JSON.stringify({ ok: false, error: { code: "USAGE_ERROR", message } }) + "\n");
    else process.stderr.write(`Error: ${message}\n`);
    return 1;
  }
}
