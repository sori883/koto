import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execute } from "../../cli/tasks/lib/service.ts";
import { Store } from "../../cli/tasks/lib/store.ts";
import { TasksError, type Request } from "../../cli/tasks/lib/model.ts";

let root: string;
const entry = resolve(import.meta.dir, "../../cli/tasks/tasks.ts");
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "koto-tasks-test-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function run(command: string[], fields: Record<string, unknown> = {}, expected = 0) {
  const child = Bun.spawn([process.execPath, entry, "--input-json", JSON.stringify({ root, command, ...fields })], { stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, err }).toEqual({ code: expected, err: "" });
  return JSON.parse(out);
}
test("initializes independently and preserves exact retries without accepting stale updates", async () => {
  await run(["setup"]);
  const added = await run(["task", "add", "write-api"], { title: "APIを作る", operationId: "add-api" });
  expect(added.data.task).toMatchObject({ id: "write-api", state: "pending", version: 1, attempt: 1 });
  const path = join(root, ".space/default/tasks/state.json");
  const before = await readFile(path, "utf8");
  const replay = await run(["task", "add", "write-api"], { title: "APIを作る", operationId: "add-api" });
  expect(replay.replayed).toBe(true);
  expect(await readFile(path, "utf8")).toBe(before);
  expect((await run(["task", "add", "write-api"], { title: "違う入力", operationId: "add-api" }, 2)).error.code).toBe("OPERATION_CONFLICT");
  await run(["task", "start", "write-api"], { ifVersion: 1, operationId: "start-api" });
  expect((await run(["task", "update", "write-api"], { title: "古い更新", ifVersion: 1, operationId: "stale" }, 3)).error.code).toBe("VERSION_CONFLICT");
  await run(["task", "complete", "write-api"], { result: "APIを作成して検証した", ifVersion: 2, operationId: "complete-api" });
  expect((await run(["task", "show", "write-api"])).data.task.state).toBe("completed");
  expect((await run(["history", "write-api"])).data.map((event: { id: string }) => event.id)).toEqual(["add-api", "start-api", "complete-api"]);
  expect((await run(["doctor"])).data.healthy).toBe(true);
});

test("keeps projects independent and never initializes a misspelled project on reads or updates", async () => {
  await run(["setup"]);
  await run(["task", "add", "same-id"], { title: "Default", operationId: "add" });
  const before = await readFile(join(root, ".space/default/tasks/state.json"), "utf8");
  expect((await run(["status"], { project: "missing" }, 2)).error.code).toBe("NOT_INITIALIZED");
  expect((await run(["task", "add", "same-id"], { project: "missing", title: "Missing", operationId: "add" }, 2)).error.code).toBe("NOT_INITIALIZED");
  expect(await readdir(join(root, ".space"))).toEqual(["default"]);
  await run(["setup"], { project: "client" });
  await run(["task", "add", "same-id"], { project: "client", title: "Client", operationId: "add" });
  expect((await run(["task", "show", "same-id"], { project: "client" })).data.task.title).toBe("Client");
  expect(await readFile(join(root, ".space/default/tasks/state.json"), "utf8")).toBe(before);
  await run(["setup"]);
  expect(await readFile(join(root, ".space/default/tasks/state.json"), "utf8")).toBe(before);
});

