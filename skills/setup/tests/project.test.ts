import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSetup } from "../scripts/lib/setup.ts";
import type { Product } from "../scripts/lib/model.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture(product: Product) {
  const root = await mkdtemp(join(tmpdir(), "koto-project-")); roots.push(root);
  const project = join(root, "consumer"), pluginRoot = join(root, "distribution");
  const skillRoot = product === "codex" ? ".agents/skills" : ".claude/skills";
  const instruction = product === "codex" ? "AGENTS.md" : "CLAUDE.md";
  await mkdir(project); await mkdir(join(pluginRoot, "skills/example"), { recursive: true });
  await mkdir(join(pluginRoot, "templates"));
  await writeFile(join(pluginRoot, "skills/example/SKILL.md"), "# Example\n");
  await writeFile(join(pluginRoot, "templates/instructions.md"), "Read {{SKILL_ROOT}}/example/SKILL.md and {{BABEL_BUNDLE}}.\n");
  const common = { schemaVersion: 1, plugin: "koto", product, version: "1.0.0" };
  const instructions = { source: "templates/instructions.md", destination: instruction, mode: "managed-block" };
  await writeFile(join(pluginRoot, "setup-manifest.json"), JSON.stringify({ ...common, files: [instructions] }));
  const manifest = { ...common, scope: "project", files: [instructions, { source: "skills/example/SKILL.md", destination: `${skillRoot}/example/SKILL.md`, mode: "copy" }] };
  await writeFile(join(pluginRoot, "setup-manifest.project.json"), JSON.stringify(manifest));
  const run = (command: "plan" | "apply" | "status") => runSetup({ command, project, pluginRoot, scope: "project" });
  return { project, pluginRoot, manifest, skillRoot, instruction, run };
}

for (const product of ["codex", "claude-code"] as const) {
  test(`${product} project install copies skills and writes portable references without changing user instructions`, async () => {
    const f = await fixture(product);
    await writeFile(join(f.project, f.instruction), "User instructions\n");
    const target = join(f.project, f.skillRoot, "example/SKILL.md");
    expect((await f.run("plan")).conflicts).toEqual([]);
    expect(await Bun.file(target).exists()).toBe(false);
    await f.run("apply");
    expect(await readFile(target, "utf8")).toBe("# Example\n");
    const instructions = await readFile(join(f.project, f.instruction), "utf8");
    expect(instructions).toStartWith("User instructions\n");
    expect(instructions).toContain(`${f.skillRoot}/example/SKILL.md`);
    expect(instructions).toContain(".space/babel");
    expect(instructions).not.toContain(f.project); expect(instructions).not.toContain(f.pluginRoot);
    await f.run("apply");
    expect((await f.run("status")).actions.every(action => action.action === "unchanged")).toBe(true);
    await expect(runSetup({ command: "apply", project: f.project, pluginRoot: f.pluginRoot })).rejects.toThrow("project");
    expect(await readFile(join(f.project, f.instruction), "utf8")).toBe(instructions);
  });

  test(`${product} project updates protect edited and unrelated skills`, async () => {
    const f = await fixture(product); await f.run("apply");
    const target = join(f.project, f.skillRoot, "example/SKILL.md");
    const own = join(f.project, f.skillRoot, "own/SKILL.md");
    await mkdir(join(own, "..")); await writeFile(own, "Own skill\n");
    await writeFile(join(f.pluginRoot, "skills/example/SKILL.md"), "# Version two\n");
    await f.run("apply"); expect(await readFile(target, "utf8")).toBe("# Version two\n");
    await writeFile(target, "Local edit\n");
    await writeFile(join(f.pluginRoot, "skills/example/SKILL.md"), "# Version three\n");
    await expect(f.run("apply")).rejects.toThrow("conflict");
    expect(await readFile(target, "utf8")).toBe("Local edit\n");
    expect(await readFile(own, "utf8")).toBe("Own skill\n");
  });

  test(`${product} can migrate an existing plugin setup while protecting conflicting skills`, async () => {
    const f = await fixture(product);
    await runSetup({ command: "apply", project: f.project, pluginRoot: f.pluginRoot });
    const before = await readFile(join(f.project, f.instruction), "utf8");
    const target = join(f.project, f.skillRoot, "example/SKILL.md");
    await mkdir(join(target, ".."), { recursive: true }); await writeFile(target, "Existing skill\n");
    await expect(f.run("apply")).rejects.toThrow("conflict");
    expect(await readFile(join(f.project, f.instruction), "utf8")).toBe(before);
    await writeFile(target, "# Example\n"); await f.run("apply");
    expect(await readFile(join(f.project, f.instruction), "utf8")).not.toContain(f.pluginRoot);
    expect(JSON.parse(await readFile(join(f.project, `.space/setup/koto-${product}.json`), "utf8")).scope).toBe("project");
  });
}

test("project installation refuses another product's skill directory", async () => {
  const f = await fixture("codex");
  f.manifest.files[1]!.destination = ".claude/skills/example/SKILL.md";
  await writeFile(join(f.pluginRoot, "setup-manifest.project.json"), JSON.stringify(f.manifest));
  await expect(f.run("apply")).rejects.toThrow("outside allowed");
  expect(await Bun.file(join(f.project, "AGENTS.md")).exists()).toBe(false);
});
