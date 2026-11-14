import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initMemory, saveConcept, relateConcepts, deleteConcept } from "../../cli/memory/lib/mutate.ts";
import { openProjectMemory } from "../../cli/memory/lib/memory.ts";
import { parseDocument, serializeDocument, typeDirectories, type Metadata } from "../../cli/memory/lib/frontmatter.ts";
import { validateMemory } from "../../cli/memory/lib/validate.ts";
import { contentHash } from "../../cli/memory/lib/errors.ts";
import { parseFilters } from "../../cli/memory/lib/filter.ts";

let root: string;
const entry = resolve(import.meta.dir, "../../cli/memory/memory.ts");
const path = (id: string) => join(root, ".space/default/memory", `${id}.md`);
const metadata = (extra: Metadata = {}): Metadata => ({ type: "knowledge", title: "token", description: "Token handling", scope: "shared", ...extra });
async function create(id: string, extra: Metadata = {}, body = "Instructions.") {
  return saveConcept("create", root, "default", id, metadata(extra), body);
}
async function legacy(id: string, body = "Legacy instructions.") {
  await create(id, {}, body);
  const document = parseDocument(await readFile(path(id), "utf8"));
  delete document.metadata.scope;
  await writeFile(path(id), serializeDocument(document));
}
async function cli(command: string[], options = {}) {
  const child = Bun.spawn([process.execPath, entry, "--input-json", JSON.stringify({ command, root, ...options })], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, err, ...JSON.parse(out) };
}
const ids = (results: { concept_id: string }[]) => results.map(result => result.concept_id).sort();
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "koto-memory-scope-")); await initMemory(root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("every concept type requires an explicit valid scope when created", async () => {
  for (const [type, directory] of Object.entries(typeDirectories)) {
    const missing = metadata({ type }); delete missing.scope;
    await expect(saveConcept("create", root, "default", `${directory}/missing`, missing, "body")).rejects.toThrow("scope");
    for (const scope of [null, "", "unknown", ["dev", "ops"], 3]) {
      await expect(create(`${directory}/invalid`, { type, scope })).rejects.toThrow("scope");
    }
    for (const scope of ["shared", "dev", "ops"]) {
      await create(`${directory}/${scope}`, { type, scope });
      expect((await (await openProjectMemory(root)).show(`${directory}/${scope}`)).metadata.scope).toBe(scope);
    }
  }
});

test("scope selection includes shared knowledge across all types and exact filters remain exact", async () => {
  for (const [type, directory] of Object.entries(typeDirectories)) {
    for (const scope of ["shared", "dev", "ops"]) await create(`${directory}/${scope}`, { type, scope });
  }
  await legacy("knowledge/legacy");
  const memory = await openProjectMemory(root);
  for (const scope of ["dev", "ops"] as const) {
    const results = await memory.search("", { scope, all: true });
    expect(ids(results)).toEqual(Object.values(typeDirectories).flatMap(dir => [`${dir}/shared`, `${dir}/${scope}`]).sort());
    expect(new Set(results.map(result => result.scope))).toEqual(new Set(["shared", scope]));
  }
  expect((await memory.search("", { scope: "shared", all: true }))).toHaveLength(5);
  expect((await memory.search("token", { all: true }))).toHaveLength(16);
  expect(ids(await memory.search("", { filters: parseFilters(["scope=dev"]), all: true }))).toEqual(Object.values(typeDirectories).map(dir => `${dir}/dev`).sort());
  expect(ids(await memory.search("", { filters: parseFilters(["!scope"]) }))).toEqual(["knowledge/legacy"]);
});

test("scope and metadata selection run before limits on every search route", async () => {
  const code_refs = ["repositories/default/api/src/"];
  for (let i = 0; i < 12; i++) await create(`knowledge/a${i}`, { scope: "ops", code_refs });
  await create("knowledge/dev", { scope: "dev", code_refs, tags: ["include"] });
  await create("knowledge/shared", { scope: "shared", code_refs, tags: ["exclude"], governance: "hold" });
  const memory = await openProjectMemory(root);
  for (const options of [{}, { type: "knowledge" as const }, { forPath: "repositories/default/api/src/auth.ts" }]) {
    expect(ids(await memory.search("token", { ...options, scope: "dev", limit: 2 }))).toEqual(["knowledge/dev", "knowledge/shared"]);
    expect(ids(await memory.search("", { ...options, scope: "dev", limit: 1, filters: parseFilters(["tags=include"]) }))).toEqual(["knowledge/dev"]);
  }
  expect((await memory.search("", { scope: "dev", limit: 1 }))[0]?.concept_id).toBe("knowledge/shared");
});

test("legacy reads stay unchanged while classification is explicit and guarded by the content hash", async () => {
  await legacy("knowledge/old", "Keep [link](old.md) and body.\n");
  const legacyDocument = parseDocument(await readFile(path("knowledge/old"), "utf8"));
  legacyDocument.metadata.verified = [{ by: "human:reviewer", at: "2026-10-30T00:00:00Z" }];
  await writeFile(path("knowledge/old"), serializeDocument(legacyDocument));
  const original = await readFile(path("knowledge/old"), "utf8");
  const memory = await openProjectMemory(root);
  expect((await memory.show("knowledge/old")).metadata).not.toHaveProperty("scope");
  expect(await memory.search("token", { scope: "dev" })).toEqual([]);
  expect(await readFile(path("knowledge/old"), "utf8")).toBe(original);
  await expect(saveConcept("update", root, "default", "knowledge/old", { title: "changed" }, undefined)).rejects.toThrow("scope");
  await saveConcept("update", root, "default", "knowledge/old", { scope: "ops" }, undefined, { ifHash: contentHash(original) });
  const updated = await memory.show("knowledge/old");
  expect(updated.body).toBe(parseDocument(original).body); expect(updated.metadata.scope).toBe("ops");
  expect(updated.metadata.verified).toEqual(legacyDocument.metadata.verified);
  await expect(saveConcept("update", root, "default", "knowledge/old", { scope: "dev" }, undefined, { ifHash: contentHash(original) })).rejects.toThrow("changed");
  await expect(saveConcept("update", root, "default", "knowledge/old", {}, undefined, { unset: ["scope"] })).rejects.toThrow("scope");
  await saveConcept("update", root, "default", "knowledge/old", { title: "new title" }, undefined);
  expect((await memory.show("knowledge/old")).metadata.scope).toBe("ops");
});

test("validation distinguishes legacy unclassified documents from invalid explicit scopes", async () => {
  await legacy("knowledge/old");
  const result = await validateMemory(root);
  expect(result.is_conformant).toBe(true); expect(result.gate_passed).toBe(true);
  expect(result.warnings.some(warning => warning.includes("scope") && warning.includes("knowledge/old.md"))).toBe(true);
  expect((await validateMemory(root, "default", { strict: true })).gate_passed).toBe(false);
  const document = parseDocument(await readFile(path("knowledge/old"), "utf8"));
  document.metadata.scope = "unknown"; await writeFile(path("knowledge/old"), serializeDocument(document));
  expect((await validateMemory(root)).errors.some(error => error.includes("scope"))).toBe(true);
  await expect((await openProjectMemory(root)).search("token", { scope: "dev" })).rejects.toThrow("scope");
});

test("relationships require a classified source but deletion preserves legacy referring documents", async () => {
  await legacy("knowledge/old", "[Target](target.md)"); await create("knowledge/target");
  await expect(relateConcepts(root, "default", "knowledge/old", "knowledge/target")).rejects.toThrow("scope");
  await relateConcepts(root, "default", "knowledge/target", "knowledge/old");
  await deleteConcept(root, "default", "knowledge/target");
  const old = await (await openProjectMemory(root)).show("knowledge/old");
  expect(old.metadata).not.toHaveProperty("scope"); expect(old.body).not.toContain("target.md");
});

test("CLI scope inputs override metadata and record only the selected response once", async () => {
  expect((await cli(["create", "knowledge/dev"], { metadata: metadata({ scope: "ops" }), scope: "dev" })).code).toBe(0);
  await create("knowledge/shared"); await create("knowledge/ops", { scope: "ops" });
  const result = await cli(["search"], { scope: "dev", recordUsage: true, usageSource: "devlaw" });
  expect(result.code).toBe(0); expect(ids(result.data)).toEqual(["knowledge/dev", "knowledge/shared"]);
  expect(result.data.every((item: { scope: string }) => ["shared", "dev"].includes(item.scope))).toBe(true);
  const usage = (await cli(["usage", "list"])).data;
  expect(usage.total).toBe(1); expect([...usage.events[0].concept_ids].sort()).toEqual(ids(result.data));
  const before = await readFile(path("knowledge/dev"), "utf8");
  for (const options of [{ scope: "invalid" }, { scope: ["dev"] }]) expect((await cli(["search"], options)).code).not.toBe(0);
  expect((await cli(["show", "knowledge/dev"], { scope: "dev" })).code).not.toBe(0);
  expect(await readFile(path("knowledge/dev"), "utf8")).toBe(before);
});

test("scope selection does not cross project boundaries and API invalid scope is rejected", async () => {
  await create("knowledge/local", { scope: "ops" }); await initMemory(root, "other");
  await saveConcept("create", root, "other", "knowledge/remote", metadata({ scope: "dev" }), "other");
  const memory = await openProjectMemory(root);
  expect(await memory.search("token", { scope: "dev" })).toEqual([]);
  expect(ids(await (await openProjectMemory(root, "other")).search("token", { scope: "dev" }))).toEqual(["knowledge/remote"]);
  await expect(memory.search("token", { scope: "unknown" as never })).rejects.toThrow("scope");
});
