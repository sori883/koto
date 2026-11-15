import { afterEach, beforeEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let root: string;
const source = resolve(import.meta.dir, "../../cli");
async function call(tool: string, args: string[], extra: string[] = []) {
  const p = Bun.spawn([process.execPath, join(source, tool, `${tool}.ts`), ...args, "--root", root, "--json", ...extra], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { body: out ? JSON.parse(out) : null, err, code };
}
async function ok(tool: string, args: string[], extra: string[] = []) {
  const result = await call(tool, args, extra);
  expect(result.code, JSON.stringify(result)).toBe(0);
  return result.body.data;
}
const stats = (extra: string[] = []) => ok("usage", ["stats"], extra);
const list = (extra: string[] = []) => ok("usage", ["list", "--all"], extra);
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "koto-activity-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("inspection and disabled recall never initialize a project; recording is opt-in and can be disabled", async () => {
  expect(await stats()).toMatchObject({ enabled: false, events: 0, savepoint: { files: 0, exists: false } });
  expect(await list()).toMatchObject({ total: 0, events: [] });
  expect(await ok("usage", ["record", "recall", "--id", crypto.randomUUID()])).toMatchObject({ recorded: false });
  expect(await readdir(root)).toEqual([]);
  await ok("usage", ["enable"]);
  await ok("tasks", ["setup"]);
  await ok("tasks", ["status"]);
  expect(await stats()).toMatchObject({ enabled: true, events: 2, tasks: { calls: 2 } });
  await ok("tasks", ["status", "--no-activity"]);
  await ok("usage", ["disable"]);
  await ok("tasks", ["status"]);
  expect(await stats()).toMatchObject({ enabled: false, events: 2 });
});

test("task calls distinguish failures and idempotent replays without logging private input", async () => {
  await ok("usage", ["enable"]);
  await ok("tasks", ["setup"]);
  const add = ["task", "add", "first", "--title", "private title", "--operation-id", "add-first"];
  await ok("tasks", add); await ok("tasks", add);
  expect((await call("tasks", ["task", "show", "missing"])).code).not.toBe(0);
  const result = await stats();
  expect(result.tasks).toMatchObject({ calls: 4, successes: 3, failures: 1, replays: 1 });
  expect(result.tasks.operations["task add"]).toMatchObject({ calls: 2, replays: 1 });
  expect(JSON.stringify(await list())).not.toContain("private title");
});

test("memory counts successful exposure and body retrieval separately, preserving legacy usage", async () => {
  await ok("memory", ["init"]);
  await ok("memory", ["create", "knowledge/example", "--type", "knowledge", "--scope", "shared", "--title", "Example", "--desc", "Example description", "--body", "PRIVATE BODY"]);
  await ok("usage", ["enable"]);
  await ok("memory", ["search", "Example"]);
  await ok("memory", ["search", "zzprivatequerynomatchqvx"]);
  await ok("memory", ["show", "knowledge/example", "--record-usage"]);
  expect((await call("memory", ["show", "knowledge/missing"])).code).not.toBe(0);
  const result = await stats();
  expect(result.memory).toMatchObject({ calls: 4, successes: 3, failures: 1, searches: 2, shows: 1, empty_searches: 1, concepts: [{ concept_id: "knowledge/example", search_results: 1, shows: 1 }] });
  expect(await ok("memory", ["usage", "stats"])).toMatchObject({ shows: 1 });
  expect((await stats()).events).toBe(4);
  const events = JSON.stringify(await list());
  expect(events).not.toContain("PRIVATE BODY"); expect(events).not.toContain("zzprivatequerynomatchqvx");
});

test("recall history is self-reported, retries deduplicate, filters remain project scoped", async () => {
  await ok("usage", ["enable"]);
  const id = crypto.randomUUID();
  await ok("usage", ["record", "recall", "--id", id, "--task-id", "first"]);
  expect(await ok("usage", ["record", "recall", "--id", id, "--task-id", "first"])).toMatchObject({ recorded: true, replayed: true });
  expect((await call("usage", ["record", "recall", "--id", id, "--outcome", "failure"])).code).not.toBe(0);
  const history = await list(["--component", "recall"]);
  expect(history).toMatchObject({ total: 1, events: [{ id, component: "recall", operation: "run", task_id: "first" }] });
  const at = history.events[0].at;
  expect((await stats(["--since", at])).events).toBe(1);
  expect((await stats(["--until", at])).events).toBe(0);
  expect((await stats(["--project", "other"])).events).toBe(0);
  expect(await readdir(join(root, ".space/default"))).toEqual(["usage"]);
  expect(await readdir(join(root, ".space"))).toEqual(["default"]);
  expect((await call("usage", ["stats", "--since", "yesterday"])).code).not.toBe(0);
});

