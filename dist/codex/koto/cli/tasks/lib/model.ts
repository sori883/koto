import { posix } from "node:path";

export const STATES = ["pending", "running", "waiting", "paused", "completed", "cancelled"] as const;
export const ARCHIVE_ROOT = ".archive";
const LEGACY_ARCHIVE_ROOT = "archive";
type ArchiveRoot = typeof ARCHIVE_ROOT | typeof LEGACY_ARCHIVE_ROOT;
export type Progress = typeof STATES[number];
export type Artifact = { id: string; ref: string; description: string; attempt: number; createdAt: string };
export type Task = {
  id: string; title: string; description: string; state: Progress; version: number; attempt: number;
  dependencies: string[]; inputs: Record<string, number> | null;
  workspace: { taskId: string; repositoryIds: string[] } | null;
  artifacts: Artifact[]; result: string | null; reason: string; next: string; createdAt: string; updatedAt: string;
  parentId?: string;
  archived?: boolean;
  archiveRoot?: typeof ARCHIVE_ROOT;
};
export type DirectoryMove = { taskId: string; operationId: string; archive: boolean; archiveRoot?: typeof ARCHIVE_ROOT; device: string; inode: string };
export type Checkpoint = { id: string; taskId: string; taskVersion: number; summary: string; next: string; createdAt: string; snapshot: Task };
export type Data = { task: Task; checkpoint?: Checkpoint };
export type Operation = { id: string; hash: string; actor: string; command: string; taskId: string; revision: number; at: string; data: Data };
export type State = {
  schemaVersion: 1; projectId: string; storeId: string; revision: number;
  tasks: Record<string, Task>; checkpoints: Record<string, Checkpoint>; operations: Record<string, Operation>;
  pendingDirectoryMove?: DirectoryMove;
};
export type Request = {
  command: string; id?: string; childId?: string; operationId?: string; ifVersion?: number; actor?: string;
  title?: string; description?: string; state?: string; reason?: string; next?: string; result?: string;
  parent?: string; on?: string; repo?: string[]; ref?: string; summary?: string; ready?: boolean;
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
  requireThat(!value.startsWith("/") && !/[\\:\u0000-\u001f\u007f]/.test(value) && posix.normalize(value) === value && !value.endsWith("/") && !value.split("/").some(part => part === ".." || part === "." || part === ".git"), code, "Use a normalized relative reference path outside Git metadata.");
  const area = value.split("/")[0];
  const local = project === "default" && ![".space", "workspaces", "repositories"].includes(area!);
  requireThat(local || [".space/" + project + "/", "workspaces/" + project + "/"].some(prefix => value.startsWith(prefix) && value.length > prefix.length), code, "References must remain in the selected project; repository source belongs to default.");
}
export function validateTask(value: unknown, project: string): asserts value is Task {
  object(value);
  keys(value, ["id", "title", "description", "state", "version", "attempt", "dependencies", "inputs", "workspace", "artifacts", "result", "reason", "next", "createdAt", "updatedAt"], ["parentId", "archived", "archiveRoot"]);
  identifier(value.id, "INVALID_STATE"); text(value.title, "title", false, "INVALID_STATE");
  for (const key of ["description", "reason", "next"]) text(value[key], key, true, "INVALID_STATE");
  requireThat(STATES.includes(value.state as Progress), "INVALID_STATE", "Unknown task state.");
  if (value.parentId !== undefined) {
    identifier(value.parentId, "INVALID_STATE");
    requireThat(value.parentId !== value.id && value.archived === undefined, "INVALID_STATE", "Invalid child task or child archive.");
  }
  if (value.archiveRoot !== undefined) requireThat(value.archiveRoot === ARCHIVE_ROOT && value.archived === true, "INVALID_STATE", "Invalid task archive root.");
  if (value.archived !== undefined) requireThat(typeof value.archived === "boolean" && (!value.archived || value.state === "completed" && (value.id !== LEGACY_ARCHIVE_ROOT || value.archiveRoot === ARCHIVE_ROOT)), "INVALID_STATE", "Only completed task documents can be archived.");
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
  object(value); keys(value, ["schemaVersion", "projectId", "storeId", "revision", "tasks", "checkpoints", "operations"], ["pendingDirectoryMove"]);
  requireThat(value.schemaVersion === 1 && value.projectId === project, "INVALID_STATE", "Unsupported schema or project identity mismatch.");
  identifier(project, "INVALID_STATE"); text(value.storeId, "storeId", false, "INVALID_STATE"); number(value.revision, "INVALID_STATE", true);
  object(value.tasks); object(value.checkpoints); object(value.operations);
  for (const [id, task] of Object.entries(value.tasks)) {
    validateTask(task, project); requireThat(task.id === id, "INVALID_STATE", "Task key mismatch.");
    for (const dependency of task.dependencies) requireThat(Object.hasOwn(value.tasks, dependency), "INVALID_STATE", "A dependency does not exist.");
  }
  const state = value as unknown as State;
  for (const task of Object.values(state.tasks)) {
    if (!task.parentId) continue;
    const parent = state.tasks[task.parentId];
    requireThat(parent && !parent.parentId, "INVALID_STATE", "A child task requires an existing top-level parent.");
    requireThat(!terminal(parent) || terminal(task), "INVALID_STATE", "A closed parent cannot have open child tasks.");
  }
  requireAcyclic(state);
  for (const [key, entry] of Object.entries(value.checkpoints)) {
    checkpoint(entry, project);
    requireThat(key === entry.taskId + "/" + entry.id && Object.hasOwn(state.tasks, entry.taskId) && entry.taskVersion <= state.tasks[entry.taskId]!.version, "INVALID_STATE", "Invalid checkpoint reference.");
    requireThat(entry.snapshot.parentId === state.tasks[entry.taskId]!.parentId, "INVALID_STATE", "Checkpoint snapshot parent mismatch.");
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
    requireThat(op.data.task.parentId === state.tasks[op.taskId]!.parentId, "INVALID_STATE", "Operation snapshot parent mismatch.");
    if (op.data.checkpoint !== undefined) {
      checkpoint(op.data.checkpoint, project);
      const saved = state.checkpoints[op.data.checkpoint.taskId + "/" + op.data.checkpoint.id];
      requireThat(saved && JSON.stringify(saved) === JSON.stringify(op.data.checkpoint), "INVALID_STATE", "Operation checkpoint does not match its snapshot.");
    }
  }
  requireThat(revisions.size === state.revision, "INVALID_STATE", "Incomplete operation history.");
  if (value.pendingDirectoryMove !== undefined) {
    const move = value.pendingDirectoryMove;
    object(move); keys(move, ["taskId", "operationId", "archive", "device", "inode"], ["archiveRoot"]);
    identifier(move.taskId, "INVALID_STATE"); identifier(move.operationId, "INVALID_STATE");
    requireThat(typeof move.archive === "boolean" && (move.archiveRoot === ARCHIVE_ROOT || move.archiveRoot === undefined && !Object.hasOwn(state.tasks, LEGACY_ARCHIVE_ROOT)), "INVALID_STATE", "Invalid task directory move.");
    for (const field of [move.device, move.inode]) requireThat(typeof field === "string" && /^[0-9]+$/.test(field), "INVALID_STATE", "Invalid directory identity.");
    const op = state.operations[move.operationId], task = state.tasks[move.taskId];
    requireThat(op && task && op.taskId === task.id && op.revision === state.revision && op.data.task.archived === move.archive && task.archived === move.archive && (move.archive ? ["task complete", "task archive"] : ["task reopen"]).includes(op.command), "INVALID_STATE", "Directory move does not match the saved operation.");
    if (move.archive) requireThat(task.archiveRoot === move.archiveRoot && op.data.task.archiveRoot === move.archiveRoot, "INVALID_STATE", "Directory move does not match the archive root.");
  }
  return state;
}

