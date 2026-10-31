import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { maxFileBytes, openProjectFiles, WriteError } from "../../cli/memory/lib/files.ts";
import { initMemory } from "../../cli/memory/lib/mutate.ts";

let root: string;
const path = (relative: string) => join(root, ".space/default/memory", relative);
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "koto-memory-files-")); await initMemory(root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("the lock serializes writers in one project while allowing another project", async () => {
  await initMemory(root, "other");
  const files = await openProjectFiles(root), other = await openProjectFiles(root, "other");
  await files.withWriteLock(async apply => {
    await expect(files.withWriteLock(async () => true)).rejects.toThrow("Another mutation");
    expect(await other.withWriteLock(async () => "independent")).toBe("independent");
    expect(await apply([{ relative: "knowledge/a.md", before: undefined, after: "a" }])).toEqual(["knowledge/a.md"]);
  });
  expect(await readdir(path(""))).not.toContain(".okf-write-lock");
});

test("stale locks and replaced lock owners are left intact", async () => {
  const files = await openProjectFiles(root);
  await mkdir(path(".okf-write-lock"));
  await writeFile(path(".okf-write-lock/owner.json"), "stale");
  await expect(files.withWriteLock(async () => null)).rejects.toThrow("manual recovery");
  expect(await readFile(path(".okf-write-lock/owner.json"), "utf8")).toBe("stale");
  await rm(path(".okf-write-lock"), { recursive: true });
  await expect(files.withWriteLock(async apply => {
    await rename(path(".okf-write-lock"), path(".previous-lock"));
    await mkdir(path(".okf-write-lock"));
    await writeFile(path(".okf-write-lock/owner.json"), "another owner");
    await apply([{ relative: "knowledge/a.md", before: undefined, after: "a" }]);
  })).rejects.toThrow("lock");
  expect(await readFile(path(".okf-write-lock/owner.json"), "utf8")).toBe("another owner");
  expect(await files.optionalRead("knowledge/a.md")).toBeUndefined();
});

test("a killed writer leaves a lock that the next process does not automatically remove", async () => {
  const script = join(root, "hold-lock.ts");
  await writeFile(script, `import { openProjectFiles } from ${JSON.stringify(resolve(import.meta.dir, "../../cli/memory/lib/files.ts"))};
const files = await openProjectFiles(${JSON.stringify(root)});
await files.withWriteLock(async () => {
  process.stdout.write("ready\\n");
  await new Promise(() => setInterval(() => {}, 1000));
});`);
  const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" });
  try {
    const ready = await child.stdout.getReader().read();
    expect(new TextDecoder().decode(ready.value)).toBe("ready\n");
    const owner = await readFile(path(".okf-write-lock/owner.json"), "utf8");
    child.kill("SIGKILL"); await child.exited;
    const files = await openProjectFiles(root);
    await expect(files.withWriteLock(async () => null)).rejects.toThrow("manual recovery");
    expect(await readFile(path(".okf-write-lock/owner.json"), "utf8")).toBe(owner);
  } finally { if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; } }
});

test("all changes are checked before the first write and existing content is never blindly overwritten", async () => {
  const files = await openProjectFiles(root);
  await writeFile(path("knowledge/existing.md"), "other writer");
  for (const before of [undefined, "stale text"]) {
    await expect(files.withWriteLock(apply => apply([
      { relative: "knowledge/new.md", before: undefined, after: "new" },
      { relative: "knowledge/existing.md", before, after: "overwrite" },
    ]))).rejects.toThrow("File changed");
    expect(await files.optionalRead("knowledge/new.md")).toBeUndefined();
    expect(await files.read("knowledge/existing.md")).toBe("other writer");
  }
});

test("file replacement preserves permissions and removes temporary files", async () => {
  const files = await openProjectFiles(root);
  await writeFile(path("knowledge/a.md"), "before");
  await chmod(path("knowledge/a.md"), 0o660);
  const before = await lstat(path("knowledge/a.md"));
  await files.withWriteLock(apply => apply([{ relative: "knowledge/a.md", before: "before", after: "after" }]));
  const after = await lstat(path("knowledge/a.md"));
  expect(after.mode & 0o777).toBe(0o660);
  expect(after.ino).not.toBe(before.ino);
  expect(await files.read("knowledge/a.md")).toBe("after");
  expect((await readdir(path("knowledge"))).sort()).toEqual(["a.md", "index.md"]);
});

test("a real I/O failure reports the files already published without rolling them back", async () => {
  const files = await openProjectFiles(root);
  await mkdir(path("knowledge/readonly")); await chmod(path("knowledge/readonly"), 0o555);
  let error: unknown;
  try {
    await files.withWriteLock(apply => apply([
      { relative: "knowledge/saved.md", before: undefined, after: "saved" },
      { relative: "knowledge/readonly/fails.md", before: undefined, after: "fails" },
    ]));
  } catch (caught) { error = caught; }
  finally { await chmod(path("knowledge/readonly"), 0o755); }
  expect(error).toBeInstanceOf(WriteError);
  expect((error as WriteError).writtenPaths).toEqual(["knowledge/saved.md"]);
  expect(await files.read("knowledge/saved.md")).toBe("saved");
  expect(await files.optionalRead("knowledge/readonly/fails.md")).toBeUndefined();
  expect(await readdir(path(""))).not.toContain(".okf-write-lock");
  expect((await readdir(path("knowledge"))).some(name => name.endsWith(".tmp"))).toBe(false);
});

test("cleanup failure preserves the list of files published", async () => {
  const files = await openProjectFiles(root);
  let error: unknown;
  try {
    await files.withWriteLock(async apply => {
      await apply([{ relative: "knowledge/saved.md", before: undefined, after: "saved" }]);
      await writeFile(path(".okf-write-lock/foreign"), "do not delete");
    });
  } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(WriteError);
  expect((error as WriteError).writtenPaths).toEqual(["knowledge/saved.md"]);
  expect(await readFile(path(".okf-write-lock/foreign"), "utf8")).toBe("do not delete");
});

test("oversized content and unsafe paths fail before any file is saved", async () => {
  const files = await openProjectFiles(root);
  for (const change of [
    { relative: "../outside", before: undefined, after: "bad" },
    { relative: "knowledge/large.md", before: undefined, after: "a".repeat(maxFileBytes + 1) },
  ]) {
    await expect(files.withWriteLock(apply => apply([
      { relative: "knowledge/new.md", before: undefined, after: "new" }, change,
    ]))).rejects.toBeInstanceOf(WriteError);
    expect(await files.optionalRead("knowledge/new.md")).toBeUndefined();
  }
});
