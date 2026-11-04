import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execute } from "../../cli/tasks/lib/service.ts";
import { Store } from "../../cli/tasks/lib/store.ts";
import { TasksError, type Request } from "../../cli/tasks/lib/model.ts";

let root: string;
const entry = resolve(import.meta.dir, "../../cli/tasks/tasks.ts");
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "koto-archive-test-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function run(command: string[], fields: Record<string, unknown> = {}, expected = 0) {
  const child = Bun.spawn([process.execPath, entry, "--input-json", JSON.stringify({ root, command, ...fields })], { stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const body = JSON.parse(out);
  expect({ code, err, error: code === expected ? undefined : body.error }).toEqual({ code: expected, err: "", error: undefined });
  return body;
}
const complete = { ifVersion: 2, result: "Done", operationId: "complete-job" };
async function running(project = "default") {
  await run(["setup"], { project });
  await run(["task", "add", "job"], { project, title: "Job", operationId: "add-job" });
  await run(["task", "start", "job"], { project, ifVersion: 1, operationId: "start-job" });
}
async function document(project = "default") {
  const path = join(root, ".space", project, "tasks/job");
  await mkdir(join(path, "evidence"), { recursive: true });
  await writeFile(join(path, "task.md"), "# Task\n[Evidence](evidence/result.txt)\n");
  await writeFile(join(path, "evidence/result.txt"), "Evidence\n");
  return path;
}

test("complete archives task documents and current references; reopen restores them without rewriting history", async () => {
  await running();
  const active = await document(), archived = join(root, ".space/default/tasks/archive/job");
  await run(["artifact", "add", "job", "report"], { ifVersion: 2, ref: ".space/default/tasks/job/task.md", description: "Report", operationId: "report" });
  await run(["artifact", "add", "job", "external"], { ifVersion: 3, ref: "docs/report.md", description: "External document", operationId: "external" });
  await run(["checkpoint", "save", "job", "before"], { ifVersion: 4, summary: "Before completion", next: "Complete", operationId: "checkpoint" });
  const checkpointPath = join(root, ".space/default/checkpoint/job/before.json"), checkpoint = await readFile(checkpointPath, "utf8");
  await run(["task", "add", "reader"], { title: "Reader", operationId: "add-reader" });
  await run(["artifact", "add", "reader", "input"], { ifVersion: 1, ref: ".space/default/tasks/job/evidence/result.txt", description: "Input", operationId: "reader-input" });
  const done = await run(["task", "complete", "job"], { ...complete, ifVersion: 4 });
  expect(done.data.task).toMatchObject({ state: "completed", archived: true, version: 5 });
  expect(await Bun.file(join(archived, "evidence/result.txt")).text()).toBe("Evidence\n");
  expect(await readdir(join(root, ".space/default/tasks"))).not.toContain("job");
  expect((await run(["artifact", "list", "job"])).data.map((a: { ref: string }) => a.ref)).toEqual([".space/default/tasks/archive/job/task.md", "docs/report.md"]);
  expect((await run(["task", "show", "reader"])).data.task).toMatchObject({ version: 2, artifacts: [{ ref: ".space/default/tasks/archive/job/evidence/result.txt" }] });
  await run(["artifact", "add", "reader", "late"], { ifVersion: 2, ref: ".space/default/tasks/job/task.md", description: "Late reference", operationId: "late-ref" });
  expect((await run(["artifact", "list", "reader"])).data[1].ref).toBe(".space/default/tasks/archive/job/task.md");
  expect(await readFile(checkpointPath, "utf8")).toBe(checkpoint);
  expect((await run(["history", "job"])).data.find((op: { id: string }) => op.id === "report").data.task.artifacts[0].ref).toBe(".space/default/tasks/job/task.md");
  await run(["task", "reopen", "job"], { ifVersion: 5, reason: "Follow-up", operationId: "reopen" });
  expect(await readFile(join(active, "task.md"), "utf8")).toBe("# Task\n[Evidence](evidence/result.txt)\n");
  expect(await readdir(join(root, ".space/default/tasks/archive"))).not.toContain("job");
  expect((await run(["artifact", "list", "reader"])).data[0].ref).toBe(".space/default/tasks/job/evidence/result.txt");
  expect((await run(["task", "complete", "job"], { ...complete, ifVersion: 4 })).replayed).toBe(true);
  expect(await Bun.file(join(active, "task.md")).exists()).toBe(true);
  expect((await run(["task", "show", "job"])).data.task).toMatchObject({ state: "pending", archived: false, attempt: 2 });
  await run(["task", "start", "job"], { ifVersion: 6, operationId: "restart" });
  await run(["task", "complete", "job"], { ...complete, ifVersion: 7, operationId: "complete-again" });
  expect(await Bun.file(join(archived, "task.md")).exists()).toBe(true);
  expect((await run(["doctor"])).data.healthy).toBe(true);
});

test("completion without documents creates no folder, and cancellation leaves documents active", async () => {
  await running();
  await run(["task", "complete", "job"], complete);
  expect(await readdir(join(root, ".space/default/tasks"))).toEqual(["state.json"]);
  await run(["task", "reopen", "job"], { ifVersion: 3, reason: "Retry", operationId: "reopen" });
  const active = await document();
  await run(["task", "set", "job"], { ifVersion: 4, state: "cancelled", reason: "Cancelled", operationId: "cancel" });
  expect(await Bun.file(join(active, "task.md")).exists()).toBe(true);
});

test("folder collisions and symlinks fail before completion and preserve both locations", async () => {
  await running();
  const active = await document(), archive = join(root, ".space/default/tasks/archive");
  await mkdir(join(archive, "job"), { recursive: true });
  const before = await readFile(join(root, ".space/default/tasks/state.json"), "utf8");
  expect((await run(["task", "complete", "job"], complete, 2)).error.code).toBe("TASK_DIRECTORY_CONFLICT");
  expect(await readFile(join(root, ".space/default/tasks/state.json"), "utf8")).toBe(before);
  expect(await Bun.file(join(active, "task.md")).exists()).toBe(true);
  await rm(archive, { recursive: true });
  const outside = join(root, "outside"); await mkdir(outside);
  await symlink(outside, archive);
  expect((await run(["task", "complete", "job"], complete, 2)).error.code).toBe("UNSAFE_PATH");
  expect(await readdir(outside)).toEqual([]);
  expect(await readFile(join(root, ".space/default/tasks/state.json"), "utf8")).toBe(before);
});

test("unfinished moves are diagnosed, block other writes and resume only with the identical operation", async () => {
  await running(); await document();
  const store = await Store.open(root, "default");
  store.moveTaskDirectory = async () => { throw new Error("Move interrupted"); };
  const request: Request = { command: "task complete", id: "job", ...complete };
  try { await execute(store, request); throw new Error("Expected failure"); }
  catch (error) {
    expect(error).toBeInstanceOf(TasksError);
    expect((error as TasksError).code).toBe("TASK_DIRECTORY_MOVE_FAILED");
    expect((error as TasksError).details).toMatchObject({ saved: true, operationId: complete.operationId });
  }
  expect((await run(["doctor"], {}, 1)).data.problems).toContainEqual({ code: "TASK_DIRECTORY_MOVE_PENDING", task: "job", operationId: complete.operationId });
  expect((await run(["task", "show", "job"])).data.pendingDirectoryMove.operationId).toBe(complete.operationId);
  expect((await run(["task", "reopen", "job"], { ifVersion: 3, reason: "Retry", operationId: "reopen" }, 2)).error.code).toBe("TASK_DIRECTORY_MOVE_PENDING");
  expect((await run(["setup"], {}, 2)).error.code).toBe("TASK_DIRECTORY_MOVE_PENDING");
  expect((await run(["task", "complete", "job"], { ...complete, result: "Different" }, 2)).error.code).toBe("OPERATION_CONFLICT");
  const replay = await run(["task", "complete", "job"], complete);
  expect(replay.replayed).toBe(true);
  expect(await Bun.file(join(root, ".space/default/tasks/archive/job/task.md")).exists()).toBe(true);
  expect((await run(["history", "job"])).data).toHaveLength(3);
  expect((await run(["doctor"])).data.healthy).toBe(true);
});

test("retry after a successful rename and interrupted final save does not move a folder twice", async () => {
  await running(); await document();
  const store = await Store.open(root, "default"), original = store.moveTaskDirectory.bind(store);
  store.moveTaskDirectory = async move => { await original(move); throw new Error("Interrupted after rename"); };
  await expect(execute(store, { command: "task complete", id: "job", ...complete })).rejects.toThrow();
  expect(await Bun.file(join(root, ".space/default/tasks/archive/job/task.md")).exists()).toBe(true);
  expect((await run(["task", "complete", "job"], complete)).replayed).toBe(true);
  expect((await run(["doctor"])).data.healthy).toBe(true);
});

test("archive is explicit for legacy completed tasks and does not invalidate dependent work", async () => {
  await running();
  await run(["task", "complete", "job"], complete);
  const statePath = join(root, ".space/default/tasks/state.json"), state = JSON.parse(await readFile(statePath, "utf8"));
  delete state.tasks.job.archived;
  delete state.operations[complete.operationId].data.task.archived;
  await writeFile(statePath, JSON.stringify(state));
  const active = await document();
  await run(["setup"]);
  await run(["task", "complete", "job"], complete);
  expect(await Bun.file(join(active, "task.md")).exists()).toBe(true);
  await run(["task", "add", "next"], { title: "Next", operationId: "add-next" });
  await run(["dependency", "add", "next"], { ifVersion: 1, on: "job", operationId: "depends" });
  await run(["task", "start", "next"], { ifVersion: 2, operationId: "start-next" });
  expect((await run(["task", "archive", "next"], { ifVersion: 3, operationId: "invalid-archive" }, 2)).error.code).toBe("INVALID_TRANSITION");
  const archived = await run(["task", "archive", "job"], { ifVersion: 3, operationId: "archive-job" });
  expect(archived.data.task).toMatchObject({ archived: true, version: 3, state: "completed" });
  await run(["task", "complete", "next"], { ifVersion: 3, result: "Next done", operationId: "complete-next" });
  expect(await Bun.file(join(root, ".space/default/tasks/archive/job/task.md")).exists()).toBe(true);
});

test("projects stay isolated and archive cannot be used as a new task ID", async () => {
  await running("client");
  await document("client"); await document("default");
  await run(["task", "complete", "job"], { ...complete, project: "client" });
  expect(await Bun.file(join(root, ".space/client/tasks/archive/job/task.md")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".space/default/tasks/job/task.md")).exists()).toBe(true);
  expect((await run(["task", "add", "archive"], { project: "client", title: "Reserved", operationId: "reserved" }, 2)).error.code).toBe("INVALID_INPUT");
});