export function taskDirectory(project: string, id: string, archiveRoot?: ArchiveRoot) {
  return ".space/" + project + "/tasks/" + (archiveRoot ? archiveRoot + "/" : "") + id;
}
export function taskArchiveRoot(task: Task): ArchiveRoot | undefined {
  return task.archived ? task.archiveRoot ?? LEGACY_ARCHIVE_ROOT : undefined;
}
export function taskMovePaths(project: string, { taskId, archive, archiveRoot }: Pick<DirectoryMove, "taskId" | "archive" | "archiveRoot">) {
  const active = taskDirectory(project, taskId);
  const archived = taskDirectory(project, taskId, archiveRoot ?? LEGACY_ARCHIVE_ROOT);
  return archive ? [active, archived] as const : [archived, active] as const;
}
export function currentReference(state: State, ref: string): string {
  const prefix = ".space/" + state.projectId + "/tasks/";
  if (!ref.startsWith(prefix)) return ref;
  const parts = ref.slice(prefix.length).split("/");
  const first = parts[0];
  const archiveRoot = first === ARCHIVE_ROOT || first === LEGACY_ARCHIVE_ROOT && !Object.hasOwn(state.tasks, LEGACY_ARCHIVE_ROOT) ? first : undefined;
  const id = parts[archiveRoot ? 1 : 0];
  if (!id || !Object.hasOwn(state.tasks, id)) return ref;
  const task = state.tasks[id]!;
  const currentRoot = taskArchiveRoot(task);
  if (task.archived === undefined || currentRoot === archiveRoot) return ref;
  return taskDirectory(state.projectId, id, currentRoot) + ref.slice(taskDirectory(state.projectId, id, archiveRoot).length);
}

