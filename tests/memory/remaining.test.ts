import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { initMemory, saveConcept, relateConcepts, deleteConcept } from "../../cli/memory/lib/mutate.ts";
import { openProjectMemory } from "../../cli/memory/lib/memory.ts";
import { validateMemory } from "../../cli/memory/lib/validate.ts";
import { parseDocument, type Metadata } from "../../cli/memory/lib/frontmatter.ts";
import { openProjectFiles, WriteError } from "../../cli/memory/lib/files.ts";
import { codeRefExists } from "../../cli/memory/lib/code-refs.ts";

let root: string;
const cliPath = resolve(import.meta.dir, "../../cli/memory/memory.ts");
const path = (name: string, project = "default") => join(root, ".space", project, "memory", name);
const read = (name: string) => readFile(path(name), "utf8");
async function put(name: string, text: string) { await mkdir(dirname(path(name)), { recursive: true }); await writeFile(path(name), text); }
async function create(id: string, extra: Metadata = {}, body = "body") {
  return saveConcept("create", root, "default", id, { type: "knowledge", title: id.split("/").at(-1)!, description: `${id} description`, ...extra }, body);
}
async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, cliPath, ...args, "--root", root, "--json"], { stdout: "pipe", stderr: "pipe" });
  const [out, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { data: (JSON.parse(out).data ?? JSON.parse(out).error), stderr, code };
}
async function snapshot(directory = root, directoryTimes = true): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const name of (await readdir(directory)).sort()) {
    const full = join(directory, name), stat = await lstat(full);
    out.push([name, stat.isDirectory() && !directoryTimes ? null : stat.mtimeMs, stat.isDirectory() ? await snapshot(full, directoryTimes) : await readFile(full, "utf8")]);
  }
  return out;
}
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "koto-memory-remaining-")); await initMemory(root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("relate updates only source, preserves verification and is repeatable through the CLI", async () => {
  await create("knowledge/a", { verified: [{ by: "human:alice", at: "2026-01-01T00:00:00Z" }] }, "original\r\n");
  await create("knowledge/b"); const target = await read("knowledge/b.md");
  const args = ["relate", "knowledge/a", "knowledge/b", "--desc", "根拠です", "--actor", "agent:tester"];
  expect((await cli(args)).code).toBe(0);
  const after = await snapshot(root, false);
  expect((await cli(args)).data.unchanged).toBe(true);
  expect(await snapshot(root, false)).toEqual(after);
  const shown = await cli(["show", "knowledge/a", "--relations"]);
  expect(shown.data.outbound).toEqual(["knowledge/b"]); expect(shown.data.inbound).toEqual([]);
  expect(shown.data.metadata).toMatchObject({ verified: [{ by: "human:alice" }], generated: { by: "agent:tester" } });
  expect(shown.data.body).toStartWith("original\r\n");
  expect((await cli(["show", "knowledge/b", "--relations"])).data.inbound).toEqual(["knowledge/a"]);
  expect(await read("knowledge/b.md")).toBe(target);
  expect(await read("log.md")).toContain("**Relationship**");
});

test("relations are optional and fail clearly on an unreadable collection", async () => {
  await create("knowledge/a"); await put("knowledge/broken.md", "bad frontmatter");
  expect((await cli(["show", "knowledge/a"])).code).toBe(0);
  const result = await cli(["show", "knowledge/a", "--relations"]);
  expect(result.code).toBe(2); expect(result.data.message).toContain("knowledge/broken.md");
  expect((await cli(["show", "knowledge/a", "--relations", "--raw"])).code).toBe(1);
});

test("relate rejects self, missing targets and a held lock without modifying source", async () => {
  await create("knowledge/a"); const before = await read("knowledge/a.md"), log = await read("log.md");
  await expect(relateConcepts(root, "default", "knowledge/a", "knowledge/a")).rejects.toThrow("itself");
  await expect(relateConcepts(root, "default", "knowledge/a", "knowledge/missing")).rejects.toThrow("does not exist");
  await (await openProjectFiles(root)).withWriteLock(async () => { expect((await cli(["delete", "knowledge/a"])).data.details.written_paths).toEqual([]); });
  expect(await read("knowledge/a.md")).toBe(before);
  expect(await read("log.md")).toBe(log);
});

test("delete preview is read-only and reports relationships and newly isolated concepts", async () => {
  await create("knowledge/a", {}, "Read [B](b.md) with the owner.\n\n```md\n[B](b.md)\n```\n");
  await create("knowledge/b", {}, "[C](c.md)"); await create("knowledge/c");
  const before = await snapshot();
  const preview = await cli(["delete", "knowledge/b", "--dry-run"]);
  expect(preview.code).toBe(0); expect(preview.data.status).toBe("preview");
  expect(preview.data.removed_relations).toEqual([{ source: "knowledge/a", target: "knowledge/b" }, { source: "knowledge/b", target: "knowledge/c" }]);
  expect(preview.data.new_orphans).toEqual(["knowledge/a", "knowledge/c"]);
  expect(await snapshot()).toEqual(before);
  const c = await read("knowledge/c.md"), oldLog = await read("log.md");
  const deleted = await cli(["delete", "knowledge/b"]);
  expect(deleted.code).toBe(0); expect(deleted.data.changed_paths).toEqual(preview.data.changed_paths);
  expect((await cli(["show", "knowledge/b"])).code).toBe(1);
  expect(parseDocument(await read("knowledge/a.md")).body).toBe("Read B with the owner.\n\n```md\n[B](b.md)\n```\n");
  expect(await read("knowledge/index.md")).not.toContain("(b.md)");
  expect(await read("knowledge/c.md")).toBe(c);
  expect(await read("log.md")).toContain("**Deletion**");
  expect(await read("log.md")).toContain("**Creation**: b (knowledge/b)");
  expect(await read("log.md")).not.toContain("](knowledge/b.md)");
  expect(oldLog).toContain("](knowledge/b.md)");
});

test("deletion keeps unrelated prose and links but removes managed relation entries", async () => {
  await create("knowledge/a", {}, "# Related Concepts\n- [B](b.md): required by A\n- [B](b.md) and [C](c.md) explain it.\n# Notes\n* [B](b.md) is an example in prose.\n");
  await create("knowledge/b"); await create("knowledge/c");
  await deleteConcept(root, "default", "knowledge/b");
  const body = parseDocument(await read("knowledge/a.md")).body;
  expect(body).not.toContain("required by A");
  expect(body).toContain("- B and [C](c.md) explain it.");
  expect(body).toContain("* B is an example in prose.");
});

test("deletion preserves unrelated HTML references and multiline inline code", async () => {
  const body = '# Related Concepts\n- [B](b.md): context <a href="c.md">C</a>\n# Examples\nExample: `\n[B](b.md)\n`\n\n---\n[normal](b.md)\n';
  await create("knowledge/a", {}, body); await create("knowledge/b"); await create("knowledge/c");
  await deleteConcept(root, "default", "knowledge/b");
  expect(parseDocument(await read("knowledge/a.md")).body).toBe(body.replace('- [B](b.md): context', '- B: context').replace('[normal](b.md)', 'normal'));
});

test("validation accepts index links to an existing log without counting them as relationships", async () => {
  await create("knowledge/a");
  await put("index.md", `${await read("index.md")}* [History](log.md)\n`);
  expect((await validateMemory(root, "default", { strict: true, drift: true })).gate_passed).toBe(true);
});

test.each(["[B][b]\n[b]: b.md\n", '<a href="b.md">B</a>', '<a href=b.md>B</a>', "```md\nunclosed", "<!--\nunclosed"])("unsafe deletion inspection stops before writing: %s", async body => {
  await create("knowledge/a", {}, body); await create("knowledge/b");
  const raw = await read("knowledge/b.md"), log = await read("log.md");
  const result = await cli(["delete", "knowledge/b"]);
  expect(result.code).toBe(1); expect(result.data.details.written_paths).toEqual([]);
  expect(await read("knowledge/b.md")).toBe(raw); expect(await read("log.md")).toBe(log);
});

test("parse errors and symlinked documents prevent deletion; another project is untouched", async () => {
  await create("knowledge/a"); await initMemory(root, "other");
  await saveConcept("create", root, "other", "knowledge/a", { type: "knowledge", title: "other", description: "other" }, "other");
  await put("knowledge/bad.md", "broken");
  expect((await cli(["delete", "knowledge/a"])).data.message).toContain("knowledge/bad.md");
  await rm(path("knowledge/bad.md"));
  await symlink(path("knowledge/a.md", "other"), path("knowledge/link.md"));
  expect((await cli(["delete", "knowledge/a"])).data.message).toContain("Symbolic links");
  await rm(path("knowledge/link.md")); await deleteConcept(root, "default", "knowledge/a");
  expect(await readFile(path("knowledge/a.md", "other"), "utf8")).toContain("title: other");
});

test("a failed unlink reports prior edits, keeps target and does not record a successful deletion", async () => {
  await create("knowledge/a", {}, "Read [B](locked/b.md).");
  await saveConcept("create", root, "default", "knowledge/locked/b", { type: "knowledge", title: "B", description: "B" }, "body", { noIndex: true, noLog: true });
  await chmod(path("knowledge/locked"), 0o555);
  let failure: unknown;
  try { await deleteConcept(root, "default", "knowledge/locked/b"); } catch (error) { failure = error; }
  finally { await chmod(path("knowledge/locked"), 0o755); }
  expect(failure).toBeInstanceOf(WriteError);
  expect((failure as WriteError).writtenPaths).toContain("knowledge/a.md");
  expect(await read("knowledge/locked/b.md")).toContain("title: B");
  expect(await read("log.md")).not.toContain("**Deletion**");
  expect((await (await openProjectFiles(root)).recover()).status).toBe("success");
});

test("file apply reports a target already deleted when a later log write fails", async () => {
  const files = await openProjectFiles(root);
  await put("knowledge/a.md", "original"); await mkdir(path("locked")); await chmod(path("locked"), 0o555);
  let failure: unknown;
  try { await files.withWriteLock(apply => apply([{ relative: "knowledge/a.md", before: "original", after: null }, { relative: "locked/log.md", before: undefined, after: "deletion" }])); }
  catch (error) { failure = error; }
  finally { await chmod(path("locked"), 0o755); }
  expect((failure as WriteError).writtenPaths).toEqual(["knowledge/a.md"]);
  expect(await files.optionalRead("knowledge/a.md")).toBeUndefined();
});

test("validation collects separate bad files and never modifies the bundle", async () => {
  await create("knowledge/good"); await put("knowledge/parse.md", "broken");
  await put("rules/type.md", "---\ntype: knowledge\ntitle: wrong\ndescription: wrong\n---\n");
  await put("knowledge/fields.md", "---\ntype: knowledge\n---\n");
  const before = await snapshot(), result = await cli(["validate", "--strict", "--drift"]);
  expect(result.code).toBe(1); expect(result.data.concept_count).toBe(4);
  expect(result.data.errors).toHaveLength(3); expect(result.data.is_conformant).toBe(false);
  expect(await snapshot()).toEqual(before);
});

test("validation distinguishes broken links, isolated concepts and index drift", async () => {
  await create("knowledge/a", {}, "[missing](missing.md) [outside](../../../../else.md) [nav](index.md)"); await create("knowledge/b");
  await put("knowledge/index.md", "* [A](a.md) - old description\n");
  const normal = await validateMemory(root), strict = await validateMemory(root, "default", { strict: true, drift: true });
  expect(normal.is_conformant).toBe(true); expect(normal.gate_passed).toBe(true);
  expect(strict.gate_passed).toBe(false); expect(strict.broken_links).toHaveLength(3);
  expect(strict.orphans).toEqual(["knowledge/a", "knowledge/b"]);
  expect(strict.warnings.some(w => w.includes("differs"))).toBe(true);
  expect(strict.warnings.some(w => w.includes("not listed"))).toBe(true);
});

test("strict allows only upcoming-expiry warnings while expired and old verification fail", async () => {
  const now = new Date("2026-11-01T00:00:00Z");
  await create("knowledge/a", { stale_after: "2026-11-08T00:00:00Z" });
  const near = await validateMemory(root, "default", { strict: true, staleWithinDays: 7, now });
  expect(near.near_expiry).toHaveLength(1); expect(near.warnings).toHaveLength(1); expect(near.gate_passed).toBe(true);
  expect((await validateMemory(root, "default", { strict: true, now })).warnings).toEqual([]);
  const expired = await validateMemory(root, "default", { strict: true, now: new Date("2026-11-08T00:00:00Z") });
  expect(expired.stale_count).toBe(1); expect(expired.gate_passed).toBe(false);
  expect((await validateMemory(root, "default", { stale: true, now: new Date("2026-11-08T00:00:00Z") })).gate_passed).toBe(false);
  await saveConcept("update", root, "default", "knowledge/a", { verified: [{ by: "human:old", at: "2020-01-01T00:00:00Z" }] }, undefined);
  expect((await validateMemory(root, "default", { strict: true, staleWithinDays: 7, now })).gate_passed).toBe(false);
});

test("self-links and navigation links do not prevent orphans; real relationships do", async () => {
  await create("knowledge/a", {}, "[self](a.md)"); await create("knowledge/b");
  expect((await validateMemory(root)).orphans).toHaveLength(2);
  await relateConcepts(root, "default", "knowledge/a", "knowledge/b");
  expect((await validateMemory(root, "default", { strict: true, drift: true })).gate_passed).toBe(true);
});

test("path search is rooted, project-scoped and prioritizes governance before keyword matches", async () => {
  await create("knowledge/hold", { governance: "hold", code_refs: ["repositories/default/api/src/**"] }, "unrelated");
  await create("knowledge/exact", { code_refs: ["repositories/default/api/src/auth.ts"] }, "認証 認証");
  await create("knowledge/constraint", { governance: "constraint", code_refs: ["repositories/default/api/src/"] });
  await create("knowledge/wrong", { code_refs: ["src/auth.ts"] });
  const result = await cli(["search", "認証", "--for-path", "repositories/default/api/src/auth.ts", "--all"]);
  expect(result.code).toBe(0); expect(result.data.map((r: {concept_id:string}) => r.concept_id)).toEqual(["knowledge/hold", "knowledge/constraint", "knowledge/exact"]);
  expect(result.data[0].matched_on).toContain("code_refs");
  expect((await cli(["search", "--for-path", join(root, "repositories/default/api/src/auth.ts"), "--limit", "1"])).data[0].concept_id).toBe("knowledge/hold");
  await initMemory(root, "other");
  expect((await cli(["search", "--for-path", "repositories/other/api/src/auth.ts", "--project", "other"])).data).toEqual([]);
  expect((await cli(["search", "--for-path", "/outside/src/auth.ts"])).code).toBe(2);
});

test("code reference drift checks monorepo paths and globs without following symlinks", async () => {
  await mkdir(join(root, "repositories/default/api/src"), { recursive: true }); await writeFile(join(root, "repositories/default/api/src/auth.ts"), "code");
  await create("knowledge/a", { code_refs: ["repositories/default/api/src/auth.ts", "repositories/default/*/src/*.ts", "repositories/default/api/src/"] });
  expect((await validateMemory(root, "default", { strict: true, drift: true })).gate_passed).toBe(true);
  await symlink(join(root, "repositories/default/api"), join(root, "repositories/default/shortcut"));
  expect(await codeRefExists(root, "repositories/default/shortcut/src/auth.ts")).toBe(false);
  expect(await codeRefExists(root, "repositories/default/shortcut/**/*.ts")).toBe(false);
  await saveConcept("update", root, "default", "knowledge/a", { code_refs: ["repositories/default/missing.ts"] }, undefined);
  expect((await validateMemory(root, "default", { drift: true })).warnings[0]).toContain("matches no accessible path");
});

test.each([
  ["delete", "knowledge/a", "--no-log"], ["relate", "knowledge/a"], ["relate", "knowledge/a", "knowledge/b", "--dry-run"],
  ["validate", "extra"], ["validate", "--stale-within", "0d"], ["validate", "--stale-within", "7h"], ["validate", "--stale-within", "999999d"],
  ["search", "--for-path", "src/a", "--stale"], ["show", "knowledge/a", "--drift"],
].map(args => ({ args })))("wrong options fail with JSON: %j", async ({ args }) => {
  expect((await cli(args)).code).toBe(1);
});