test("reopening refuses collisions and an interrupted restore can be resumed", async () => {
  await running();
  const active = await document();
  await run(["task", "complete", "job"], complete);
  await mkdir(active);
  const reopen: Request = { command: "task reopen", id: "job", ifVersion: 3, reason: "New work", operationId: "reopen" };
  const store = await Store.open(root, "default"), before = await readFile(store.path, "utf8");
  await expect(execute(store, reopen)).rejects.toThrow("destination already exists");
  expect(await readFile(store.path, "utf8")).toBe(before);
  await rm(active, { recursive: true });
  store.moveTaskDirectory = async () => { throw new Error("Restore interrupted"); };
  await expect(execute(store, reopen)).rejects.toThrow("directory move is incomplete");
  const restored = await execute(await Store.open(root, "default"), reopen);
  expect(restored.replayed).toBe(true);
  expect(await Bun.file(join(active, "task.md")).exists()).toBe(true);
  expect((await run(["task", "show", "job"])).data.task).toMatchObject({ state: "pending", attempt: 2, version: 4, archived: false });
});

test("recovery rejects a replacement folder and corrupt move records without losing documents", async () => {
  await running();
  const active = await document(), parked = join(root, "parked-original");
  const store = await Store.open(root, "default");
  store.moveTaskDirectory = async () => { throw new Error("Interrupted"); };
  await expect(execute(store, { command: "task complete", id: "job", ...complete })).rejects.toThrow();
  const saved = await readFile(store.path, "utf8");
  await rename(active, parked); await mkdir(active); await writeFile(join(active, "new.txt"), "keep");
  const reply = await run(["task", "complete", "job"], complete, 1);
  expect(reply.error.details).toMatchObject({ saved: true, cause: "TASK_DIRECTORY_CONFLICT" });
  expect(await readFile(join(active, "new.txt"), "utf8")).toBe("keep");
  expect(await readFile(store.path, "utf8")).toBe(saved);
  await rm(active, { recursive: true }); await rename(parked, active);
  for (const change of [{ taskId: "../outside" }, { archive: false }, { operationId: "start-job" }, { inode: "invalid" }]) {
    const state = JSON.parse(saved);
    Object.assign(state.pendingDirectoryMove, change);
    const invalid = JSON.stringify(state); await writeFile(store.path, invalid);
    expect((await run(["task", "complete", "job"], complete, 2)).error.code).toBe("INVALID_STATE");
    expect(await readFile(store.path, "utf8")).toBe(invalid);
    expect(await Bun.file(join(active, "task.md")).exists()).toBe(true);
  }
  await writeFile(store.path, saved);
  await run(["task", "complete", "job"], complete);
  expect((await run(["doctor"])).data.healthy).toBe(true);
});

test("legacy archive task IDs remain readable and prevent ambiguous directory ownership", async () => {
  await running(); await document();
  await run(["task", "add", "legacy"], { title: "Legacy", operationId: "add-legacy" });
  const path = join(root, ".space/default/tasks/state.json");
  const fixture = (await readFile(path, "utf8")).replaceAll('"legacy"', '"archive"');
  await writeFile(path, fixture);
  expect((await run(["task", "show", "archive"])).data.task.title).toBe("Legacy");
  expect((await run(["task", "complete", "job"], complete, 2)).error.code).toBe("TASK_DIRECTORY_CONFLICT");
  expect(await readFile(path, "utf8")).toBe(fixture);
  expect(await Bun.file(join(root, ".space/default/tasks/job/task.md")).exists()).toBe(true);
});