test("savepoint counts existing Markdown files, independently of the event period", async () => {
  const dir = join(root, ".space/default/savepoint");
  await mkdir(join(dir, "topic"), { recursive: true });
  await writeFile(join(dir, "one.md"), "one"); await writeFile(join(dir, "topic/two.md"), "two"); await writeFile(join(dir, "note.txt"), "ignore");
  await symlink(join(dir, "one.md"), join(dir, "duplicate.md"));
  expect((await stats(["--until", "2000-01-01T00:00:00Z"])).savepoint).toMatchObject({ files: 2, exists: true, skipped_symlinks: 1, scope: "current_files" });
  expect(await readdir(join(root, ".space/default"))).toEqual(["savepoint"]);
});

test("concurrent records are retained; malformed logs fail visibly and never become zero usage", async () => {
  await ok("usage", ["enable"]);
  await Promise.all(Array.from({ length: 8 }, () => ok("usage", ["record", "recall", "--id", crypto.randomUUID()])));
  expect((await stats()).events).toBe(8);
  await writeFile(join(root, ".space/default/usage/events", `${crypto.randomUUID()}.json`), "{}");
  expect((await call("usage", ["stats"])).code).not.toBe(0);
});

test("unsafe logging paths cannot redirect writes or fail a successful primary command", async () => {
  await ok("tasks", ["setup"]); await ok("usage", ["enable"]);
  const outside = join(root, "outside"); await mkdir(outside);
  await symlink(outside, join(root, ".space/default/usage/events"));
  const result = await call("tasks", ["status"]);
  expect(result.code).toBe(0); expect(result.err).toContain("Activity was not recorded");
  expect(await readdir(outside)).toEqual([]);
  expect((await call("usage", ["stats"])).code).not.toBe(0);
});

test("tasks and memory execute independently without the usage CLI or a repository dependency", async () => {
  for (const tool of ["tasks", "memory"]) {
    const target = join(root, "standalone", tool); await cp(join(source, tool), target, { recursive: true });
    const p = Bun.spawn([process.execPath, "--no-install", join(target, `${tool}.ts`), tool === "tasks" ? "setup" : "init", "--root", root, "--json"], { stdout: "pipe", stderr: "pipe" });
    const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
    expect({ code, err }).toEqual({ code: 0, err: "" });
  }
  for (const tool of ["tasks", "memory"]) expect(await readFile(join(source, tool, "lib/activity.ts"), "utf8")).toBe(await readFile(join(source, "usage/lib/activity.ts"), "utf8"));
});

test("structured inputs, raw output, non-ASCII concept IDs and explicit read-only calls remain usable", async () => {
  await ok("memory", ["init"]);
  await ok("memory", ["create", "knowledge/認証", "--type", "knowledge", "--scope", "dev", "--title", "認証", "--desc", "認証方式"]);
  await ok("tasks", ["setup"]); await ok("usage", ["enable"]);
  async function structured(tool: string, command: string[], noActivity = false) {
    const p = Bun.spawn([process.execPath, join(source, tool, `${tool}.ts`), "--input-json", JSON.stringify({ command, root, noActivity })], { stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
    expect({ code, err }).toEqual({ code: 0, err: "" }); return JSON.parse(out);
  }
  await structured("tasks", ["status"]);
  await structured("tasks", ["status"], true);
  await structured("memory", ["show", "knowledge/認証"]);
  await structured("memory", ["show", "knowledge/認証"], true);
  const p = Bun.spawn([process.execPath, join(source, "memory/memory.ts"), "show", "knowledge/認証", "--root", root, "--raw"], { stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  expect({ code, err }).toEqual({ code: 0, err: "" });
  expect(out).toBe(await readFile(join(root, ".space/default/memory/knowledge/認証.md"), "utf8"));
  expect(await stats()).toMatchObject({ events: 3, tasks: { calls: 1 }, memory: { shows: 2, concepts: [{ concept_id: "knowledge/認証", shows: 2 }] } });
});

test("project/config symlinks and invalid options do not create or expose another project", async () => {
  const outside = join(root, "outside"); await mkdir(outside);
  await mkdir(join(root, ".space")); await symlink(outside, join(root, ".space/default"));
  expect((await call("usage", ["enable"])).code).not.toBe(0);
  expect((await call("usage", ["stats"])).code).not.toBe(0);
  expect(await readdir(outside)).toEqual([]);
  await rm(join(root, ".space/default"));
  expect((await call("usage", ["enable", "--component", "recall"])).code).not.toBe(0);
  expect(await readdir(join(root, ".space"))).toEqual([]);
  await ok("usage", ["enable"]);
  await rm(join(root, ".space/default/usage/config.json"));
  await writeFile(join(outside, "config.json"), '{"schema_version":1,"enabled":true,"updated_at":"2026-11-15T00:00:00Z"}');
  await symlink(join(outside, "config.json"), join(root, ".space/default/usage/config.json"));
  expect((await call("usage", ["record", "recall", "--id", crypto.randomUUID()])).code).not.toBe(0);
  expect(await readdir(join(root, ".space/default/usage"))).toEqual(["config.json"]);
});
