import { createHash } from "node:crypto";
import { blockers, describe, identifier, number, reference, requireThat, STATES, TasksError, text, type Data, type Progress, type Request, type Result, type State, type Task } from "./model.ts";
import { exists, Store } from "./store.ts";

export const READ = new Set(["task list", "task show", "artifact list", "checkpoint list", "checkpoint show", "history", "status", "doctor"]);
function taskIn(state: State, id: string | undefined): Task {
  identifier(id);
  requireThat(Object.hasOwn(state.tasks, id), "NOT_FOUND", "The task does not exist in this project.");
  return state.tasks[id]!;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
function editable(task: Task) { requireThat(!["completed", "cancelled"].includes(task.state), "INVALID_TRANSITION", "Reopen a terminal task before changing it."); }
function pending(task: Task) { requireThat(task.state === "pending", "INVALID_TRANSITION", "Dependency changes require a pending task. Pause and reopen started work first."); }
async function read(store: Store, request: Request): Promise<Result> {
  const state = await store.load();
  let data: unknown;
  if (request.command === "task list") {
    data = Object.values(state.tasks).sort((a, b) => a.id.localeCompare(b.id)).map(t => describe(state, t)).filter(t => (!request.state || t.task.state === request.state) && (!request.ready || t.ready));
  } else if (request.command === "status") {
    const tasks = Object.values(state.tasks).map(t => describe(state, t));
    data = { project: store.project, total: tasks.length, counts: Object.fromEntries(STATES.map(s => [s, tasks.filter(t => t.task.state === s).length])), ready: tasks.filter(t => t.ready).map(t => t.task.id), invalidatedCompleted: tasks.filter(t => t.task.state === "completed" && !t.completionCurrent).map(t => t.task.id) };
  } else if (request.command === "doctor") data = await store.doctor(state);
  else {
    const task = taskIn(state, request.id);
    switch (request.command) {
      case "task show": data = describe(state, task); break;
      case "artifact list": data = task.artifacts; break;
      case "history": data = Object.values(state.operations).filter(op => op.taskId === task.id).sort((a, b) => a.revision - b.revision); break;
      case "checkpoint list": data = Object.values(state.checkpoints).filter(cp => cp.taskId === task.id); break;
      case "checkpoint show": {
        identifier(request.childId);
        const key = task.id + "/" + request.childId;
        requireThat(Object.hasOwn(state.checkpoints, key), "NOT_FOUND", "The checkpoint does not exist.");
        data = state.checkpoints[key]; break;
      }
      default: throw new TasksError("INVALID_INPUT", "Unknown command.");
    }
  }
  return { revision: state.revision, data };
}
export async function execute(store: Store, request: Request): Promise<Result> {
  if (request.command === "setup") return store.setup();
  if (READ.has(request.command)) return read(store, request);
  identifier(request.id); identifier(request.operationId);
  const actor = request.actor ?? "unspecified";
  text(actor, "actor");
  const hash = createHash("sha256").update(JSON.stringify(canonical({ ...request, actor }))).digest("hex");
  const result = await store.transact<{ revision: number; data: Data; replayed?: boolean }>(async () => {
    const state = await store.load(), operationId = request.operationId!;
    if (Object.hasOwn(state.operations, operationId)) {
      const prior = state.operations[operationId]!;
      requireThat(prior.hash === hash, "OPERATION_CONFLICT", "The operation ID already belongs to different input.");
      return { state, unchanged: true, result: { revision: prior.revision, data: prior.data, replayed: true } };
    }
    const now = new Date().toISOString();
    let task: Task;
    if (request.command === "task add") {
      requireThat(!Object.hasOwn(state.tasks, request.id!), "ALREADY_EXISTS", "The task ID is already registered.");
      text(request.title, "title"); text(request.description ?? "", "description", true);
      task = { id: request.id!, title: request.title, description: request.description ?? "", state: "pending", version: 1, attempt: 1, dependencies: [], inputs: null, workspace: null, artifacts: [], result: null, reason: "", next: "", createdAt: now, updatedAt: now };
      state.tasks[task.id] = task;
    } else {
      task = taskIn(state, request.id);
      number(request.ifVersion, "INVALID_INPUT");
      requireThat(task.version === request.ifVersion, "VERSION_CONFLICT", "The task changed. Read it again before choosing a new update.", 3);
    }
    let checkpoint: Data["checkpoint"];
    switch (request.command) {
      case "task add": break;
      case "task update":
        editable(task);
        requireThat(request.title !== undefined || request.description !== undefined, "INVALID_INPUT", "Provide title or description.");
        if (request.title !== undefined) { text(request.title, "title"); task.title = request.title; }
        if (request.description !== undefined) { text(request.description, "description", true); task.description = request.description; }
        break;
      case "task start": {
        requireThat(["pending", "waiting", "paused"].includes(task.state), "INVALID_TRANSITION", "Only pending, waiting or paused tasks can start.");
        const blocked = blockers(state, task);
        requireThat(blocked.length === 0, task.inputs === null ? "DEPENDENCY_BLOCKED" : "STALE_DEPENDENCY", "Dependencies are incomplete or changed: " + blocked.join(", ") + ". Reopen started work if its inputs changed.");
        task.inputs ??= Object.fromEntries(task.dependencies.map(id => [id, state.tasks[id]!.version]));
        task.state = "running"; task.reason = request.reason ?? ""; task.next = "";
        break;
      }
      case "task set":
        editable(task);
        requireThat(["waiting", "paused", "cancelled"].includes(request.state ?? ""), "INVALID_INPUT", "Use waiting, paused or cancelled; start, complete and reopen are separate commands.");
        text(request.reason, "reason"); text(request.next ?? "", "next", true);
        task.state = request.state as Progress; task.reason = request.reason; task.next = request.next ?? "";
        break;
      case "task complete": {
        requireThat(task.state === "running", "INVALID_TRANSITION", "Only a running task can complete.");
        const blocked = blockers(state, task);
        requireThat(blocked.length === 0, "STALE_DEPENDENCY", "Dependencies changed: " + blocked.join(", ") + ". Recheck the work in a new attempt.");
        text(request.result, "result");
        task.state = "completed"; task.result = request.result; task.reason = ""; task.next = "";
        break;
      }
      case "task reopen":
        requireThat(["waiting", "paused", "completed", "cancelled"].includes(task.state), "INVALID_TRANSITION", "Pause running work before reopening it.");
        text(request.reason, "reason"); task.state = "pending"; task.attempt++; task.inputs = null; task.result = null; task.reason = request.reason; task.next = "";
        break;
      case "dependency add": {
        pending(task); identifier(request.on); taskIn(state, request.on);
        requireThat(!task.dependencies.includes(request.on), "ALREADY_EXISTS", "The dependency is already registered.");
        const seen = new Set<string>(), queue = [request.on];
        while (queue.length) {
          const id = queue.pop()!;
          requireThat(id !== task.id, "DEPENDENCY_CYCLE", "The dependency would create a cycle.");
          if (seen.has(id)) continue;
          seen.add(id); queue.push(...state.tasks[id]!.dependencies);
        }
        task.dependencies.push(request.on); task.dependencies.sort(); break;
      }
      case "dependency remove":
        pending(task); identifier(request.on); text(request.reason, "reason");
        requireThat(task.dependencies.includes(request.on), "NOT_FOUND", "The dependency does not exist.");
        task.dependencies = task.dependencies.filter(id => id !== request.on); task.reason = request.reason;
        break;
      case "workspace link":
        editable(task);
        requireThat(Array.isArray(request.repo) && request.repo.length > 0, "INVALID_INPUT", "Specify at least one repository ID.");
        request.repo.forEach(id => identifier(id));
        requireThat(new Set(request.repo).size === request.repo.length, "INVALID_INPUT", "Repository IDs must be unique.");
        task.workspace = { taskId: task.id, repositoryIds: [...request.repo].sort() }; break;
      case "artifact add":
        editable(task); identifier(request.childId); reference(request.ref, store.project); text(request.description, "description");
        requireThat(!task.artifacts.some(a => a.id === request.childId), "ALREADY_EXISTS", "The artifact ID already exists; retain it and use a new ID for a new artifact.");
        task.artifacts.push({ id: request.childId, ref: request.ref, description: request.description, attempt: task.attempt, createdAt: now }); break;
      case "checkpoint save": {
        identifier(request.childId); text(request.summary, "summary"); text(request.next, "next");
        const key = task.id + "/" + request.childId;
        requireThat(!Object.hasOwn(state.checkpoints, key), "ALREADY_EXISTS", "The checkpoint ID already exists; use its original operation ID to retry.");
        checkpoint = { id: request.childId, taskId: task.id, taskVersion: task.version, summary: request.summary, next: request.next, createdAt: now, snapshot: structuredClone(task) };
        requireThat(!await exists(await store.checkpointPath(checkpoint)), "CHECKPOINT_FILE_CONFLICT", "An unmanaged file occupies the checkpoint output path.");
        state.checkpoints[key] = checkpoint;
        break;
      }
      default: throw new TasksError("INVALID_INPUT", "Unknown command.");
    }
    if (!["task add", "checkpoint save"].includes(request.command)) { task.version++; task.updatedAt = now; }
    const data: Data = { task: structuredClone(task), ...(checkpoint ? { checkpoint } : {}) };
    state.revision++;
    state.operations[operationId] = { id: operationId, hash, actor, command: request.command, taskId: task.id, revision: state.revision, at: now, data };
    return { state, result: { revision: state.revision, data } };
  });
  if (result.data.checkpoint) {
    try { await store.publishCheckpoint(result.data.checkpoint); }
    catch (error) {
      throw new TasksError("CHECKPOINT_OUTPUT_FAILED", "The checkpoint is saved in Tasks but its output is incomplete. Resolve the output problem and retry the exact same operation.", 1, { saved: true, operationId: request.operationId, checkpoint: result.data.checkpoint.id, cause: error instanceof TasksError ? error.code : "IO_ERROR" });
    }
  }
  return result;
}
