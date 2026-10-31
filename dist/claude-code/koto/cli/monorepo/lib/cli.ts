import { parseArgs } from "node:util";
import { MonorepoError, requireThat } from "./model.ts";
import { Monorepo } from "./service.ts";

export const help = `koto-monorepo — project repositories and worktrees

Usage: koto-monorepo <command> [--root PATH] [--project ID] [--json]
       koto-monorepo --input-json '{"command":["status"],"root":"/path/to/root"}'

  setup
  project add <id> | project list | project show
  repo add <id> --url <url>
  repo list | repo show <id> | repo sync <id> | repo remove <id>
  workspace create <task-id> --repo <id> [--repo <id> ...]
      [--base <remote-branch>] [--branch <work-branch>]
  workspace list | workspace show <task-id>
  workspace remove <task-id> [--dry-run]
  status | doctor

--root defaults to the current directory; --project defaults to default.
setup and project add/list operate on the root, without --project.
repo remove unregisters a repository and RETAINS its Git data.
Existing worktrees prevent unregistering. No remote data is deleted.
workspace remove checks all worktrees and retains branches and Git history.
--dry-run previews removal, refreshing remote refs without deleting worktrees.
doctor exits 1 for an unhealthy environment. All commands accept --json.
`;

function requestArguments(args: string[]): string[] {
  if (!args.some(arg => arg === "--input-json" || arg.startsWith("--input-json="))) return args;
  let request: unknown;
  try {
    const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
      "input-json": { type: "string" }, json: { type: "boolean" },
    } });
    request = JSON.parse(values["input-json"]!);
  } catch { throw new MonorepoError("INVALID_INPUT", "Use --input-json with a JSON request; other input options cannot be mixed with it."); }
  requireThat(request !== null && typeof request === "object" && !Array.isArray(request), "INVALID_INPUT", "The JSON request must be an object.");
  const input = request as Record<string, unknown>;
  const fields = ["root", "project", "url", "branch", "base"];
  requireThat(Object.keys(input).every(key => ["command", "repo", "dryRun", ...fields].includes(key)), "INVALID_INPUT", "Unknown JSON request field.");
  requireThat(Array.isArray(input.command) && input.command.length > 0 && input.command.every(value => typeof value === "string"), "INVALID_INPUT", "command must be a nonempty string array, such as [\"workspace\",\"create\",\"task-001\"].");
  const expanded: string[] = [];
  if (Object.hasOwn(input, "dryRun")) {
    requireThat(typeof input.dryRun === "boolean", "INVALID_INPUT", "dryRun must be a boolean.");
    if (input.dryRun) expanded.push("--dry-run");
  }
  for (const key of fields) if (Object.hasOwn(input, key)) {
    requireThat(typeof input[key] === "string", "INVALID_INPUT", `${key} must be a string.`);
    expanded.push(`--${key}=${input[key]}`);
  }
  if (Object.hasOwn(input, "repo")) {
    requireThat(Array.isArray(input.repo) && input.repo.length > 0 && input.repo.every(value => typeof value === "string"), "INVALID_INPUT", "repo must be a nonempty string array.");
    for (const id of input.repo) expanded.push(`--repo=${id}`);
  }
  return [...expanded, "--", ...input.command as string[]];
}

