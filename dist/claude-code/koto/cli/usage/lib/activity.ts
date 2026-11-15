import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

export type Component = "tasks" | "memory" | "recall";
export type Activity = {
  component: Component; operation: string; outcome: "success" | "failure";
  task_id?: string; replayed?: boolean; concept_ids?: string[];
};
export type ActivityEvent = Activity & { schema_version: 1; id: string; at: string; project: string };
export type ActivityTarget = { root: string; project: string; activity: Activity };
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isMissing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";
export function projectId(value: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) || ["constructor", "prototype"].includes(value)) throw new Error("Invalid project or task ID.");
}
export async function directory(root: string, project: string, parts: string[], create = false): Promise<string | undefined> {
  projectId(project);
  if (!root.trim()) throw new Error("--root must be a directory.");
  let path = await realpath(resolve(root));
  if (!(await lstat(path)).isDirectory()) throw new Error("--root must be a directory.");
  for (const part of [".space", project, ...parts]) {
    if (!part || part === "." || part === ".." || /[/\\\0]/.test(part)) throw new Error("Invalid activity path.");
    path = join(path, part);
    if (create) { try { await mkdir(path); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; } }
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Activity paths must be real directories.");
    } catch (e) { if (!create && isMissing(e)) return undefined; throw e; }
  }
  return path;
}
export async function readJSON(path: string): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > 4 * 1024 * 1024) throw new Error("Activity data must be a regular file of at most 4 MiB.");
    const buffer = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    const after = await file.stat();
    if (size !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Activity data changed while reading.");
    return JSON.parse(buffer.subarray(0, size).toString("utf8"));
  } finally { await file.close(); }
}
export async function configuration(root: string, project: string) {
  const dir = await directory(root, project, ["usage"]);
  if (!dir) return { enabled: false, updated_at: null };
  let value: unknown;
  try { value = await readJSON(join(dir, "config.json")); } catch (e) { if (isMissing(e)) return { enabled: false, updated_at: null }; throw e; }
  const data = value as Record<string, unknown> | null;
  if (!data || data.schema_version !== 1 || typeof data.enabled !== "boolean" || typeof data.updated_at !== "string" || !Number.isFinite(Date.parse(data.updated_at))) throw new Error("Invalid activity configuration.");
  return { enabled: data.enabled, updated_at: data.updated_at };
}
async function publish(dir: string, name: string, value: unknown, replace = false) {
  const body = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw new Error("Activity data exceeds 4 MiB.");
  const temporary = join(dir, `.pending-${crypto.randomUUID()}`);
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(body); await file.sync(); }
  finally { await file.close(); }
  try { if (replace) await rename(temporary, join(dir, name)); else await link(temporary, join(dir, name)); }
  finally { try { await unlink(temporary); } catch (e) { if (!isMissing(e)) throw e; } }
}
export async function setEnabled(root: string, project: string, enabled: boolean) {
  await configuration(root, project);
  const dir = await directory(root, project, ["usage"], true);
  const config = { schema_version: 1, enabled, updated_at: new Date().toISOString() };
  await publish(dir!, "config.json", config, true);
  return config;
}
export async function recordActivity(target: ActivityTarget, id: string = crypto.randomUUID()): Promise<{ recorded: boolean; id?: string; replayed?: boolean }> {
  if (!uuidPattern.test(id)) throw new Error("--id must be a lowercase UUID v4.");
  if (!(await configuration(target.root, target.project)).enabled) return { recorded: false };
  const dir = await directory(target.root, target.project, ["usage", "events"], true);
  const event: ActivityEvent = { schema_version: 1, id, at: new Date().toISOString(), project: target.project, ...target.activity };
  try { await publish(dir!, `${id}.json`, event); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const previous = await readJSON(join(dir!, `${id}.json`)) as ActivityEvent;
    const comparable = (value: ActivityEvent) => Object.entries(value).filter(([key]) => key !== "at").sort(([a], [b]) => a.localeCompare(b));
    if (JSON.stringify(comparable(previous)) !== JSON.stringify(comparable(event))) throw new Error("Activity ID already has a different event.");
    return { recorded: true, id, replayed: true };
  }
  return { recorded: true, id };
}
export async function recordActivitySafely(target: ActivityTarget | undefined) {
  if (!target) return;
  try { await recordActivity(target); }
  catch (e) { if (!isMissing(e)) process.stderr.write("Warning: Activity was not recorded. Check the project's usage configuration and filesystem access.\n"); }
}
export async function eventNames(root: string, project: string) {
  const dir = await directory(root, project, ["usage", "events"]);
  return { dir, names: dir ? await readdir(dir) : [] };
}
