import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initMemory, saveConcept } from "../../cli/memory/lib/mutate.ts";

let root: string;
const entry = resolve(import.meta.dir, "../../cli/memory/memory.ts");
const memory = (project = "default") => join(root, ".space", project, "memory");
const events = (project = "default") => join(memory(project), "usage/events");
async function call(command: string[], options = {}) {
  const child = Bun.spawn([process.execPath, entry, "--input-json", JSON.stringify({ command, root, ...options })], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { body: JSON.parse(out), err, code };
}
async function seed(project = "default") {
  await initMemory(root, project);
  await saveConcept("create", root, project, "knowledge/auth", { type: "knowledge", title: "Authentication", description: "Token rules" }, "Private content that must not enter usage logs.");
}
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "koto-memory-usage-")); await seed(); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("recorded reads preserve response data and aggregate search exposure separately from body retrieval", async () => {
  const before = await readFile(join(memory(), "log.md"), "utf8");
  const original = (await call(["show", "knowledge/auth"])).body.data;
  const search = await call(["search", "Authentication"], { recordUsage: true, actor: "agent:codex", usageSource: "devlow", taskId: "task-001" });
  expect(search.code).toBe(0);
  expect(search.body.data.map((item: { concept_id: string }) => item.concept_id)).toEqual(["knowledge/auth"]);
  expect(search.body.usage.event_id).toBeString();
  const show = await call(["show", "knowledge/auth"], { recordUsage: true, usageSource: "devlow" });
  expect(show.code).toBe(0); expect(show.body.data).toEqual(original);
  expect((await call(["search", "zzzzqvnomatchtoken"], { recordUsage: true })).code).toBe(0);
  const stats = (await call(["usage", "stats"])).body.data;
  expect(stats).toMatchObject({ events: 3, searches: 2, shows: 1, empty_searches: 1, concepts: [{ concept_id: "knowledge/auth", search_results: 1, shows: 1 }] });
  const list = (await call(["usage", "list"], { all: true })).body.data;
  expect(list.total).toBe(3); expect(list.events).toHaveLength(3);
  const shown = list.events.find((event: { operation: string }) => event.operation === "show");
  expect(shown.content_hash).toBe(original.content_hash);
  const searched = list.events.find((event: { task_id?: string }) => event.task_id === "task-001");
  expect(searched).toMatchObject({ project: "default", actor: "agent:codex", source: "devlow", concept_ids: ["knowledge/auth"] });
  const raw = (await Promise.all((await readdir(events())).map(name => readFile(join(events(), name), "utf8")))).join("");
  expect(raw).not.toContain("zzzzqvnomatchtoken"); expect(raw).not.toContain(original.body.trim());
  expect(await readFile(join(memory(), "log.md"), "utf8")).toBe(before);
  expect((await call(["validate"], { strict: true, drift: true })).body.data.gate_passed).toBe(true);
});

test("unrecorded reads, log inspection and failed reads do not create usage data or task records", async () => {
  const before = (await readdir(memory())).sort();
  expect((await call(["usage", "stats"])).body.data.events).toBe(0);
  expect((await call(["usage", "list"])).body.data).toEqual({ total: 0, events: [] });
  expect((await call(["search", "Authentication"])).body).not.toHaveProperty("usage");
  expect((await call(["show", "knowledge/auth"])).body).not.toHaveProperty("usage");
  expect((await call(["show", "knowledge/missing"], { recordUsage: true })).code).not.toBe(0);
  expect((await readdir(memory())).sort()).toEqual(before);
  expect(await readdir(join(root, ".space/default"))).toEqual(["memory"]);
});

test("usage filters, limits and project boundaries select only matching events", async () => {
  await seed("other");
  await call(["search", "Authentication"], { recordUsage: true, usageSource: "devlow", actor: "agent:codex", taskId: "task-1" });
  await call(["show", "knowledge/auth"], { recordUsage: true, usageSource: "recall", actor: "agent:claude" });
  await call(["show", "knowledge/auth"], { recordUsage: true, project: "other" });
  expect((await call(["usage", "stats"], { project: "other" })).body.data.events).toBe(1);
  for (const options of [{ usageSource: "recall" }, { actor: "agent:codex" }, { taskId: "task-1" }]) expect((await call(["usage", "stats"], options)).body.data.events).toBe(1);
  expect((await call(["usage", "stats"], { since: "2000-01-01T00:00:00Z", until: "2001-01-01T00:00:00Z" })).body.data.events).toBe(0);
  expect((await call(["usage", "list"], { limit: 1 })).body.data).toMatchObject({ total: 2, events: [{ operation: "show" }] });
  const latest = (await call(["usage", "list"], { limit: 1 })).body.data.events[0].at;
  expect((await call(["usage", "stats"], { since: latest })).body.data).toMatchObject({ events: 1, shows: 1 });
  expect((await call(["usage", "stats"], { until: latest })).body.data).toMatchObject({ events: 1, searches: 1 });
  expect((await call(["usage", "list"], { project: "missing" })).code).not.toBe(0);
  expect((await readdir(join(root, ".space"))).sort()).toEqual(["default", "other"]);
});

