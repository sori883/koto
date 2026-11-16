import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entry = resolve(import.meta.dir, "../../cli/tasks/tasks.ts");
let root: string;
let tasks: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "koto-task-hierarchy-"));
  tasks = join(root, ".space/default/tasks");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function run(command: string[], fields: Record<string, unknown> = {}, expected = 0) {
  const child = Bun.spawn([process.execPath, entry, "--input-json", JSON.stringify({ root, command, ...fields })], { stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const body = JSON.parse(out);
  expect({ code, err, error: code === expected ? undefined : body.error }).toEqual({ code: expected, err: "", error: undefined });
  return body;
}

async function add(id: string, parent?: string) {
  return run(["task", "add", id], { title: id, operationId: "add-" + id, parent });
}
async function start(id: string, ifVersion = 1) {
  await run(["task", "start", id], { ifVersion, operationId: "start-" + id });
}
async function complete(id: string, ifVersion = 2, expected = 0) {
  return run(["task", "complete", id], { result: "Done", ifVersion, operationId: "complete-" + id }, expected);
}

test("child tasks retain independent JSON state and history without creating documents", async () => {
  await run(["setup"]);
  await add("request");
  await add("unrelated");
  expect((await add("implementation", "request")).data.task.parentId).toBe("request");
  await add("verification", "request");
  expect((await run(["task", "show", "request"])).data).toMatchObject({
    task: { version: 1 }, childIds: ["implementation", "verification"],
  });
  expect((await run(["task", "list"], { parent: "request" })).data.map((row: { task: { id: string } }) => row.task.id))
    .toEqual(["implementation", "verification"]);
  expect(await readdir(tasks)).toEqual(["state.json"]);
  await run(["task", "set", "verification"], { ifVersion: 1, state: "waiting", reason: "Need review", next: "Ask reviewer", operationId: "wait" });
  await start("implementation");
  expect((await run(["task", "list"], { parent: "request" })).data).toMatchObject([
    { task: { id: "implementation", state: "running" } },
    { task: { id: "verification", state: "waiting", reason: "Need review", next: "Ask reviewer" } },
  ]);
  expect(await readdir(tasks)).toEqual(["state.json"]);
  expect((await run(["task", "list"], { parent: "request", state: "waiting" })).data[0].task.id).toBe("verification");
  expect((await run(["history", "implementation"])).data.map((op: { command: string }) => op.command)).toEqual(["task add", "task start"]);
  expect((await run(["history", "request"])).data).toHaveLength(1);
});

test("only the parent's completion archives the whole request and reopen restores its child evidence", async () => {
  await run(["setup"]);
  await add("request");
  await add("child", "request");
  await start("request");
  await start("child");
  const ref = ".space/default/tasks/request/children/child/evidence.md";
  await mkdir(join(tasks, "request/children/child"), { recursive: true });
  await writeFile(join(root, ref), "Evidence\n");
  await run(["artifact", "add", "child", "evidence"], { ifVersion: 2, operationId: "add-evidence", ref, description: "Evidence" });
  expect((await complete("request", 2, 2)).error.code).toBe("CHILDREN_INCOMPLETE");
  await complete("child", 3);
  expect(await readFile(join(root, ref), "utf8")).toBe("Evidence\n");
  expect((await run(["task", "archive", "child"], { ifVersion: 4, operationId: "archive-child" }, 2)).error.code).toBe("INVALID_TRANSITION");
  await complete("request");
  const archivedRef = ref.replace("/tasks/request/", "/tasks/.archive/request/");
  expect(await Bun.file(join(root, ref)).exists()).toBe(false);
  expect(await readFile(join(root, archivedRef), "utf8")).toBe("Evidence\n");
  expect((await run(["task", "show", "request"])).data).toMatchObject({ completionCurrent: true, incompleteChildren: [] });
  expect(await Bun.file(join(tasks, ".archive/request/tasks.md")).exists()).toBe(false);
  expect((await run(["artifact", "list", "child"])).data[0].ref).toBe(archivedRef);
  const reopenChild = { ifVersion: 4, reason: "Follow-up", operationId: "reopen-child" };
  expect((await run(["task", "reopen", "child"], reopenChild, 2)).error.code).toBe("PARENT_CLOSED");
  expect((await run(["task", "add", "another"], { parent: "request", title: "Another", operationId: "add-another" }, 2)).error.code).toBe("PARENT_CLOSED");
  await run(["task", "reopen", "request"], { ifVersion: 3, reason: "Follow-up", operationId: "reopen-request" });
  expect((await run(["task", "show", "child"])).data.task.state).toBe("completed");
  expect((await run(["artifact", "list", "child"])).data[0].ref).toBe(ref);
  expect(await readFile(join(root, ref), "utf8")).toBe("Evidence\n");
  await run(["task", "reopen", "child"], reopenChild);
  expect((await run(["task", "show", "child"])).data.task.state).toBe("pending");
  expect(await Bun.file(join(root, archivedRef)).exists()).toBe(false);
});

test("guards parent membership and detects completion cycles across requests", async () => {
  await run(["setup"]);
  const fields = { title: "New", operationId: "new" };
  expect((await run(["task", "add", "new"], { ...fields, parent: "missing" }, 2)).error.code).toBe("NOT_FOUND");
  await add("one"); await add("one-child", "one");
  await add("two"); await add("two-child", "two");
  expect((await run(["task", "add", "new"], { ...fields, parent: "one-child" }, 2)).error.code).toBe("INVALID_PARENT");
  expect((await run(["dependency", "add", "one-child"], { on: "one", ifVersion: 1, operationId: "self-group" }, 2)).error.code).toBe("DEPENDENCY_CYCLE");
  await run(["dependency", "add", "one-child"], { on: "two", ifVersion: 1, operationId: "cross-group" });
  expect((await run(["dependency", "add", "two-child"], { on: "one", ifVersion: 1, operationId: "cycle" }, 2)).error.code).toBe("DEPENDENCY_CYCLE");
  expect((await run(["task", "set", "two"], { ifVersion: 1, state: "cancelled", reason: "Cancelled", operationId: "cancel-two" }, 2)).error.code).toBe("CHILDREN_INCOMPLETE");
  await run(["task", "set", "two-child"], { ifVersion: 1, state: "cancelled", reason: "Out of scope", operationId: "cancel-two-child" });
  await start("two");
  await complete("two");
  expect((await run(["task", "show", "two"])).data).toMatchObject({ completionCurrent: true, incompleteChildren: [] });
  expect((await run(["task", "show", "two-child"])).data.task.state).toBe("cancelled");
  expect(await readdir(tasks)).toEqual(["state.json"]);
});

test("parent completion and downstream dependencies reflect a child's stale completion", async () => {
  await run(["setup"]);
  await add("input"); await start("input"); await complete("input");
  await add("request"); await start("request"); await add("child", "request");
  await run(["dependency", "add", "child"], { on: "input", ifVersion: 1, operationId: "child-input" });
  await start("child", 2); await complete("child", 3); await complete("request");
  await add("dependent");
  await run(["dependency", "add", "dependent"], { on: "request", ifVersion: 1, operationId: "dependent-input" });
  await run(["task", "reopen", "input"], { ifVersion: 3, reason: "New input", operationId: "reopen-input" });
  expect((await run(["task", "show", "request"])).data).toMatchObject({ completionCurrent: false, incompleteChildren: ["child"] });
  expect((await run(["task", "start", "dependent"], { ifVersion: 2, operationId: "start-dependent" }, 2)).error.code).toBe("DEPENDENCY_BLOCKED");
});

test("replaying a child update preserves later sibling changes and the current group", async () => {
  await run(["setup"]); await add("request"); await add("child", "request");
  const update = { ifVersion: 1, state: "waiting", reason: "Waiting", next: "Check input", operationId: "wait-child" };
  await run(["task", "set", "child"], update);
  await add("sibling", "request");
  await start("sibling");
  const current = await readFile(join(tasks, "state.json"), "utf8");
  expect((await run(["task", "set", "child"], update)).replayed).toBe(true);
  expect(await readFile(join(tasks, "state.json"), "utf8")).toBe(current);
  expect((await run(["task", "list"], { parent: "request" })).data).toMatchObject([
    { task: { id: "child", state: "waiting", next: "Check input" } },
    { task: { id: "sibling", state: "running" } },
  ]);
  expect(await readdir(tasks)).toEqual(["state.json"]);
});