export async function execute(args: string[]): Promise<{ data: unknown; code: number }> {
  args = requestArguments(args);
  let parsed;
  try {
    parsed = parseArgs({ args, strict: true, allowPositionals: true, options: {
      root: { type: "string" }, project: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean" },
      url: { type: "string" }, repo: { type: "string", multiple: true }, branch: { type: "string" }, base: { type: "string" },
      "dry-run": { type: "boolean" },
    } });
  } catch { throw new MonorepoError("INVALID_INPUT", "Invalid arguments. Use --help for supported commands and options."); }
  if (parsed.values.help || args.length === 0) return { data: { help }, code: 0 };
  const { values, positionals: parts } = parsed;
  const command = ["project", "repo", "workspace"].includes(parts[0] ?? "") ? parts.slice(0, 2).join(" ") : parts[0];
  const specs: Record<string, { count: number; flags: string[] }> = {
    setup: { count: 1, flags: [] },
    "project add": { count: 3, flags: [] }, "project list": { count: 2, flags: [] }, "project show": { count: 2, flags: ["project"] },
    "repo add": { count: 3, flags: ["project", "url"] }, "repo list": { count: 2, flags: ["project"] },
    "repo show": { count: 3, flags: ["project"] }, "repo sync": { count: 3, flags: ["project"] }, "repo remove": { count: 3, flags: ["project"] },
    "workspace create": { count: 3, flags: ["project", "repo", "base", "branch"] }, "workspace list": { count: 2, flags: ["project"] }, "workspace show": { count: 3, flags: ["project"] },
    "workspace remove": { count: 3, flags: ["project", "dry-run"] },
    status: { count: 1, flags: ["project"] }, doctor: { count: 1, flags: ["project"] },
  };
  requireThat(command && Object.hasOwn(specs, command), "INVALID_INPUT", "Unknown command. Use --help.");
  const spec = specs[command]!;
  requireThat(parts.length === spec.count, "INVALID_INPUT", "Incorrect number of arguments. Use --help.");
  requireThat(Object.keys(values).every(key => ["root", "json", "help", ...spec.flags].includes(key)), "INVALID_INPUT", "An option does not apply to this command.");
  if (command === "repo add") requireThat(values.url, "INVALID_INPUT", "repo add requires --url.");
  if (command === "workspace create") requireThat(values.repo?.length, "INVALID_INPUT", "workspace create requires --repo.");
  const service = await Monorepo.open(values.root ?? process.cwd(), command === "setup"), project = values.project ?? "default", id = parts[2]!;
  let data: unknown;
  switch (command) {
    case "setup": data = await service.setup(); break;
    case "project add": data = await service.projectAdd(id); break;
    case "project list": data = await service.projectList(); break;
    case "project show": data = await service.projectShow(project); break;
    case "repo add": data = await service.repoAdd(project, id, values.url!); break;
    case "repo list": data = await service.repoList(project); break;
    case "repo show": data = await service.repoShow(project, id); break;
    case "repo sync": data = await service.repoSync(project, id); break;
    case "repo remove": data = await service.repoRemove(project, id); break;
    case "workspace create": data = await service.workspaceCreate(project, id, values.repo!, values.branch, values.base); break;
    case "workspace list": data = await service.workspaceList(project); break;
    case "workspace show": data = await service.workspaceShow(project, id); break;
    case "workspace remove": {
      const result = await service.workspaceRemove(project, id, values["dry-run"] ?? false);
      return { data: result, code: result.canRemove ? 0 : 1 };
    }
    case "status": data = await service.status(project); break;
    case "doctor": { const result = await service.doctor(project); return { data: result, code: result.healthy ? 0 : 1 }; }
  }
  return { data, code: 0 };
}

export async function main(args: string[]): Promise<number> {
  const json = args.some(arg => arg === "--json" || arg === "--input-json" || arg.startsWith("--input-json="));
  try {
    const { data, code } = await execute(args);
    const result = { ok: code === 0, data };
    if (json) process.stdout.write(JSON.stringify(result) + "\n");
    else if (data && typeof data === "object" && "help" in data) process.stdout.write(help);
    else process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return code;
  } catch (error) {
    const problem = error instanceof MonorepoError ? error : new MonorepoError("IO_ERROR", "The operation could not complete. Check filesystem access and run doctor.");
    const result = { ok: false, error: { code: problem.code, message: problem.message, ...(problem.details === undefined ? {} : { details: problem.details }) } };
    if (json) process.stdout.write(JSON.stringify(result) + "\n");
    else process.stderr.write(`${problem.code}: ${problem.message}\n${problem.details === undefined ? "" : JSON.stringify(problem.details, null, 2) + "\n"}`);
    return problem.code === "INVALID_INPUT" ? 2 : 1;
  }
}