test("guards transitions, records reasons and keeps previous attempts and results", async () => {
  await run(["setup"]);
  await run(["task", "add", "job"], { title: "Job", operationId: "add" });
  expect((await run(["task", "complete", "job"], { ifVersion: 1, result: "Too soon", operationId: "early" }, 2)).error.code).toBe("INVALID_TRANSITION");
  expect((await run(["task", "set", "job"], { ifVersion: 1, state: "completed", reason: "Bypass", operationId: "bypass" }, 2)).error.code).toBe("INVALID_INPUT");
  await run(["task", "set", "job"], { ifVersion: 1, state: "waiting", reason: "Need input", next: "Ask owner", operationId: "wait" });
  expect((await run(["task", "list"], { ready: true })).data).toEqual([]);
  await run(["task", "start", "job"], { ifVersion: 2, reason: "Input received", operationId: "start" });
  expect((await run(["task", "complete", "job"], { ifVersion: 3, result: "", operationId: "empty-result" }, 2)).error.code).toBe("INVALID_INPUT");
  await run(["task", "complete", "job"], { ifVersion: 3, result: "First result", operationId: "complete" });
  expect((await run(["task", "update", "job"], { ifVersion: 4, title: "Change terminal task", operationId: "terminal-update" }, 2)).error.code).toBe("INVALID_TRANSITION");
  const reopened = await run(["task", "reopen", "job"], { ifVersion: 4, reason: "Requirements changed", operationId: "reopen" });
  expect(reopened.data.task).toMatchObject({ state: "pending", version: 5, attempt: 2, result: null });
  expect((await run(["history", "job"])).data.find((op: { id: string }) => op.id === "complete").data.task.result).toBe("First result");
  await run(["task", "set", "job"], { ifVersion: 5, state: "cancelled", reason: "No longer needed", operationId: "cancel" });
  expect((await run(["task", "show", "job"])).data.task.state).toBe("cancelled");
});

test("detects cycles and invalidates transitive completions when an upstream task is reopened", async () => {
  await run(["setup"]);
  for (const id of ["a", "b", "c", "d"]) await run(["task", "add", id], { title: id, operationId: "add-" + id });
  for (const [id, on] of [["b", "a"], ["c", "b"], ["d", "b"]]) await run(["dependency", "add", id!], { on, ifVersion: 1, operationId: "dep-" + id });
  expect((await run(["dependency", "add", "a"], { on: "c", ifVersion: 1, operationId: "cycle" }, 2)).error.code).toBe("DEPENDENCY_CYCLE");
  expect((await run(["task", "start", "b"], { ifVersion: 2, operationId: "blocked" }, 2)).error.code).toBe("DEPENDENCY_BLOCKED");
  expect((await run(["task", "list"], { ready: true })).data.map((r: { task: { id: string } }) => r.task.id)).toEqual(["a"]);
  await run(["task", "start", "a"], { ifVersion: 1, operationId: "start-a" });
  await run(["task", "complete", "a"], { ifVersion: 2, result: "A", operationId: "complete-a" });
  await run(["task", "start", "b"], { ifVersion: 2, operationId: "start-b" });
  await run(["task", "complete", "b"], { ifVersion: 3, result: "B", operationId: "complete-b" });
  await run(["task", "start", "c"], { ifVersion: 2, operationId: "start-c" });
  await run(["task", "complete", "c"], { ifVersion: 3, result: "C", operationId: "complete-c" });
  await run(["task", "start", "d"], { ifVersion: 2, operationId: "start-d" });
  await run(["task", "reopen", "a"], { ifVersion: 3, reason: "Fix A", operationId: "reopen-a" });
  expect((await run(["task", "show", "c"])).data.completionCurrent).toBe(false);
  expect((await run(["status"])).data.invalidatedCompleted).toEqual(["b", "c"]);
  expect((await run(["task", "complete", "d"], { ifVersion: 3, result: "D", operationId: "stale-d" }, 2)).error.code).toBe("STALE_DEPENDENCY");
  await run(["task", "start", "a"], { ifVersion: 4, operationId: "restart-a" });
  await run(["task", "complete", "a"], { ifVersion: 5, result: "New A", operationId: "recomplete-a" });
  expect((await run(["task", "show", "b"])).data.completionCurrent).toBe(false);
  await run(["task", "reopen", "b"], { ifVersion: 4, reason: "Recheck A", operationId: "reopen-b" });
  await run(["dependency", "remove", "b"], { on: "a", ifVersion: 5, reason: "B now independent", operationId: "remove-dep" });
  expect((await run(["task", "show", "b"])).data.task.dependencies).toEqual([]);
});

