import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { MonorepoError, requireThat } from "./model.ts";

export async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
export async function rootPath(input: string, create = false): Promise<string> {
  const path = resolve(input);
  if (create) await mkdir(path, { recursive: true });
  requireThat(await exists(path), "NOT_INITIALIZED", "The root directory does not exist. Run setup first.");
  const canonical = await realpath(path);
  requireThat((await lstat(canonical)).isDirectory(), "INVALID_PATH", "The root must be a directory.");
  return canonical;
}
export async function safePath(root: string, ...parts: string[]): Promise<string> {
  const target = resolve(root, ...parts), rel = relative(root, target);
  requireThat(rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), "UNSAFE_PATH", "Path escapes the selected root.");
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      requireThat(!info.isSymbolicLink(), "UNSAFE_PATH", "Managed paths must not contain symbolic links.");
      if (current !== target) requireThat(info.isDirectory(), "UNSAFE_PATH", "A managed parent path is not a directory.");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return target;
}
export async function directory(root: string, ...parts: string[]): Promise<string> {
  const path = await safePath(root, ...parts);
  await mkdir(path, { recursive: true });
  await safePath(root, ...parts);
  requireThat((await lstat(path)).isDirectory(), "UNSAFE_PATH", "Expected a managed directory.");
  return path;
}
export async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new MonorepoError("NOT_INITIALIZED", "Management data is missing. Run setup or inspect the selected root.");
    if (error instanceof SyntaxError) throw new MonorepoError("INVALID_STATE", "Management data is not valid JSON.");
    throw error;
  }
}
export async function saveJson(root: string, path: string, value: unknown): Promise<void> {
  await safePath(root, path);
  const temporary = join(dirname(path), `.monorepo-${crypto.randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
      await handle.sync();
    } finally { await handle.close(); }
    await safePath(root, path);
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
export async function locked<T>(root: string, operation: string, action: () => Promise<T>): Promise<T> {
  await directory(root, ".space");
  const path = await safePath(root, ".space", "monorepo.lock");
  let handle;
  try { handle = await open(path, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new MonorepoError("LOCKED", "Another operation holds the root lock. If interrupted, confirm its process has stopped before removing .space/monorepo.lock.");
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, operation, startedAt: new Date().toISOString() }) + "\n");
    return await action();
  } finally { await handle.close(); await rm(path); }
}