export function terminal(task: Task) {
  return task.state === "completed" || task.state === "cancelled";
}

export function childrenByParent(state: State): Map<string, Task[]> {
  const children = new Map<string, Task[]>();
  for (const task of Object.values(state.tasks)) {
    if (!task.parentId) continue;
    const siblings = children.get(task.parentId);
    if (siblings) siblings.push(task);
    else children.set(task.parentId, [task]);
  }
  return children;
}

export function requireAcyclic(state: State, code = "INVALID_STATE") {
  const children = childrenByParent(state);
  const visited = new Set<string>(), visiting = new Set<string>();
  function visit(id: string) {
    requireThat(!visiting.has(id), code, "Dependencies and child completion requirements form a cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    state.tasks[id]!.dependencies.forEach(visit);
    for (const child of children.get(id) ?? []) visit(child.id);
    visiting.delete(id);
    visited.add(id);
  }
  Object.keys(state.tasks).forEach(visit);
}

export function describeTasks(state: State) {
  const children = childrenByParent(state);
  const memo = new Map<string, boolean>();
  function completed(id: string): boolean {
    if (memo.has(id)) return memo.get(id)!;
    const task = state.tasks[id]!;
    const valid = task.state === "completed" && blockers(task).length === 0 && incompleteChildren(task).length === 0;
    memo.set(id, valid); return valid;
  }
  function blockers(task: Task) {
    return task.dependencies.filter(id => !completed(id) || task.inputs !== null && task.inputs[id] !== state.tasks[id]!.version);
  }
  function incompleteChildren(task: Task) {
    return (children.get(task.id) ?? []).filter(child => child.state !== "cancelled" && !completed(child.id)).map(child => child.id);
  }
  return (task: Task) => {
    const blockedBy = blockers(task);
    const childIds = (children.get(task.id) ?? []).map(child => child.id);
    const unfinished = incompleteChildren(task);
    const move = state.pendingDirectoryMove;
    return {
      task, blockedBy,
      ready: task.state === "pending" && blockedBy.length === 0,
      completionCurrent: task.state === "completed" && blockedBy.length === 0 && unfinished.length === 0,
      ...(childIds.length ? { childIds, incompleteChildren: unfinished } : {}),
      ...(move?.taskId === (task.parentId ?? task.id) ? { pendingDirectoryMove: move } : {}),
    };
  };
}
