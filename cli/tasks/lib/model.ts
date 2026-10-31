import { posix } from "node:path";

export const STATES = ["pending", "running", "waiting", "paused", "completed", "cancelled"] as const;
export type Progress = typeof STATES[number];
export type Artifact = { id: string; ref: string; description: string; attempt: number; createdAt: string };
export type Task = {
  id: string; title: string; description: string; state: Progress; version: number; attempt: number;
  dependencies: string[]; inputs: Record<string, number> | null;
  workspace: { taskId: string; repositoryIds: string[] } | null;
  artifacts: Artifact[]; result: string | null; reason: string; next: string; createdAt: string; updatedAt: string;
};
export type Checkpoint = { id: string; taskId: string; taskVersion: number; summary: string; next: string; createdAt: string; snapshot: Task };
export type Data = { task: Task; checkpoint?: Checkpoint };
export type Operation = { id: string; hash: string; actor: string; command: string; taskId: string; revision: number; at: string; data: Data };
export type State = {
  schemaVersion: 1; projectId: string; storeId: string; revision: number;
  tasks: Record<string, Task>; checkpoints: Record<string, Checkpoint>; operations: Record<string, Operation>;
};
export type Request = {
  command: string; id?: string; childId?: string; operationId?: string; ifVersion?: number; actor?: string;
  title?: string; description?: string; state?: string; reason?: string; next?: string; result?: string;
  on?: string; repo?: string[]; ref?: string; summary?: string; ready?: boolean;
};
export type Result = { revision: number; data: unknown; replayed?: boolean };
export class TasksError extends Error {
  constructor(public code: string, message: string, public exitCode = 2, public details?: unknown) { super(message); }
}
export function requireThat(value: unknown, code: string, message: string, exitCode = 2): asserts value {
  if (!value) throw new TasksError(code, message, exitCode);
}
export function identifier(value: unknown, code = "INVALID_INPUT"): asserts value is string {
  requireThat(typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) && !["constructor", "prototype"].includes(value), code, "IDs must use 1–64 lowercase letters, digits, hyphens or underscores, starting with a letter or digit.");
}
export function text(value: unknown, label: string, allowEmpty = false, code = "INVALID_INPUT"): asserts value is string {
  requireThat(typeof value === "string" && (allowEmpty || value.trim().length > 0) && !value.includes("\0"), code, label + " must be text" + (allowEmpty ? "." : " with a nonempty value."));
}
export function number(value: unknown, code = "INVALID_STATE", zero = false): asserts value is number {
  requireThat(Number.isSafeInteger(value) && (value as number) >= (zero ? 0 : 1), code, "Expected a positive safe integer.");
}
export function object(value: unknown, code = "INVALID_STATE"): asserts value is Record<string, unknown> {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), code, "Expected a JSON object.");
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  requireThat(required.every(k => Object.hasOwn(value, k)) && Object.keys(value).every(k => required.includes(k) || optional.includes(k)), "INVALID_STATE", "Missing or unsupported management fields.");
}
function ids(value: unknown): asserts value is string[] {
  requireThat(Array.isArray(value), "INVALID_STATE", "Expected an ID array.");
  value.forEach(v => identifier(v, "INVALID_STATE"));
  requireThat(new Set(value).size === value.length, "INVALID_STATE", "Duplicate IDs.");
}
function timestamp(value: unknown) {
  text(value, "timestamp", false, "INVALID_STATE");
  requireThat(Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, "INVALID_STATE", "Invalid timestamp.");
}
export function reference(value: unknown, project: string, code = "INVALID_INPUT"): asserts value is string {
  text(value, "ref", false, code);
  if (/^https?:\/\//.test(value)) {
    let url: URL;
    try { url = new URL(value); } catch { throw new TasksError(code, "Invalid reference URL."); }
    requireThat(!url.username && !url.password, code, "Reference URLs must not contain credentials.");
    return;
  }
  requireThat(!value.includes("\\") && posix.normalize(value) === value && !value.endsWith("/") && !value.split("/").some(part => part === ".." || part === "."), code, "Use a normalized relative reference path.");
  requireThat([".space/" + project + "/", "workspaces/" + project + "/"].some(prefix => value.startsWith(prefix) && value.length > prefix.length), code, "References must remain in the selected project's management or workspace paths.");
}
export function validateTask(value: unknown, project: string): asserts value is Task {
  object(value);
  keys(value, ["id", "title", "description", "state", "version", "attempt", "dependencies", "inputs", "workspace", "artifacts", "result", "reason", "next", "createdAt", "updatedAt"]);
  identifier(value.id, "INVALID_STATE"); text(value.title, "title", false, "INVALID_STATE");
  for (const key of ["description", "reason", "next"]) text(value[key], key, true, "INVALID_STATE");
  requireThat(STATES.includes(value.state as Progress), "INVALID_STATE", "Unknown task state.");
  number(value.version); number(value.attempt); ids(value.dependencies);
  requireThat(!value.dependencies.includes(value.id), "INVALID_STATE", "A task cannot depend on itself.");
  if (value.inputs !== null) {
    object(value.inputs);
    requireThat(Object.keys(value.inputs).length === value.dependencies.length && value.dependencies.every(id => Object.hasOwn(value.inputs!, id)), "INVALID_STATE", "Input versions do not match dependencies.");
    Object.values(value.inputs).forEach(v => number(v));
  }
  if (value.state === "pending") requireThat(value.inputs === null, "INVALID_STATE", "Pending tasks cannot pin inputs.");
  if (value.state === "running" || value.state === "completed") requireThat(value.inputs !== null, "INVALID_STATE", "Started tasks require input versions.");
  if (value.state === "completed") text(value.result, "result", false, "INVALID_STATE");
  else requireThat(value.result === null, "INVALID_STATE", "Only completed tasks have a current result.");
  if (value.workspace !== null) {
    object(value.workspace); keys(value.workspace, ["taskId", "repositoryIds"]);
    requireThat(value.workspace.taskId === value.id, "INVALID_STATE", "Workspace task ID mismatch.");
    ids(value.workspace.repositoryIds);
    requireThat(value.workspace.repositoryIds.length > 0, "INVALID_STATE", "Workspace repositories cannot be empty.");
  }
  requireThat(Array.isArray(value.artifacts), "INVALID_STATE", "Invalid artifacts.");
  const seen = new Set();
  for (const artifact of value.artifacts) {
    object(artifact); keys(artifact, ["id", "ref", "description", "attempt", "createdAt"]);
    identifier(artifact.id, "INVALID_STATE"); reference(artifact.ref, project, "INVALID_STATE");
    text(artifact.description, "description", false, "INVALID_STATE"); number(artifact.attempt); timestamp(artifact.createdAt);
    requireThat(artifact.attempt <= value.attempt && !seen.has(artifact.id), "INVALID_STATE", "Invalid artifact identity or attempt.");
    seen.add(artifact.id);
  }
  timestamp(value.createdAt); timestamp(value.updatedAt);
}
function checkpoint(value: unknown, project: string): asserts value is Checkpoint {
  object(value); keys(value, ["id", "taskId", "taskVersion", "summary", "next", "createdAt", "snapshot"]);
  identifier(value.id, "INVALID_STATE"); identifier(value.taskId, "INVALID_STATE"); number(value.taskVersion);
  text(value.summary, "summary", false, "INVALID_STATE"); text(value.next, "next", false, "INVALID_STATE"); timestamp(value.createdAt);
  validateTask(value.snapshot, project);
  requireThat(value.snapshot.id === value.taskId && value.snapshot.version === value.taskVersion, "INVALID_STATE", "Checkpoint snapshot identity mismatch.");
}
export function validateState(value: unknown, project: string): State {
  object(value); keys(value, ["schemaVersion", "projectId", "storeId", "revision", "tasks", "checkpoints", "operations"]);
  requireThat(value.schemaVersion === 1 && value.projectId === project, "INVALID_STATE", "Unsupported schema or project identity mismatch.");
  identifier(project, "INVALID_STATE"); text(value.storeId, "storeId", false, "INVALID_STATE"); number(value.revision, "INVALID_STATE", true);
  object(value.tasks); object(value.checkpoints); object(value.operations);
  for (const [id, task] of Object.entries(value.tasks)) {
    validateTask(task, project); requireThat(task.id === id, "INVALID_STATE", "Task key mismatch.");
    for (const dependency of task.dependencies) requireThat(Object.hasOwn(value.tasks, dependency), "INVALID_STATE", "A dependency does not exist.");
  }
  const state = value as unknown as State;
  const visited = new Set<string>(), visiting = new Set<string>();
  function visit(id: string) {
    requireThat(!visiting.has(id), "INVALID_STATE", "Dependency cycle.");
    if (visited.has(id)) return;
    visiting.add(id); state.tasks[id]!.dependencies.forEach(visit); visiting.delete(id); visited.add(id);
  }
  Object.keys(state.tasks).forEach(visit);
  for (const [key, entry] of Object.entries(value.checkpoints)) {
    checkpoint(entry, project);
    requireThat(key === entry.taskId + "/" + entry.id && Object.hasOwn(state.tasks, entry.taskId) && entry.taskVersion <= state.tasks[entry.taskId]!.version, "INVALID_STATE", "Invalid checkpoint reference.");
  }
  const revisions = new Set<number>();
  for (const [id, op] of Object.entries(value.operations)) {
    object(op); keys(op, ["id", "hash", "actor", "command", "taskId", "revision", "at", "data"]);
    identifier(id, "INVALID_STATE"); requireThat(op.id === id && typeof op.hash === "string" && /^[0-9a-f]{64}$/.test(op.hash), "INVALID_STATE", "Invalid operation identity.");
    text(op.actor, "actor", false, "INVALID_STATE"); text(op.command, "command", false, "INVALID_STATE");
    identifier(op.taskId, "INVALID_STATE"); number(op.revision); timestamp(op.at);
    requireThat(Object.hasOwn(state.tasks, op.taskId) && op.revision <= value.revision && !revisions.has(op.revision), "INVALID_STATE", "Invalid operation revision.");
    revisions.add(op.revision); object(op.data); keys(op.data, ["task"], ["checkpoint"]); validateTask(op.data.task, project);
    requireThat(op.data.task.id === op.taskId && op.data.task.version <= state.tasks[op.taskId]!.version, "INVALID_STATE", "Invalid operation task snapshot.");
    if (op.data.checkpoint !== undefined) {
      checkpoint(op.data.checkpoint, project);
      const saved = state.checkpoints[op.data.checkpoint.taskId + "/" + op.data.checkpoint.id];
      requireThat(saved && JSON.stringify(saved) === JSON.stringify(op.data.checkpoint), "INVALID_STATE", "Operation checkpoint does not match its snapshot.");
    }
  }
  requireThat(revisions.size === state.revision, "INVALID_STATE", "Incomplete operation history.");
  return state;
}

export function blockers(state: State, task: Task): string[] {
  const memo = new Map<string, boolean>();
  function completed(id: string): boolean {
    if (memo.has(id)) return memo.get(id)!;
    const t = state.tasks[id]!;
    const valid = t.state === "completed" && t.dependencies.every(dep => t.inputs?.[dep] === state.tasks[dep]!.version && completed(dep));
    memo.set(id, valid); return valid;
  }
  return task.dependencies.filter(id => !completed(id) || task.inputs !== null && task.inputs[id] !== state.tasks[id]!.version);
}
export function describe(state: State, task: Task) {
  const blockedBy = blockers(state, task);
  return { task, blockedBy, ready: task.state === "pending" && blockedBy.length === 0, completionCurrent: task.state === "completed" && blockedBy.length === 0 };
}
