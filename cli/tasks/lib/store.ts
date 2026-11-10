import { link, lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { childrenByParent, identifier, requireThat, taskArchiveRoot, taskDirectory, taskMovePaths, TasksError, validateState, type Checkpoint, type DirectoryMove, type State, type Task } from "./model.ts";
import { SUMMARY_FILE, SUMMARY_MARKER, taskSummary } from "./summary.ts";

export async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
export async function safePath(root: string, ...parts: string[]): Promise<string> {
  const target = resolve(root, ...parts), rel = relative(root, target);
  requireThat(rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel), "UNSAFE_PATH", "Path escapes the selected root.");
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      requireThat(!info.isSymbolicLink(), "UNSAFE_PATH", "Managed paths must not contain symbolic links.");
      requireThat(current === target ? info.isFile() || info.isDirectory() : info.isDirectory(), "UNSAFE_PATH", "Invalid managed path.");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return target;
}
async function directory(root: string, path: string) {
  await safePath(root, path); await mkdir(path, { recursive: true }); await safePath(root, path);
  requireThat((await lstat(path)).isDirectory(), "UNSAFE_PATH", "Expected a directory.");
}
async function syncDirectory(path: string) {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
export class Store {
  readonly path: string;
  readonly lockPath: string;
  readonly directory: string;
  constructor(readonly root: string, readonly project: string) {
    this.directory = join(root, ".space", project, "tasks");
    this.path = join(this.directory, "state.json");
    this.lockPath = join(this.directory, ".tasks.lock");
  }
  static async open(input: string, project: string, create = false): Promise<Store> {
    identifier(project);
    const path = resolve(input);
    if (create) await mkdir(path, { recursive: true });
    requireThat(await exists(path), "NOT_INITIALIZED", "The root does not exist. Run setup explicitly.");
    const root = await realpath(path);
    requireThat((await lstat(root)).isDirectory(), "UNSAFE_PATH", "The root must be a directory.");
    const store = new Store(root, project);
    await safePath(root, store.directory);
    return store;
  }
  async load(): Promise<State> {
    await safePath(this.root, this.path);
    let value: unknown;
    try { value = JSON.parse(await readFile(this.path, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new TasksError("NOT_INITIALIZED", "Initialize Tasks for this project with setup.");
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "EISDIR") throw new TasksError("INVALID_STATE", "Cannot read valid Tasks management data.");
      throw error;
    }
    return validateState(value, this.project);
  }
  async transact<T>(action: () => Promise<{ state: State; result: T; unchanged?: boolean }>, options: { initialize?: boolean; beforeReplace?: () => Promise<void>; operationId?: string } = {}): Promise<T> {
    if (options.initialize) await directory(this.root, this.directory);
    await safePath(this.root, this.lockPath);
    let lock;
    try { lock = await open(this.lockPath, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new TasksError("LOCKED", "This project is being updated. Retry the same operation after its writer finishes.", 3);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new TasksError("NOT_INITIALIZED", "Initialize Tasks for this project with setup.");
      throw error;
    }
    const temporary = join(this.directory, ".tasks-" + crypto.randomUUID() + ".tmp");
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n");
      await lock.sync();
      const { state, result, unchanged } = await action();
      const save = async (beforeReplace?: () => Promise<void>) => {
        validateState(state, this.project);
        const file = await open(temporary, "wx", 0o600);
        try { await file.writeFile(JSON.stringify(state, null, 2) + "\n"); await file.sync(); } finally { await file.close(); }
        await beforeReplace?.();
        await safePath(this.root, this.path);
        await rename(temporary, this.path);
        await syncDirectory(this.directory);
      };
      if (!unchanged) await save(options.beforeReplace);
      const move = state.pendingDirectoryMove;
      if (move) {
        try {
          await this.moveTaskDirectory(move);
          delete state.pendingDirectoryMove;
          await save();
        } catch (error) {
          throw new TasksError("TASK_DIRECTORY_MOVE_FAILED", "Task state is saved, but its directory move is incomplete. Resolve the conflict and retry the identical operation.", 1, { saved: true, taskId: move.taskId, operationId: move.operationId, cause: error instanceof TasksError ? error.code : "IO_ERROR" });
        }
      }
      if (options.operationId) {
        const { taskId } = state.operations[options.operationId]!;
        const summaryTask = state.tasks[state.tasks[taskId]!.parentId ?? taskId]!;
        try { await this.publishTaskSummary(summaryTask, childrenByParent(state).get(summaryTask.id) ?? []); }
        catch (error) {
          throw new TasksError("TASK_SUMMARY_OUTPUT_FAILED", "Task state is saved, but its Markdown summary could not be written. Resolve the output problem and retry the identical operation.", 1, { saved: true, taskId, summaryTaskId: summaryTask.id, operationId: options.operationId, cause: error instanceof TasksError ? error.code : "IO_ERROR" });
        }
      }
      return result;
    } finally {
      await rm(temporary, { force: true });
      await lock.close();
      await rm(this.lockPath);
    }
  }
  async setup() {
    return this.transact(async () => {
      if (await exists(this.path)) {
        const state = await this.load();
        this.requireDirectoryMoveRetry(state);
        return { state, unchanged: true, result: { revision: state.revision, data: { project: this.project, store: this.path, changed: false } } };
      }
      const state: State = { schemaVersion: 1, projectId: this.project, storeId: crypto.randomUUID(), revision: 0, tasks: {}, checkpoints: {}, operations: {} };
      return { state, result: { revision: 0, data: { project: this.project, store: this.path, changed: true } } };
    }, { initialize: true });
  }
  requireDirectoryMoveRetry(state: State, operationId?: string) {
    const move = state.pendingDirectoryMove;
    if (move && move.operationId !== operationId) throw new TasksError("TASK_DIRECTORY_MOVE_PENDING", "Retry the saved directory move with its original operation ID and input before other updates.", 2, { saved: true, taskId: move.taskId, operationId: move.operationId });
  }
  async planTaskDirectoryMove(state: State, taskId: string, archive: boolean, operationId: string, archiveRoot?: DirectoryMove["archiveRoot"]): Promise<DirectoryMove | undefined> {
    requireThat(archiveRoot || !Object.hasOwn(state.tasks, "archive"), "TASK_DIRECTORY_CONFLICT", "A legacy task uses the reserved archive name. Resolve its directory ownership before moving documents.");
    const [from, to] = taskMovePaths(this.project, { taskId, archive, archiveRoot });
    const source = await safePath(this.root, from);
    const target = await safePath(this.root, to);
    requireThat(!await exists(target), "TASK_DIRECTORY_CONFLICT", "The destination already exists; it will not be replaced or merged.");
    if (!await exists(source)) return undefined;
    const info = await lstat(source, { bigint: true });
    requireThat(info.isDirectory(), "UNSAFE_PATH", "Task documents must be a directory.");
    return { taskId, operationId, archive, ...(archiveRoot ? { archiveRoot } : {}), device: String(info.dev), inode: String(info.ino) };
  }
  async moveTaskDirectory(move: DirectoryMove) {
    const [from, to] = taskMovePaths(this.project, move);
    const source = await safePath(this.root, from);
    const target = await safePath(this.root, to);
    const sourceExists = await exists(source), targetExists = await exists(target);
    requireThat(sourceExists !== targetExists, "TASK_DIRECTORY_CONFLICT", "Expected exactly one copy of the task directory; neither location will be overwritten.");
    const info = await lstat(sourceExists ? source : target, { bigint: true });
    requireThat(info.isDirectory() && String(info.dev) === move.device && String(info.ino) === move.inode, "TASK_DIRECTORY_CONFLICT", "The directory changed since the move was recorded.");
    if (sourceExists) {
      await directory(this.root, dirname(target));
      await safePath(this.root, source); await safePath(this.root, target);
      const current = await lstat(source, { bigint: true });
      requireThat(current.isDirectory() && String(current.dev) === move.device && String(current.ino) === move.inode, "TASK_DIRECTORY_CONFLICT", "The source directory changed before moving.");
      requireThat(!await exists(target), "TASK_DIRECTORY_CONFLICT", "The destination already exists; it will not be replaced.");
      await rename(source, target);
    }
    await syncDirectory(dirname(source));
    await syncDirectory(dirname(target));
  }
  async checkTaskSummary(task: Task) {
    const path = await safePath(this.root, taskDirectory(this.project, task.id, taskArchiveRoot(task)), SUMMARY_FILE);
    if (!await exists(path)) return { path, previous: undefined };
    requireThat((await lstat(path)).isFile(), "TASK_SUMMARY_FILE_CONFLICT", "Expected a Markdown file at the task summary path.");
    const previous = await readFile(path, "utf8");
    requireThat(previous.startsWith(SUMMARY_MARKER), "TASK_SUMMARY_FILE_CONFLICT", "An existing Markdown file is not managed by Tasks; it was not overwritten.");
    return { path, previous };
  }
  async publishTaskSummary(task: Task, children: Task[]) {
    const { path, previous } = await this.checkTaskSummary(task);
    const body = taskSummary(task, children);
    if (previous === body) return;
    const folder = dirname(path);
    await directory(this.root, folder);
    const temporary = join(folder, ".tasks-" + crypto.randomUUID() + ".tmp");
    try {
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(body); await file.sync(); } finally { await file.close(); }
      const current = await this.checkTaskSummary(task);
      requireThat(current.previous === previous, "TASK_SUMMARY_FILE_CONFLICT", "The Markdown file changed during publication; it was not overwritten.");
      if (previous === undefined) await link(temporary, path);
      else await rename(temporary, path);
      await syncDirectory(folder);
    } finally { await rm(temporary, { force: true }); }
  }
  async checkpointPath(entry: Pick<Checkpoint, "taskId" | "id">) {
    identifier(entry.taskId); identifier(entry.id);
    return safePath(this.root, ".space", this.project, "checkpoint", entry.taskId, entry.id + ".json");
  }
  checkpointContent(entry: Checkpoint) {
    return JSON.stringify({ schemaVersion: 1, projectId: this.project, ...entry }, null, 2) + "\n";
  }
  async publishCheckpoint(entry: Checkpoint) {
    const path = await this.checkpointPath(entry), body = this.checkpointContent(entry);
    await directory(this.root, dirname(path));
    const temporary = join(dirname(path), ".checkpoint-" + crypto.randomUUID() + ".tmp");
    try {
      if (await exists(path)) {
        requireThat((await lstat(path)).isFile() && await readFile(path, "utf8") === body, "CHECKPOINT_FILE_CONFLICT", "An existing checkpoint file differs; it was not overwritten.");
        return;
      }
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(body); await file.sync(); } finally { await file.close(); }
      await safePath(this.root, path);
      try { await link(temporary, path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await safePath(this.root, path);
        requireThat((await lstat(path)).isFile() && await readFile(path, "utf8") === body, "CHECKPOINT_FILE_CONFLICT", "An existing checkpoint file differs; it was not overwritten.");
      }
      await syncDirectory(dirname(path));
    } finally { await rm(temporary, { force: true }); }
  }
  async doctor(state: State) {
    const problems: { code: string; checkpoint?: string; task?: string; operationId?: string }[] = [];
    await safePath(this.root, this.lockPath);
    if (await exists(this.lockPath)) problems.push({ code: "LOCKED" });
    if (state.pendingDirectoryMove) problems.push({ code: "TASK_DIRECTORY_MOVE_PENDING", task: state.pendingDirectoryMove.taskId, operationId: state.pendingDirectoryMove.operationId });
    for (const [id, entry] of Object.entries(state.checkpoints)) {
      try {
        const path = await this.checkpointPath(entry);
        if (!await exists(path)) problems.push({ code: "CHECKPOINT_OUTPUT_MISSING", checkpoint: id });
        else if (!(await lstat(path)).isFile() || await readFile(path, "utf8") !== this.checkpointContent(entry)) problems.push({ code: "CHECKPOINT_OUTPUT_CHANGED", checkpoint: id });
      } catch (error) {
        problems.push({ code: error instanceof TasksError ? error.code : "CHECKPOINT_OUTPUT_UNREADABLE", checkpoint: id });
      }
    }
    return { healthy: problems.length === 0, project: this.project, problems };
  }
}
