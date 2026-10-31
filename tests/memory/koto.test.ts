import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openProjectFiles } from "../../cli/memory/lib/files.ts";
import { initMemory, saveConcept } from "../../cli/memory/lib/mutate.ts";
import { openProjectMemory } from "../../cli/memory/lib/memory.ts";
import { codePath, codeRefExists } from "../../cli/memory/lib/code-refs.ts";
import { validateMemory } from "../../cli/memory/lib/validate.ts";

let root: string;
const entry = resolve(import.meta.dir, "../../cli/memory/memory.ts");
const path = (name: string) => join(root, ".space/default/memory", name);
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "koto-memory-contract-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function invoke(request: unknown, stdin = false) {
  const raw = typeof request === "string" ? request : JSON.stringify(request);
  const child = Bun.spawn([process.execPath, entry, "--input-json", stdin ? "-" : raw], { stdin: stdin ? new Blob([raw]) : "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { body: JSON.parse(out), code, stderr };
}
const call = (command: string[], fields = {}) => invoke({ command, root, ...fields });

test("JSON stdin and inline requests support the complete knowledge lifecycle with stale-write protection", async () => {
  expect((await invoke({ command: ["setup"], root }, true)).body.ok).toBe(true);
  const metadata = { type: "knowledge", title: "認証方式", description: "認証の判断", tags: ["auth"], extra: { value: true } };
  expect((await call(["create", "knowledge/auth"], { metadata, body: "トークンを検証する。" })).body.ok).toBe(true);
  expect((await call(["create", "knowledge/session"], { metadata })).code).toBe(0);
  const shown = (await call(["show", "knowledge/auth"])).body;
  expect(shown).toMatchObject({ ok: true, data: { id: "knowledge/auth", metadata: { extra: { value: true } } } });
  expect(shown.data.content_hash).toMatch(/^[a-f0-9]{64}$/);
  expect((await call(["search", "認証"], { filter: ["tags=auth"] })).body.data).toHaveLength(2);
  expect((await call(["update", "knowledge/auth"], { ifHash: shown.data.content_hash, body: "更新内容" })).body.ok).toBe(true);
  const before = await readFile(path("knowledge/auth.md"), "utf8");
  for (const command of [["update", "knowledge/auth"], ["relate", "knowledge/auth", "knowledge/session"], ["delete", "knowledge/auth"]]) {
    const result = await call(command, { ifHash: shown.data.content_hash });
    expect(result.body).toMatchObject({ ok: false, error: { code: "VERSION_CONFLICT", details: { written_paths: [] } } });
    expect(await readFile(path("knowledge/auth.md"), "utf8")).toBe(before);
  }
  expect((await call(["relate", "knowledge/auth", "knowledge/session"])).body.ok).toBe(true);
  expect((await call(["show", "knowledge/auth"], { relations: true })).body.data.outbound).toEqual(["knowledge/session"]);
  const preview = await call(["delete", "knowledge/session"], { dryRun: true });
  expect(preview.body.data.status).toBe("preview");
  expect((await call(["delete", "knowledge/session"], { ifHash: preview.body.data.content_hash })).body.ok).toBe(true);
  expect((await call(["validate"], { strict: true, drift: true })).body).toMatchObject({ ok: true, data: { concept_count: 1, gate_passed: true } });
  await writeFile(path("knowledge/bad.md"), "not frontmatter");
  expect((await call(["validate"])).body).toMatchObject({ ok: false, data: { gate_passed: false } });
});

test("malformed JSON, unknown fields and invalid project IDs fail before initializing", async () => {
  for (const request of ["{", "null", "[]", { command: "setup", root }, { command: ["setup"], root, accidental: false }, { command: ["setup"], root, project: "ProjectX" }, { command: ["setup"], root, project: "constructor" }, { command: ["setup"], root, all: "true" }]) {
    const result = await invoke(request);
    expect(result.code).toBe(1); expect(result.stderr).toBe("");
    expect(result.body).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(await readdir(root)).toEqual([]);
  }
});

test("interrupted deletion recovers the original log after the target has already gone", async () => {
  await initMemory(root);
  const files = await openProjectFiles(root);
  await writeFile(path("knowledge/a.md"), "original");
  await mkdir(path("locked")); await chmod(path("locked"), 0o555);
  try {
    await expect(files.withWriteLock(apply => apply([
      { relative: "knowledge/a.md", before: "original", after: null },
      { relative: "locked/log.md", before: undefined, after: "Deletion at original time by original actor\n" },
    ]))).rejects.toThrow();
  } finally { await chmod(path("locked"), 0o755); }
  expect(await files.optionalRead("knowledge/a.md")).toBeUndefined();
  expect((await call(["search", "anything"])).body.error.code).toBe("RECOVERY_REQUIRED");
  expect((await call(["setup"])).body.error.code).toBe("RECOVERY_REQUIRED");
  const raw = await readFile(path(".memory-pending.json"), "utf8"), before = await lstat(path(".memory-pending.json"));
  expect((await call(["recover"], { dryRun: true })).body.data).toMatchObject({ status: "preview", pending: true, changed_paths: ["locked/log.md"] });
  expect((await lstat(path(".memory-pending.json"))).mtimeMs).toBe(before.mtimeMs);
  expect(await readFile(path(".memory-pending.json"), "utf8")).toBe(raw);
  expect((await call(["recover"])).body.ok).toBe(true);
  expect(await readFile(path("locked/log.md"), "utf8")).toBe("Deletion at original time by original actor\n");
  expect(await files.optionalRead("knowledge/a.md")).toBeUndefined();
  expect(await files.optionalRead(".memory-pending.json")).toBeUndefined();
  expect((await call(["recover"])).body.data.unchanged).toBe(true);
});

test("recovery checks every target before writing and preserves post-interruption edits", async () => {
  await initMemory(root);
  const files = await openProjectFiles(root);
  const changes = [{ relative: "knowledge/first.md", before: undefined, after: "first" }, { relative: "knowledge/last.md", before: "before", after: "planned" }];
  await writeFile(path(".memory-pending.json"), JSON.stringify({ schemaVersion: 1, project: "default", changes }));
  await writeFile(path("knowledge/last.md"), "human edit");
  for (const dryRun of [true, false]) {
    expect((await call(["recover"], { dryRun })).body.error.code).toBe("RECOVERY_CONFLICT");
    expect(await files.optionalRead("knowledge/first.md")).toBeUndefined();
    expect(await files.read("knowledge/last.md")).toBe("human edit");
  }
  await writeFile(path("knowledge/last.md"), "before");
  expect((await call(["recover"])).body.data.changed_paths).toEqual(["knowledge/first.md", "knowledge/last.md"]);
});

test("initialization can recover before a valid bundle exists and preserves other tools", async () => {
  await mkdir(path("knowledge"), { recursive: true }); await chmod(path("knowledge"), 0o555);
  await mkdir(join(root, ".space/default/tasks")); await writeFile(join(root, ".space/default/tasks/state.json"), "tasks");
  try { await expect(initMemory(root)).rejects.toThrow(); }
  finally { await chmod(path("knowledge"), 0o755); }
  expect((await call(["recover"])).body.ok).toBe(true);
  expect((await validateMemory(root)).gate_passed).toBe(true);
  expect(await readFile(join(root, ".space/default/tasks/state.json"), "utf8")).toBe("tasks");
});

test("foreign and broad code paths are rejected before scanning, and symlinks cannot cross projects", async () => {
  await initMemory(root);
  await mkdir(join(root, "repositories/other/api"), { recursive: true });
  await writeFile(join(root, "repositories/other/api/private.ts"), "secret");
  await mkdir(join(root, "repositories/default"));
  await symlink(join(root, "repositories/other/api"), join(root, "repositories/default/alias"));
  for (const ref of ["**/*.ts", "repositories/*/api/*.ts", "repositories/other/api", ".space/other", "src/**"]) {
    await expect(codeRefExists(root, ref)).rejects.toThrow("project");
    await expect(codePath(root, ref)).rejects.toThrow("project");
  }
  expect(await codeRefExists(root, "repositories/default/alias/**/*.ts")).toBe(false);
  await saveConcept("create", root, "default", "knowledge/a", { type: "knowledge", title: "A", description: "A", code_refs: ["repositories/other/api/**"] }, "body");
  const result = await validateMemory(root, "default", { drift: true });
  expect(result.gate_passed).toBe(false); expect(result.errors[0]).toContain("project");
  expect(await (await openProjectMemory(root)).search("A")).toHaveLength(1);
});

test("unknown, escaping and symlinked recovery journals cannot write outside memory", async () => {
  await initMemory(root);
  const outside = join(root, "outside"); await writeFile(outside, "keep");
  for (const plan of [
    { schemaVersion: 99, project: "default", changes: [] },
    { schemaVersion: 1, project: "other", changes: [] },
    { schemaVersion: 1, project: "default", changes: [{ relative: "../../../../outside", before: "keep", after: "bad" }] },
    { schemaVersion: 1, project: "default", changes: [{ relative: ".okf-write-lock/owner.json", after: "bad" }] },
  ]) {
    await writeFile(path(".memory-pending.json"), JSON.stringify(plan));
    expect((await call(["recover"])).body.ok).toBe(false);
    expect(await readFile(outside, "utf8")).toBe("keep");
  }
  await rm(path(".memory-pending.json")); await symlink(outside, path(".memory-pending.json"));
  expect((await call(["recover"])).body.ok).toBe(false);
  expect(await readFile(outside, "utf8")).toBe("keep");
});