test("deleting a concept preserves its historical usage and subsequent failed retrievals are not counted", async () => {
  expect((await call(["show", "knowledge/auth"], { recordUsage: true })).code).toBe(0);
  expect((await call(["delete", "knowledge/auth"])).code).toBe(0);
  expect((await call(["show", "knowledge/auth"], { recordUsage: true })).code).not.toBe(0);
  expect((await call(["usage", "stats"])).body.data.concepts).toEqual([{ concept_id: "knowledge/auth", search_results: 0, shows: 1 }]);
});

test("raw output remains the original Markdown when usage is recorded", async () => {
  const child = Bun.spawn([process.execPath, entry, "show", "knowledge/auth", "--root", root, "--raw", "--record-usage"], { stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  expect(code).toBe(0); expect(out).toBe(await readFile(join(memory(), "knowledge/auth.md"), "utf8"));
  expect((await call(["usage", "stats"])).body.data.shows).toBe(1);
});

test("malformed and cross-project logs fail rather than returning a partial aggregate", async () => {
  expect((await call(["show", "knowledge/auth"], { recordUsage: true })).code).toBe(0);
  const path = join(events(), (await readdir(events()))[0]!);
  const original = JSON.parse(await readFile(path, "utf8"));
  for (const invalid of ["{", JSON.stringify({ ...original, schema_version: 99 }), JSON.stringify({ ...original, project: "other" }), JSON.stringify({ ...original, concept_ids: ["../outside"] }), JSON.stringify({ ...original, operation: ["show"], content_hash: undefined })]) {
    await writeFile(path, invalid);
    const result = await call(["usage", "stats"]);
    expect(result.code).not.toBe(0); expect(result.body.ok).toBe(false);
    expect((await call(["show", "knowledge/auth"])).code).toBe(0);
  }
});

test("symlinked usage destinations and active write locks cannot be bypassed", async () => {
  await mkdir(join(root, "outside"));
  await symlink(join(root, "outside"), join(memory(), "usage"));
  expect((await call(["show", "knowledge/auth"], { recordUsage: true })).code).not.toBe(0);
  expect(await readdir(join(root, "outside"))).toEqual([]);
  expect((await call(["usage", "stats"])).code).not.toBe(0);
  await rm(join(memory(), "usage"));
  await mkdir(join(memory(), ".okf-write-lock"));
  expect((await call(["show", "knowledge/auth"], { recordUsage: true })).code).not.toBe(0);
  expect((await call(["show", "knowledge/auth"])).code).toBe(0);
  expect(await readdir(join(memory(), ".okf-write-lock"))).toEqual([]);
});

test("an interrupted usage write recovers once without changing knowledge or its update history", async () => {
  await mkdir(events(), { recursive: true });
  const before = await readFile(join(memory(), "knowledge/auth.md"), "utf8");
  const log = await readFile(join(memory(), "log.md"), "utf8");
  await chmod(events(), 0o555);
  try { expect((await call(["show", "knowledge/auth"], { recordUsage: true })).code).not.toBe(0); }
  finally { await chmod(events(), 0o755); }
  expect((await call(["usage", "stats"])).body.error.code).toBe("RECOVERY_REQUIRED");
  expect((await call(["recover"], { dryRun: true })).body.data.pending).toBe(true);
  expect((await call(["recover"])).code).toBe(0);
  expect((await call(["recover"])).body.data.unchanged).toBe(true);
  expect((await call(["usage", "stats"])).body.data.shows).toBe(1);
  expect(await readFile(join(memory(), "knowledge/auth.md"), "utf8")).toBe(before);
  expect(await readFile(join(memory(), "log.md"), "utf8")).toBe(log);
});

test("invalid logging options and filters fail before producing events", async () => {
  for (const [command, options] of [
    [["show", "knowledge/auth"], { usageSource: "devlow" }],
    [["show", "knowledge/auth"], { recordUsage: true, taskId: "../other" }],
    [["show", "knowledge/auth"], { recordUsage: true, usageSource: "../other" }],
    [["show", "knowledge/auth"], { recordUsage: true, actor: "invalid" }],
    [["usage", "stats"], { limit: 1 }],
    [["usage", "list"], { since: "yesterday" }],
    [["usage", "list"], { since: "2026-01-01T00:00:00Z", until: "2025-01-01T00:00:00Z" }],
    [["usage", "list"], { limit: 1, all: true }],
    [["usage", "clear"], {}],
  ] as const) expect((await call([...command], options)).code).not.toBe(0);
  expect((await readdir(memory())).includes("usage")).toBe(false);
});

test("concurrent recorded reads retain every successful event without overwriting knowledge", async () => {
  const before = await readFile(join(memory(), "knowledge/auth.md"), "utf8");
  const results = await Promise.all(Array.from({ length: 8 }, () => call(["show", "knowledge/auth"], { recordUsage: true })));
  const successful = results.filter(result => result.code === 0);
  expect(successful.length).toBeGreaterThan(0);
  const ids = successful.map(result => result.body.usage.event_id);
  expect(new Set(ids).size).toBe(successful.length);
  const log = (await call(["usage", "list"], { all: true })).body.data;
  expect(log.events.map((event: { id: string }) => event.id).sort()).toEqual(ids.sort());
  expect((await call(["usage", "stats"])).body.data.shows).toBe(successful.length);
  expect(await readFile(join(memory(), "knowledge/auth.md"), "utf8")).toBe(before);
});
