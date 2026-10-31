import { parseArgs } from "node:util";
import { identifier, number, object, requireThat, STATES, TasksError, text, type Request } from "./model.ts";
import { execute, READ } from "./service.ts";
import { Store } from "./store.ts";

export const help = "koto-tasks — project task records\n\n" +
  "Usage: koto-tasks <command> [--root PATH] [--project ID] [--json]\n" +
  "       koto-tasks --input-json '{\"command\":[\"status\"],\"root\":\"/path\"}'\n\n" +
  "  setup\n  task add <id> --title TEXT [--description TEXT]\n" +
  "  task list [--state STATE] [--ready] | task show <id>\n" +
  "  task update <id> [--title TEXT] [--description TEXT]\n" +
  "  task start <id> [--reason TEXT]\n  task set <id> --state waiting|paused|cancelled --reason TEXT [--next TEXT]\n" +
  "  task complete <id> --result TEXT | task reopen <id> --reason TEXT\n" +
  "  dependency add <id> --on <task-id>\n  dependency remove <id> --on <task-id> --reason TEXT\n" +
  "  workspace link <id> --repo <repository-id> [--repo <repository-id> ...]\n" +
  "  artifact add <id> <artifact-id> --ref REF --description TEXT | artifact list <id>\n" +
  "  checkpoint save <id> <checkpoint-id> --summary TEXT --next TEXT\n" +
  "  checkpoint list <id> | checkpoint show <id> <checkpoint-id>\n" +
  "  history <id> | status | doctor\n\n" +
  "Every mutation except setup requires --operation-id ID.\n" +
  "Updates to an existing task also require --if-version N.\n" +
  "Retry an uncertain operation with exactly the same ID and input.\n" +
  "--actor TEXT records a self-reported identity; it is not authentication.\n" +
  "--root defaults to the current directory; --project defaults to default.\n" +
  "Read README.md for dependency changes, checkpoints and recovery.\n";

