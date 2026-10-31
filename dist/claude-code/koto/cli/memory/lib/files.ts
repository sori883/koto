import { MemoryError } from "./errors.ts";
import { constants, type Stats } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const maxFileBytes = 16 * 1024 * 1024;
export class MissingPath extends Error {
  constructor(readonly relative: string) { super(`Path does not exist (names are case-sensitive): ${relative}`); }
}
export class WriteError extends Error {
  constructor(cause: unknown, readonly writtenPaths: readonly string[]) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}
export type FileChange = { relative: string; before: string | undefined; after: string } | { relative: string; before: string; after: null };
export function validateProject(project: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(project) || ["constructor", "prototype"].includes(project)) throw new Error("project: use 1–64 lowercase ASCII letters, digits, '_' or '-', starting with a letter or digit.");
}
export const hasCode = (error: unknown, code: string) => error !== null && typeof error === "object" && "code" in error && error.code === code;
const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export async function openProjectFiles(root: string, project = "default", initialize = false) {
  if (!root.trim()) throw new Error("--root requires a nonempty directory path.");
  validateProject(project);
  const base = await realpath(resolve(root));
  const baseStat = await lstat(base);
  if (!baseStat.isDirectory()) throw new Error("--root must be a directory.");
  const prefix = `.space/${project}/memory`;
  function relativePath(relative: string): string {
    if (!relative || relative.split("/").some(part => !part || part === "." || part === "..") || /[\\\u0000-\u001f\u007f]/.test(relative)) throw new Error("Invalid memory-relative path.");
    return `${prefix}/${relative}`;
  }
  async function checked(relative: string, directory: boolean, create = false) {
    const parts = relative.split("/");
    const chain: { path: string; stat: Stats }[] = [{ path: base, stat: baseStat }];
    let path = base;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === undefined) throw new Error("Invalid internal path.");
      const parent = path;
      if (!(await readdir(parent)).includes(part)) {
        if (!create || (!directory && i === parts.length - 1)) throw new MissingPath(parts.slice(0, i + 1).join("/"));
        try { await mkdir(join(parent, part)); }
        catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
        if (!(await readdir(parent)).includes(part)) throw new Error(`Directory name differs in case: ${relative}`);
      }
      path = join(parent, part);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${parts.slice(0, i + 1).join("/")}`);
      if (i < parts.length - 1 || directory) {
        if (!stat.isDirectory()) throw new Error(`Expected directory: ${relative}`);
      } else if (!stat.isFile()) throw new Error(`Expected regular file: ${relative}`);
      chain.push({ path, stat });
    }
    async function verify() {
      for (const entry of chain) {
        const current = await lstat(entry.path);
        if (current.isSymbolicLink() || !sameFile(current, entry.stat)) throw new Error(`Path changed during operation: ${relative}`);
      }
    }
    await verify();
    const final = chain.at(-1);
    if (!final) throw new Error("Invalid internal path.");
    return { path, stat: final.stat, verify };
  }
  await checked(prefix, true, initialize);

  async function read(relative: string, byteLimit = maxFileBytes): Promise<string> {
    const target = await checked(relativePath(relative), false);
    const handle = await open(target.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat();
      if (!before.isFile() || !sameFile(before, target.stat)) throw new Error(`File changed before reading: ${relative}`);
      if (before.size > byteLimit) throw new Error(`File exceeds 16 MiB (or journal limit): ${relative}`);
      await target.verify();
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, byteLimit + 1 - total));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > byteLimit) throw new Error(`File exceeds 16 MiB (or journal limit): ${relative}`);
        chunks.push(buffer.subarray(0, bytesRead));
      }
      const after = await handle.stat();
      await target.verify();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error(`File changed during reading: ${relative}`);
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, total));
    } finally { await handle.close(); }
  }
  async function optionalRead(relative: string, byteLimit = maxFileBytes): Promise<string | undefined> {
    try { return await read(relative, byteLimit); }
    catch (error) {
      if (error instanceof MissingPath && error.relative.startsWith(`${prefix}/`)) return undefined;
      throw error;
    }
  }
  async function entries(relative: string) {
    const full = relativePath(relative);
    try {
      const dir = await checked(full, true);
      const values = await readdir(dir.path, { withFileTypes: true });
      await dir.verify();
      return values.sort((a, b) => compare(a.name, b.name));
    } catch (error) {
      if (error instanceof MissingPath && error.relative === full) return [];
      throw error;
    }
  }

  async function withWriteLock<T>(operation: (apply: (changes: readonly FileChange[]) => Promise<string[]>) => Promise<T>, recovering = false): Promise<T> {
    const written: string[] = [];
    let outcome: { ok: true; value: T } | { ok: false; error: unknown } = { ok: false, error: new Error("Write did not complete.") };
    let owner: Stats | undefined;
    let ownerText: string | undefined;
    const lockRelative = ".okf-write-lock";
    const lock = join(base, prefix, lockRelative);
    try {
      const memory = await checked(prefix, true);
      try { await mkdir(lock); }
      catch (error) {
        if (hasCode(error, "EEXIST")) throw new Error("Another mutation owns .okf-write-lock; retry after it completes. Stale locks require manual recovery.");
        throw error;
      }
      owner = await lstat(lock);
      await memory.verify();
      const lockDir = await checked(`${prefix}/${lockRelative}`, true);
      if (!sameFile(owner, lockDir.stat)) throw new Error("Write lock changed during acquisition.");
      const text = `${JSON.stringify({ pid: process.pid, token: crypto.randomUUID(), started_at: new Date().toISOString() })}\n`;
      const ownerFile = await open(join(lock, "owner.json"), "wx", 0o600);
      try { await ownerFile.writeFile(text); await ownerFile.sync(); ownerText = text; }
      finally { await ownerFile.close(); }
      async function verifyLock() {
        const current = await checked(`${prefix}/${lockRelative}`, true);
        if (!owner || !sameFile(current.stat, owner) || await read(`${lockRelative}/owner.json`) !== ownerText) throw new Error("Write lock ownership changed.");
      }
      async function publish(changes: readonly FileChange[]): Promise<string[]> {
        await verifyLock();
        const seen = new Set<string>();
        for (const change of changes) {
          relativePath(change.relative);
          if (seen.has(change.relative)) throw new Error(`Duplicate change: ${change.relative}`);
          seen.add(change.relative);
          if (change.after !== null && Buffer.byteLength(change.after, "utf8") > maxFileBytes) throw new Error(`File exceeds 16 MiB: ${change.relative}`);
          if (await optionalRead(change.relative) !== change.before) throw new Error(`File changed during operation: ${change.relative}`);
        }
        const changed: string[] = [];
        for (const change of changes) {
          if (change.after === change.before) continue;
          await verifyLock();
          const targetRelative = relativePath(change.relative);
          if (change.after === null) {
            const target = await checked(targetRelative, false);
            if (await read(change.relative) !== change.before) throw new Error(`File changed during operation: ${change.relative}`);
            await target.verify();
            await unlink(target.path);
            written.push(change.relative); changed.push(change.relative);
            await syncDirectory(dirname(target.path));
            continue;
          }
          const parent = await checked(dirname(targetRelative), true, true);
          const target = join(base, targetRelative);
          const temporary = join(parent.path, `.koto-memory-${crypto.randomUUID()}.tmp`);
          const existing = change.before === undefined ? undefined : await checked(targetRelative, false);
          let temporaryStat: Stats | undefined;
          try {
            const file = await open(temporary, "wx", existing ? existing.stat.mode & 0o777 : 0o644);
            try {
              if (existing) await file.chmod(existing.stat.mode & 0o777);
              temporaryStat = await file.stat();
              await file.writeFile(change.after); await file.sync();
            } finally { await file.close(); }
            await parent.verify();
            if (await optionalRead(change.relative) !== change.before) throw new Error(`File changed during operation: ${change.relative}`);
            await parent.verify();
            if (change.before === undefined) await link(temporary, target);
            else { await existing?.verify(); await rename(temporary, target); }
            written.push(change.relative); changed.push(change.relative);
            await syncDirectory(parent.path);
          } finally {
            if (temporaryStat) {
              await parent.verify();
              try {
                const current = await lstat(temporary);
                if (current.isSymbolicLink() || !sameFile(current, temporaryStat)) throw new Error("Temporary file changed before cleanup.");
                await unlink(temporary);
              } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
            }
          }
        }
        return changed;
      }
      async function apply(changes: readonly FileChange[]): Promise<string[]> {
        await verifyLock();
        const existing = recovering ? await journal() : undefined;
        let pending = [...changes];
        let raw: string;
        if (existing) {
          if (JSON.stringify(changes) !== JSON.stringify(existing.changes)) throw new MemoryError("RECOVERY_CONFLICT", "Recovery plan changed.");
          pending = await remaining(existing.changes);
          raw = existing.raw;
        } else {
          await assertReady();
          validateChanges(changes);
          for (const change of changes) if (await optionalRead(change.relative) !== change.before) throw new Error(`File changed during operation: ${change.relative}`);
          if (!changes.some(change => change.before !== change.after)) return [];
          raw = JSON.stringify({ schemaVersion: 1, project, changes });
          if (Buffer.byteLength(raw) > journalLimit) throw new Error("Recovery journal exceeds 64 MiB; split this operation.");
          const directory = await checked(prefix, true);
          const temp = join(directory.path, `.koto-memory-${crypto.randomUUID()}.tmp`);
          const handle = await open(temp, "wx", 0o600);
          const stat = await handle.stat();
          try {
            await handle.writeFile(raw); await handle.sync();
            await directory.verify(); await verifyLock();
            await link(temp, join(directory.path, journalName));
            await syncDirectory(directory.path);
          } finally {
            await handle.close(); await directory.verify();
            if (!sameFile(await lstat(temp), stat)) throw new Error("Journal temporary file changed.");
            await unlink(temp);
          }
        }
        const result = await publish(pending);
        await verifyLock();
        const target = await checked(relativePath(journalName), false);
        if (await read(journalName, journalLimit) !== raw) throw new MemoryError("RECOVERY_CONFLICT", "Recovery journal changed during publication.");
        await target.verify(); await unlink(target.path); await syncDirectory(dirname(target.path));
        return result;
      }
      if (!recovering) await assertReady();
      outcome = { ok: true, value: await operation(apply) };
    } catch (error) { outcome = { ok: false, error }; }
    finally {
      if (owner) {
        try {
          const current = await checked(`${prefix}/${lockRelative}`, true);
          if (!sameFile(current.stat, owner)) throw new Error("Write lock changed before release.");
          if (ownerText !== undefined) {
            if (await read(`${lockRelative}/owner.json`) !== ownerText) throw new Error("Write lock owner changed before release.");
            await unlink(join(lock, "owner.json"));
          }
          await current.verify();
          await rmdir(lock);
        } catch (error) {
          outcome = { ok: false, error: outcome.ok ? error : new Error(`${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}; lock cleanup failed: ${error instanceof Error ? error.message : String(error)}`) };
        }
      }
    }
    if (!outcome.ok) throw new WriteError(outcome.error, [...written]);
    return outcome.value;
  }
  const journalName = ".memory-pending.json", journalLimit = 64 * 1024 * 1024;
  async function syncDirectory(path: string) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
  }
  function validateChanges(changes: readonly FileChange[]) {
    if (!Array.isArray(changes) || changes.length > 100_000) throw new Error("Invalid recovery changes.");
    const paths = new Set<string>();
    for (const change of changes) {
      if (!change || typeof change.relative !== "string" || (change.before !== undefined && typeof change.before !== "string") || (change.after !== null && typeof change.after !== "string") || (change.after === null && change.before === undefined)) throw new Error("Invalid recovery change.");
      relativePath(change.relative);
      if (change.relative.split("/").some((part: string) => part.startsWith(".")) || paths.has(change.relative)) throw new Error("Reserved or duplicate recovery path.");
      paths.add(change.relative);
      for (const value of [change.before, change.after]) if (typeof value === "string" && Buffer.byteLength(value) > maxFileBytes) throw new Error("File exceeds 16 MiB.");
    }
  }
  async function journal() {
    const raw = await optionalRead(journalName, journalLimit);
    if (raw === undefined) return undefined;
    const value = JSON.parse(raw);
    if (!value || value.schemaVersion !== 1 || value.project !== project) throw new MemoryError("RECOVERY_CONFLICT", "Unknown or mismatched recovery journal.");
    validateChanges(value.changes);
    return { raw, changes: value.changes as FileChange[] };
  }
  async function assertReady() {
    if (await optionalRead(journalName, journalLimit) !== undefined) throw new MemoryError("RECOVERY_REQUIRED", "An interrupted write needs recovery. Inspect recover --dry-run, then run recover with the same root and project.");
  }
  async function remaining(changes: readonly FileChange[]): Promise<FileChange[]> {
    const pending: FileChange[] = [];
    for (const change of changes) {
      const current = await optionalRead(change.relative);
      if (current === (change.after ?? undefined)) continue;
      if (current !== change.before) throw new MemoryError("RECOVERY_CONFLICT", `File changed after interruption: ${change.relative}. Preserve the journal and resolve the difference before recovery.`);
      pending.push(change);
    }
    return pending;
  }
  async function recover(dryRun = false) {
    async function inspect() {
      const saved = await journal();
      const pending = saved ? await remaining(saved.changes) : [];
      return { saved, pending };
    }
    if (dryRun) {
      const { saved, pending } = await inspect();
      return { status: "preview", pending: !!saved, changed_paths: pending.map(change => change.relative) };
    }
    return withWriteLock(async apply => {
      const { saved } = await inspect();
      const changed_paths = saved ? await apply(saved.changes) : [];
      return { status: "success", pending: false, changed_paths, unchanged: !saved };
    }, true);
  }
  return Object.freeze({ read, optionalRead, entries, withWriteLock, assertReady, recover });
}
export type ProjectFiles = Awaited<ReturnType<typeof openProjectFiles>>;
