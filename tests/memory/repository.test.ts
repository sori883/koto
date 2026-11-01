import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codePath, codeRefExists } from "../../cli/memory/lib/code-refs.ts";
import { openProjectMemory } from "../../cli/memory/lib/memory.ts";
import { initMemory, saveConcept } from "../../cli/memory/lib/mutate.ts";
import { validateMemory } from "../../cli/memory/lib/validate.ts";
import { execute } from "../../cli/tasks/lib/service.ts";
import { Store } from "../../cli/tasks/lib/store.ts";
import { reference } from "../../cli/tasks/lib/model.ts";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "koto-repository-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function put(path: string) { await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), "source\n"); }

test("default connects knowledge and task artifacts to source in the existing repository", async () => {
  await put("src/main.ts");
  await initMemory(root);
  await saveConcept("create", root, "default", "knowledge/source", { type: "knowledge", scope: "dev", title: "Source", description: "Source behavior", code_refs: ["src/main.ts"] }, "Implementation note.");
  const memory = await openProjectMemory(root);
  expect((await memory.search("", { forPath: "src/main.ts" })).map(row => row.concept_id)).toEqual(["knowledge/source"]);
  expect((await validateMemory(root, "default", { drift: true, strict: true })).gate_passed).toBe(true);
  const store = await Store.open(root, "default", true);
  await execute(store, { command: "setup" });
  await execute(store, { command: "task add", id: "job", title: "Source", operationId: "add" });
  await execute(store, { command: "artifact add", id: "job", childId: "source", ref: "src/main.ts", description: "Source artifact", ifVersion: 1, operationId: "source" });
  expect((await store.load()).tasks.job!.artifacts[0]!.ref).toBe("src/main.ts");
  expect(await codePath(root, join(root, "src/main.ts"))).toBe("src/main.ts");
});

test("source globs do not traverse Git metadata, other projects or symlinks", async () => {
  await put(".git/config");
  await put("workspaces/client/job/repo/secret.ts");
  await put(".space/client/memory/secret.ts");
  await put("repositories/client/secret.ts");
  await symlink(join(root, "workspaces/client"), join(root, "linked"));
  expect(await codeRefExists(root, "**/*.ts")).toBe(false);
  expect(await codeRefExists(root, "linked/**/*.ts")).toBe(false);
  await put("src/main.ts");
  expect(await codeRefExists(root, "**/*.ts")).toBe(true);
  for (const path of ["../escape.ts", "/tmp/escape.ts", ".git/config", "src/.git/config", ".space/client/memory/secret.ts", "workspaces/client/job/repo/secret.ts", "repositories/client/secret.ts"]) {
    await expect(codePath(root, path)).rejects.toThrow();
    expect(() => reference(path, "default")).toThrow();
  }
  await expect(codePath(root, "src/main.ts", "client")).rejects.toThrow();
  expect(() => reference("src/main.ts", "client")).toThrow();
  expect(() => reference(".space/client/tasks/report.md", "client")).not.toThrow();
});

test("initialization refuses to leave existing Babel knowledge behind", async () => {
  await put(".space/babel/knowledge/existing.md");
  await expect(initMemory(root)).rejects.toThrow(".space/babel");
  expect(await Bun.file(join(root, ".space/default/memory/index.md")).exists()).toBe(false);
  expect(await Bun.file(join(root, ".space/babel/knowledge/existing.md")).text()).toBe("source\n");
});