test("records workspace and artifact references without accessing other tools or artifact contents", async () => {
  await run(["setup"]);
  await run(["task", "add", "job"], { title: "Job", operationId: "add" });
  const linked = await run(["workspace", "link", "job"], { repo: ["api", "web"], ifVersion: 1, operationId: "link" });
  expect(linked.data.task.workspace).toEqual({ taskId: "job", repositoryIds: ["api", "web"] });
  await run(["artifact", "add", "job", "report"], { ref: ".space/default/tasks/job/report.md", description: "Report reference", ifVersion: 2, operationId: "report" });
  await run(["artifact", "add", "job", "pr"], { ref: "https://github.com/example/repo/pull/1", description: "PR", ifVersion: 3, operationId: "pr" });
  for (const [index, ref] of ["/etc/passwd", ".space/client/tasks/secret", "workspaces/default/../client/file", "https://user:secret@example.com/path"].entries()) {
    expect((await run(["artifact", "add", "job", "invalid"], { ref, description: "Invalid", ifVersion: 4, operationId: "bad-ref-" + index }, 2)).error.code).toBe("INVALID_INPUT");
  }
  expect((await run(["artifact", "list", "job"])).data).toHaveLength(2);
  expect(await readdir(root)).toEqual([".space"]);
  expect(await readdir(join(root, ".space/default"))).toEqual(["tasks"]);
});

test("saves checkpoints atomically in the ledger and retries incomplete output without a duplicate operation", async () => {
  await run(["setup"]);
  await run(["task", "add", "job"], { title: "Job", operationId: "add" });
  const store = await Store.open(root, "default");
  store.publishCheckpoint = async () => { throw new Error("simulated output failure"); };
  const request: Request = { command: "checkpoint save", id: "job", childId: "pause-1", summary: "Investigated", next: "Implement", ifVersion: 1, operationId: "checkpoint" };
  try { await execute(store, request); throw new Error("Expected failure"); }
  catch (error) { expect(error).toBeInstanceOf(TasksError); expect((error as TasksError).details).toMatchObject({ saved: true, operationId: "checkpoint" }); }
  const stateFile = join(root, ".space/default/tasks/state.json"), saved = await readFile(stateFile, "utf8");
  expect(JSON.parse(saved).revision).toBe(2);
  expect((await run(["doctor"], {}, 1)).data.problems).toContainEqual({ code: "CHECKPOINT_OUTPUT_MISSING", checkpoint: "job/pause-1" });
  const replay = await run(["checkpoint", "save", "job", "pause-1"], { summary: "Investigated", next: "Implement", ifVersion: 1, operationId: "checkpoint" });
  expect(replay.replayed).toBe(true);
  expect(await readFile(stateFile, "utf8")).toBe(saved);
  const output = join(root, ".space/default/checkpoint/job/pause-1.json");
  expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({ taskId: "job", taskVersion: 1, summary: "Investigated", next: "Implement", snapshot: { title: "Job", version: 1 } });
  await run(["task", "update", "job"], { title: "New title", ifVersion: 1, operationId: "update" });
  expect((await run(["checkpoint", "show", "job", "pause-1"])).data.snapshot.title).toBe("Job");
  expect((await run(["checkpoint", "list", "job"])).data).toHaveLength(1);
  await writeFile(output, "Human edits\n");
  const conflict = await run(["checkpoint", "save", "job", "pause-1"], { summary: "Investigated", next: "Implement", ifVersion: 1, operationId: "checkpoint" }, 1);
  expect(conflict.error.details).toMatchObject({ saved: true, cause: "CHECKPOINT_FILE_CONFLICT" });
  expect(await readFile(output, "utf8")).toBe("Human edits\n");
});