const names: Record<string, string> = { operationId: "operation-id", ifVersion: "if-version" };
function expand(args: string[]): string[] {
  if (!args.some(a => a === "--input-json" || a.startsWith("--input-json="))) return args;
  let input: unknown;
  try {
    const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: { "input-json": { type: "string" }, json: { type: "boolean" } } });
    input = JSON.parse(values["input-json"]!);
  } catch { throw new TasksError("INVALID_INPUT", "Pass one JSON request with --input-json; do not mix it with other inputs."); }
  object(input, "INVALID_INPUT");
  requireThat(Object.keys(input).every(k => ["command", "root", "project", "operationId", "ifVersion", "actor", "title", "description", "state", "reason", "next", "result", "on", "repo", "ref", "summary", "ready"].includes(k)), "INVALID_INPUT", "Unknown JSON input field.");
  requireThat(Array.isArray(input.command) && input.command.length > 0 && input.command.every(v => typeof v === "string"), "INVALID_INPUT", "command must be a nonempty string array.");
  const parts = input.command as string[];
  const grouped = ["task", "dependency", "workspace", "artifact", "checkpoint"].includes(parts[0] ?? "");
  const command = parts.slice(0, grouped ? 2 : 1).join(" ");
  requireThat(Object.hasOwn(specs, command), "INVALID_INPUT", "Unknown command.");
  const writes = command !== "setup" && !READ.has(command);
  const allowed = ["command", "root", "project", ...specs[command]!.flags, ...(writes ? ["operationId", "actor", ...(command === "task add" ? [] : ["ifVersion"])] : [])];
  requireThat(Object.keys(input).every(k => allowed.includes(k)), "INVALID_INPUT", "A JSON field does not apply to this command.");
  const expanded: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (key === "command") continue;
    if (key === "repo") {
      requireThat(Array.isArray(value) && value.length > 0 && value.every(v => typeof v === "string"), "INVALID_INPUT", "repo must be a nonempty string array.");
      value.forEach(v => expanded.push("--repo=" + v));
    } else if (key === "ready") {
      requireThat(typeof value === "boolean", "INVALID_INPUT", "ready must be boolean.");
      if (value) expanded.push("--ready");
    } else if (key === "ifVersion") {
      number(value, "INVALID_INPUT"); expanded.push("--if-version=" + value);
    } else {
      requireThat(typeof value === "string", "INVALID_INPUT", key + " must be text.");
      expanded.push("--" + (names[key] ?? key) + "=" + value);
    }
  }
  return [...expanded, "--", ...input.command as string[]];
}
type Spec = { count: number; flags: string[] };
const specs: Record<string, Spec> = {
  setup: { count: 1, flags: [] },
  "task add": { count: 3, flags: ["title", "description"] }, "task list": { count: 2, flags: ["state", "ready"] }, "task show": { count: 3, flags: [] },
  "task update": { count: 3, flags: ["title", "description"] }, "task start": { count: 3, flags: ["reason"] },
  "task set": { count: 3, flags: ["state", "reason", "next"] }, "task complete": { count: 3, flags: ["result"] }, "task reopen": { count: 3, flags: ["reason"] },
  "dependency add": { count: 3, flags: ["on"] }, "dependency remove": { count: 3, flags: ["on", "reason"] },
  "workspace link": { count: 3, flags: ["repo"] }, "artifact add": { count: 4, flags: ["ref", "description"] }, "artifact list": { count: 3, flags: [] },
  "checkpoint save": { count: 4, flags: ["summary", "next"] }, "checkpoint list": { count: 3, flags: [] }, "checkpoint show": { count: 4, flags: [] },
  history: { count: 2, flags: [] }, status: { count: 1, flags: [] }, doctor: { count: 1, flags: [] },
};
export async function main(argv: string[]): Promise<number> {
  const json = argv.some(a => a === "--json" || a === "--input-json" || a.startsWith("--input-json="));
  try {
    const args = expand(argv);
    let parsed;
    try {
      parsed = parseArgs({ args, strict: true, allowPositionals: true, options: {
        root: { type: "string" }, project: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean" },
        "operation-id": { type: "string" }, "if-version": { type: "string" }, actor: { type: "string" },
        title: { type: "string" }, description: { type: "string" }, state: { type: "string" }, reason: { type: "string" },
        next: { type: "string" }, result: { type: "string" }, on: { type: "string" }, repo: { type: "string", multiple: true },
        ref: { type: "string" }, summary: { type: "string" }, ready: { type: "boolean" },
      } });
    } catch { throw new TasksError("INVALID_INPUT", "Invalid arguments. Use --help."); }
    const { values, positionals } = parsed;
    if (values.help || argv.length === 0) {
      process.stdout.write(json ? JSON.stringify({ ok: true, data: { help } }) + "\n" : help);
      return 0;
    }
    const grouped = ["task", "dependency", "workspace", "artifact", "checkpoint"].includes(positionals[0] ?? "");
    const length = grouped ? 2 : 1, command = positionals.slice(0, length).join(" ");
    requireThat(Object.hasOwn(specs, command), "INVALID_INPUT", "Unknown command. Use --help.");
    const spec = specs[command]!, writes = command !== "setup" && !READ.has(command);
    requireThat(positionals.length === spec.count, "INVALID_INPUT", "Missing or extra positional arguments.");
    const mutationFlags = writes ? ["operation-id", "actor", ...(command === "task add" ? [] : ["if-version"])] : [];
    requireThat(Object.keys(values).every(k => ["root", "project", "json", "help", ...spec.flags, ...mutationFlags].includes(k)), "INVALID_INPUT", "An option does not apply to this command.");
    const request: Request = { command, id: positionals[length], childId: positionals[length + 1] };
    for (const key of ["title", "description", "state", "reason", "next", "result", "on", "ref", "summary", "actor"] as const) {
      if (values[key] !== undefined) { text(values[key], key, true); request[key] = values[key]; }
    }
    if (values.repo !== undefined) request.repo = values.repo;
    if (values.ready !== undefined) request.ready = values.ready;
    if (request.id !== undefined) identifier(request.id);
    if (request.childId !== undefined) identifier(request.childId);
    if (request.state !== undefined) requireThat(STATES.includes(request.state as typeof STATES[number]), "INVALID_INPUT", "Unknown task state.");
    if (writes) {
      identifier(values["operation-id"]); request.operationId = values["operation-id"];
      if (command !== "task add") {
        requireThat(/^[1-9][0-9]*$/.test(values["if-version"] ?? ""), "INVALID_INPUT", "An existing task update requires --if-version.");
        request.ifVersion = Number(values["if-version"]); number(request.ifVersion, "INVALID_INPUT");
      }
    }
    const root = values.root ?? process.cwd(), project = values.project ?? "default";
    text(root, "root"); identifier(project);
    const store = await Store.open(root, project, command === "setup");
    const result = await execute(store, request);
    const healthy = command !== "doctor" || (result.data as { healthy: boolean }).healthy;
    process.stdout.write(JSON.stringify({ ok: healthy, ...result }, null, json ? undefined : 2) + "\n");
    return healthy ? 0 : 1;
  } catch (error) {
    const known = error instanceof TasksError;
    const value = { code: known ? error.code : "IO_ERROR", message: known ? error.message : "The operation could not complete. Check filesystem access and inspect this project with doctor.", ...(known && error.details !== undefined ? { details: error.details } : {}) };
    if (json) process.stdout.write(JSON.stringify({ ok: false, error: value }) + "\n");
    else process.stderr.write(value.code + ": " + value.message + (value.details ? "\n" + JSON.stringify(value.details) : "") + "\n");
    return known ? error.exitCode : 1;
  }
}
