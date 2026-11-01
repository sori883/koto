import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { runSetup } from "../scripts/lib/setup.ts";
import { openProjectFiles } from "../../../cli/memory/lib/files.ts";
import { initMemory } from "../../../cli/memory/lib/mutate.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

test("setup preserves old knowledge until an explicit move and then uses its original installation baseline", async () => {
  const root = await mkdtemp(join(tmpdir(), "koto-memory-move-")); roots.push(root);
  const project = join(root, "project"), pluginRoot = join(root, "plugin");
  async function put(base: string, path: string, text: string) { await mkdir(dirname(join(base, path)), { recursive: true }); await writeFile(join(base, path), text); }
  const index = '---\nokf_version: "0.2"\n---\n# Knowledge\n';
  const original = "# Core principle\nKeep this principle.\n";
  const incoming = "---\nscope: shared\n---\n" + original;
  const files = [
    { source: "space/default/index.md", destination: ".space/default/memory/index.md", mode: "merge-index" },
    { source: "space/default/principles/core.md", destination: ".space/default/memory/principles/core.md", mode: "copy" },
  ];
  await put(pluginRoot, "setup-manifest.json", JSON.stringify({ schemaVersion: 1, plugin: "koto", product: "codex", version: "0.1.8", files }));
  await put(pluginRoot, files[0]!.source, index);
  await put(pluginRoot, files[1]!.source, incoming);
  await put(project, ".space/babel/index.md", index + "\nUser introduction.\n");
  await put(project, ".space/babel/principles/core.md", original);
  await put(project, ".space/babel/knowledge/local.md", "Local knowledge must survive.\n");
  await put(project, ".space/babel/log.md", "Existing history.\n");
  await put(project, ".space/setup/koto-codex.json", JSON.stringify({ schemaVersion: 1, plugin: "koto", product: "codex", version: "0.1.8", entries: files.map((entry, i) => ({ ...entry, source: entry.source.replace("space/default/", "space/babel/"), destination: entry.destination.replace(".space/default/memory/", ".space/babel/"), hash: hash(i === 0 ? index : original), ...(i === 0 ? { indexSource: index } : {}) })) }));
  const plan = await runSetup({ command: "plan", project, pluginRoot });
  expect(plan.conflicts.some(c => c.destination === ".space/babel")).toBe(true);
  await expect(runSetup({ command: "apply", project, pluginRoot })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await Bun.file(join(project, ".space/default/memory/index.md")).exists()).toBe(false);
  expect(await readFile(join(project, ".space/babel/principles/core.md"), "utf8")).toBe(original);
  await mkdir(join(project, ".space/default"));
  await rename(join(project, ".space/babel"), join(project, ".space/default/memory"));
  await runSetup({ command: "apply", project, pluginRoot });
  expect(await readFile(join(project, ".space/default/memory/principles/core.md"), "utf8")).toBe(incoming);
  expect(await readFile(join(project, ".space/default/memory/index.md"), "utf8")).toContain("User introduction.");
  expect(await readFile(join(project, ".space/default/memory/knowledge/local.md"), "utf8")).toBe("Local knowledge must survive.\n");
  expect(await readFile(join(project, ".space/default/memory/log.md"), "utf8")).toBe("Existing history.\n");
  expect((await runSetup({ command: "status", project, pluginRoot })).conflicts).toEqual([]);
});

test("setup cannot update knowledge during a Memory write or unresolved recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "koto-memory-setup-lock-")); roots.push(root);
  const project = join(root, "project"), pluginRoot = join(root, "plugin");
  await mkdir(project); await mkdir(pluginRoot);
  await initMemory(project);
  const destination = ".space/default/memory/principles/core.md";
  await writeFile(join(pluginRoot, "core.md"), "Shared principle.\n");
  await writeFile(join(pluginRoot, "setup-manifest.json"), JSON.stringify({ schemaVersion: 1, plugin: "koto", product: "codex", version: "0.1.8", files: [{ source: "core.md", destination, mode: "copy" }] }));
  const files = await openProjectFiles(project);
  await files.withWriteLock(async () => {
    const status = await runSetup({ command: "status", project, pluginRoot });
    expect(status.locked).toBe(true);
    await expect(runSetup({ command: "apply", project, pluginRoot })).rejects.toThrow();
    expect(await Bun.file(join(project, destination)).exists()).toBe(false);
  });
  await writeFile(join(project, ".space/default/memory/.memory-pending.json"), "{}");
  expect((await runSetup({ command: "plan", project, pluginRoot })).conflicts.length).toBeGreaterThan(0);
  await expect(runSetup({ command: "apply", project, pluginRoot })).rejects.toThrow();
  expect(await Bun.file(join(project, destination)).exists()).toBe(false);
  await rm(join(project, ".space/default/memory/.memory-pending.json"));
  await runSetup({ command: "apply", project, pluginRoot });
  expect(await Bun.file(join(project, destination)).text()).toBe("Shared principle.\n");
  await files.withWriteLock(async () => {});
});