test("serializes competing updates, preserves the winning update and isolates project locks", async () => {
  await run(["setup"]);
  await run(["task", "add", "job"], { title: "Job", operationId: "add" });
  const children = Array.from({ length: 4 }, (_, i) => Bun.spawn([process.execPath, entry, "--input-json", JSON.stringify({ root, command: ["task", "update", "job"], title: "Writer " + i, ifVersion: 1, operationId: "writer-" + i })], { stdout: "pipe", stderr: "pipe" }));
  const replies = await Promise.all(children.map(async child => {
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(err).toBe(""); return { code, body: JSON.parse(out) };
  }));
  expect(replies.filter(r => r.code === 0)).toHaveLength(1);
  for (const reply of replies.filter(r => r.code !== 0)) {
    expect(reply.code).toBe(3); expect(["LOCKED", "VERSION_CONFLICT"]).toContain(reply.body.error.code);
  }
  expect((await run(["task", "show", "job"])).data.task.version).toBe(2);
  expect((await run(["history", "job"])).data).toHaveLength(2);
  const lock = join(root, ".space/default/tasks/.tasks.lock");
  await writeFile(lock, JSON.stringify({ pid: process.pid }));
  expect((await run(["doctor"], {}, 1)).data.problems).toContainEqual({ code: "LOCKED" });
  expect((await run(["task", "update", "job"], { title: "Locked", ifVersion: 2, operationId: "locked" }, 3)).error.code).toBe("LOCKED");
  await run(["setup"], { project: "independent" });
  await run(["task", "add", "job"], { project: "independent", title: "Other project", operationId: "add" });
  expect(await readFile(lock, "utf8")).toBe(JSON.stringify({ pid: process.pid }));
});

test("keeps the old state when replacement fails and refuses corrupt or unknown schemas", async () => {
  await run(["setup"]);
  await run(["task", "add", "job"], { title: "Job", operationId: "add" });
  const store = await Store.open(root, "default"), before = await readFile(store.path, "utf8");
  await expect(store.transact(async () => {
    const state = await store.load(); state.tasks.job!.title = "Not persisted";
    return { state, result: null };
  }, { beforeReplace: async () => { throw new Error("simulated interruption"); } })).rejects.toThrow("simulated interruption");
  expect(await readFile(store.path, "utf8")).toBe(before);
  expect(await readdir(store.directory)).toEqual(["state.json"]);
  for (const body of ["{broken", JSON.stringify({ ...JSON.parse(before), schemaVersion: 999 }), JSON.stringify({ ...JSON.parse(before), revision: 500 })]) {
    await writeFile(store.path, body);
    expect((await run(["status"], {}, 2)).error.code).toBe("INVALID_STATE");
    expect((await run(["setup"], {}, 2)).error.code).toBe("INVALID_STATE");
    expect(await readFile(store.path, "utf8")).toBe(body);
  }
});

test("rejects path escapes, managed symlinks and irrelevant or malformed CLI input", async () => {
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "sentinel"), "keep");
  await mkdir(join(root, ".space/default"), { recursive: true });
  await symlink(outside, join(root, ".space/default/tasks"));
  expect((await run(["setup"], {}, 2)).error.code).toBe("UNSAFE_PATH");
  expect(await readdir(outside)).toEqual(["sentinel"]);
  await rm(join(root, ".space/default/tasks"));
  await run(["setup"]);
  await run(["task", "add", "job"], { title: "Job", operationId: "add" });
  const before = await readFile(join(root, ".space/default/tasks/state.json"), "utf8");
  await symlink(outside, join(root, ".space/default/checkpoint"));
  expect((await run(["checkpoint", "save", "job", "snap"], { summary: "Summary", next: "Next", ifVersion: 1, operationId: "snapshot" }, 2)).error.code).toBe("UNSAFE_PATH");
  for (const fields of [{ project: "../outside" }, { unknown: "field" }, { ready: false }, { operationId: "read-mutation" }]) {
    expect((await run(["status"], fields, 2)).error.code).toBe("INVALID_INPUT");
  }
  expect((await run(["task", "update", "job"], { title: "New", ifVersion: "1", operationId: "bad-number" }, 2)).error.code).toBe("INVALID_INPUT");
  expect((await run(["task", "add", "../escape"], { title: "Bad ID", operationId: "bad-id" }, 2)).error.code).toBe("INVALID_INPUT");
  expect(await readFile(join(root, ".space/default/tasks/state.json"), "utf8")).toBe(before);
  expect(await readdir(outside)).toEqual(["sentinel"]);
});
