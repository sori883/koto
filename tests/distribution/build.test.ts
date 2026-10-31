import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { build, checkBuild } from "../../scripts/build.ts";

let root: string;
async function put(path: string, body: string) { await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), body); }
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "koto-build-"));
  await put("package.json", JSON.stringify({ version: "1.2.3" }));
  for (const product of ["codex", "claude-code"]) {
    await put(`packaging/${product}/plugin.json`, JSON.stringify({ name: "koto", description: "Development tools", author: { name: "author" } }));
    await put(`packaging/${product}/marketplace.json`, JSON.stringify({ name: "koto", plugins: [] }));
    await put(`packaging/${product}/templates/${product === "codex" ? "AGENTS.md" : "CLAUDE.md"}`, "Use {{SKILL_ROOT}}\n");
  }
  await put("skills/example/SKILL.md", "---\nname: example\ndescription: Example\n---\n\nSee [guide](references/guide.md).\n");
  await put("skills/example/references/guide.md", "# Guide\n");
  await put("skills/example/UNICODE-LICENSE.txt", "Unicode copyright and permission notice\n");
  await put("skills/example/scripts/main.ts", "export {};\n");
  await put("skills/example/scripts/package.json", '{"dependencies":{}}\n');
  await put("skills/example/tests/private.test.ts", "Do not distribute\n");
  await put("skills/example/scripts/node_modules/private/index.js", "Do not distribute\n");
  await put("skills/example/scripts/__pycache__/lint.cpython-313.pyc", "Do not distribute\n");
  await put("skills/example/scripts/.venv/pyvenv.cfg", "Do not distribute\n");
  await put("docs/private.md", "Maintainer notes\n");
  await put(".space/default/private.md", "Project knowledge\n");
  await put("space/default/index.md", "# Shared knowledge\n");
  await put("cli/monorepo/package.json", JSON.stringify({ name: "@koto/monorepo", version: "0.0.0" }));
  await put("cli/monorepo/monorepo.ts", "#!/usr/bin/env bun\nexport {};\n");
  await put("cli/monorepo/lib/example.ts", "export {};\n");
  await put("cli/monorepo/tests/private.test.ts", "Do not distribute\n");
  await put("cli/monorepo/node_modules/private/index.js", "Do not distribute\n");
  await put("cli/tasks/package.json", JSON.stringify({ name: "@koto/tasks", version: "0.0.0" }));
  await put("cli/tasks/tasks.ts", "#!/usr/bin/env bun\nexport {};\n");
  await put("cli/tasks/lib/example.ts", "export {};\n");
  await put("cli/tasks/tests/private.test.ts", "Do not distribute\n");
  await put("cli/tasks/node_modules/private/index.js", "Do not distribute\n");
  await put("cli/memory/package.json", JSON.stringify({ name: "@koto/memory", version: "0.0.0" }));
  await put("cli/memory/memory.ts", "#!/usr/bin/env bun\nexport {};\n");
  await put("cli/memory/lib/example.ts", "export {};\n");
  await put("cli/memory/tests/private.test.ts", "Do not distribute\n");
  await put("cli/memory/node_modules/private/index.js", "Do not distribute\n");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("builds both self-contained products and creates catalogs with the root version", async () => {
  await build(root);
  for (const product of ["codex", "claude-code"]) {
    const dist = join(root, "dist", product, "koto");
    const manifest = JSON.parse(await readFile(join(dist, product === "codex" ? ".codex-plugin/plugin.json" : ".claude-plugin/plugin.json"), "utf8"));
    expect(manifest.version).toBe("1.2.3");
    expect(await Bun.file(join(dist, "skills/example/scripts/main.ts")).exists()).toBe(true);
    expect(await Bun.file(join(dist, "skills/example/UNICODE-LICENSE.txt")).text()).toBe("Unicode copyright and permission notice\n");
    for (const path of ["docs/private.md", ".space/default/private.md", "skills/example/tests/private.test.ts", "skills/example/scripts/node_modules/private/index.js", "skills/example/scripts/__pycache__/lint.cpython-313.pyc", "skills/example/scripts/.venv/pyvenv.cfg"]) expect(await Bun.file(join(dist, path)).exists()).toBe(false);
    expect(manifest.skills).toBe("./skills/");
    expect(await Bun.file(join(dist, "space/default/index.md")).text()).toBe("# Shared knowledge\n");
    expect(await Bun.file(join(dist, "setup-manifest.json")).exists()).toBe(false);
    expect(JSON.parse(await readFile(join(dist, "cli/monorepo/package.json"), "utf8")).version).toBe("1.2.3");
    expect(await Bun.file(join(dist, "cli/monorepo/lib/example.ts")).exists()).toBe(true);
    expect(await Bun.file(join(dist, "cli/monorepo/tests/private.test.ts")).exists()).toBe(false);
    expect(await Bun.file(join(dist, "cli/monorepo/node_modules/private/index.js")).exists()).toBe(false);
    expect(JSON.parse(await readFile(join(dist, "cli/tasks/package.json"), "utf8")).version).toBe("1.2.3");
    expect(await Bun.file(join(dist, "cli/tasks/lib/example.ts")).exists()).toBe(true);
    expect(await Bun.file(join(dist, "cli/tasks/tests/private.test.ts")).exists()).toBe(false);
    expect(await Bun.file(join(dist, "cli/tasks/node_modules/private/index.js")).exists()).toBe(false);
    expect(JSON.parse(await readFile(join(dist, "cli/memory/package.json"), "utf8")).version).toBe("1.2.3");
    expect(await Bun.file(join(dist, "cli/memory/lib/example.ts")).exists()).toBe(true);
    expect(await Bun.file(join(dist, "cli/memory/tests/private.test.ts")).exists()).toBe(false);
    expect(await Bun.file(join(dist, "cli/memory/node_modules/private/index.js")).exists()).toBe(false);
  }
  const codex = JSON.parse(await readFile(join(root, ".agents/plugins/marketplace.json"), "utf8"));
  expect(codex.plugins[0].source.path).toBe("./dist/codex/koto");
  const claude = JSON.parse(await readFile(join(root, ".claude-plugin/marketplace.json"), "utf8"));
  expect(claude.plugins[0].source).toBe("./dist/claude-code/koto");
  expect(await checkBuild(root)).toEqual([]);
});

test("check detects extra untracked files, changed content, and missing generated files", async () => {
  await build(root);
  await put("dist/codex/koto/untracked.txt", "extra\n");
  await put("dist/claude-code/koto/skills/example/SKILL.md", "edited\n");
  await rm(join(root, "dist/codex/koto/skills/example/references/guide.md"));
  expect(await checkBuild(root)).toEqual(expect.arrayContaining([
    "extra: dist/codex/koto/untracked.txt",
    "changed: dist/claude-code/koto/skills/example/SKILL.md",
    "missing: dist/codex/koto/skills/example/references/guide.md",
  ]));
  await build(root); expect(await checkBuild(root)).toEqual([]);
});

test("rejects missing links and symlinked inputs before replacing an existing build", async () => {
  await build(root);
  const path = join(root, "dist/codex/koto/skills/example/SKILL.md"); const before = await readFile(path, "utf8");
  await put("skills/example/SKILL.md", "[missing](references/no.md)\n");
  await expect(build(root)).rejects.toThrow("link");
  expect(await readFile(path, "utf8")).toBe(before);
  await put("skills/example/SKILL.md", "# Example\n");
  await symlink(join(root, "docs/private.md"), join(root, "skills/example/references/leak.md"));
  await expect(build(root)).rejects.toThrow("Symlink");
  expect(await readFile(path, "utf8")).toBe(before);
  await rm(join(root, "skills/example/references/leak.md"));
  await rm(join(root, "packaging/codex/templates/AGENTS.md"));
  await symlink(join(root, "docs/private.md"), join(root, "packaging/codex/templates/AGENTS.md"));
  await expect(build(root)).rejects.toThrow("Symlink");
  expect(await readFile(path, "utf8")).toBe(before);
});

test("builds without a skills directory and removes stale skill and setup files", async () => {
  await build(root);
  await put("dist/claude-code/koto/setup-manifest.copilot.json", "{}\n");
  await put("dist/claude-code/koto/templates/copilot-instructions.md", "Old instructions\n");
  await rm(join(root, "skills"), { recursive: true });
  await build(root);
  for (const product of ["codex", "claude-code"]) {
    const dist = join(root, "dist", product, "koto");
    const manifest = JSON.parse(await readFile(join(dist, product === "codex" ? ".codex-plugin/plugin.json" : ".claude-plugin/plugin.json"), "utf8"));
    expect(manifest.skills).toBeUndefined();
    for (const path of ["skills/example/SKILL.md", "setup-manifest.json", "setup-manifest.project.json", "setup-manifest.copilot.json", "templates/copilot-instructions.md"]) {
      expect(await Bun.file(join(dist, path)).exists()).toBe(false);
    }
  }
  expect(await checkBuild(root)).toEqual([]);
});

test("each distributed monorepo CLI runs outside the checkout without development dependencies", async () => {
  await cp(resolve(import.meta.dir, "../../cli/monorepo"), join(root, "cli/monorepo"), { recursive: true });
  await cp(resolve(import.meta.dir, "../../skills/monorepo"), join(root, "skills/monorepo"), { recursive: true });
  await build(root);
  await rm(join(root, "cli"), { recursive: true });
  await rm(join(root, "skills"), { recursive: true });
  for (const product of ["codex", "claude-code"]) {
    const entry = join(root, "dist", product, "koto/cli/monorepo/monorepo.ts");
    const destination = join(root, `use-${product}`);
    const child = Bun.spawn([entry, "setup", "--root", destination, "--json"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, err }).toEqual({ code: 0, err: "" });
    expect(JSON.parse(out).ok).toBe(true);
    expect(JSON.parse(await readFile(join(destination, ".space/default/monorepo.json"), "utf8")).id).toBe("default");
  }
});

test("each distributed Tasks CLI works without the source tree, monorepo CLI, or package installation", async () => {
  await cp(resolve(import.meta.dir, "../../cli/tasks"), join(root, "cli/tasks"), { recursive: true });
  await cp(resolve(import.meta.dir, "../../skills/tasks"), join(root, "skills/tasks"), { recursive: true });
  await build(root);
  await rm(join(root, "cli"), { recursive: true });
  await rm(join(root, "skills"), { recursive: true });
  for (const product of ["codex", "claude-code"]) {
    const dist = join(root, "dist", product, "koto");
    await rm(join(dist, "cli/monorepo"), { recursive: true });
    const destination = join(root, "tasks-only-" + product);
    const cli = join(dist, "cli/tasks/tasks.ts");
    for (const args of [
      ["setup"],
      ["task", "add", "job", "--title", "独立したタスク", "--operation-id", "add"],
    ]) {
      const child = Bun.spawn([cli, ...args, "--root", destination, "--json"], { cwd: root, stdout: "pipe", stderr: "pipe" });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ code, err }).toEqual({ code: 0, err: "" });
      expect(JSON.parse(out).ok).toBe(true);
    }
    expect(JSON.parse(await readFile(join(destination, ".space/default/tasks/state.json"), "utf8")).tasks.job.title).toBe("独立したタスク");
  }
});

test("distributed Memory, Tasks and monorepo preserve each other's data through worktree cleanup", async () => {
  for (const name of ["tasks", "monorepo", "memory"]) {
    await cp(resolve(import.meta.dir, "../../cli", name), join(root, "cli", name), { recursive: true });
    await cp(resolve(import.meta.dir, "../../skills", name), join(root, "skills", name), { recursive: true });
  }
  await build(root);
  await rm(join(root, "cli"), { recursive: true });
  await rm(join(root, "skills"), { recursive: true });
  const remote = join(root, "remote");
  await mkdir(remote);
  async function git(...args: string[]) {
    const child = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", "-c", "user.name=Koto Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgSign=false", ...args], { cwd: remote, stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code, out + err).toBe(0);
  }
  await git("init", "--initial-branch=main");
  await writeFile(join(remote, "README.md"), "Fixture repository\n");
  await git("add", "README.md"); await git("commit", "-m", "Initial fixture");
  for (const product of ["codex", "claude-code"]) {
    const destination = join(root, "combined-" + product), dist = join(root, "dist", product, "koto");
    async function cli(name: string, command: string[], input: Record<string, unknown> = {}) {
      const child = Bun.spawn([join(dist, "cli", name, name + ".ts"), "--input-json", JSON.stringify({ root: destination, command, ...input })], { cwd: root, stdout: "pipe", stderr: "pipe" });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ code, err }, out).toEqual({ code: 0, err: "" });
      const response = JSON.parse(out); expect(response.ok).toBe(true); return response;
    }
    await cli("tasks", ["setup"]);
    await cli("tasks", ["task", "add", "job"], { title: "Integration", operationId: "add" });
    const taskPath = join(destination, ".space/default/tasks/state.json"), taskBefore = await readFile(taskPath, "utf8");
    await cli("monorepo", ["setup"]);
    await cli("monorepo", ["repo", "add", "api"], { url: remote });
    await cli("monorepo", ["workspace", "create", "job"], { repo: ["api"] });
    expect(await readFile(taskPath, "utf8")).toBe(taskBefore);
    const monoPath = join(destination, ".space/default/monorepo.json"), monoBefore = await readFile(monoPath, "utf8");
    await cli("memory", ["setup"]);
    await cli("memory", ["create", "knowledge/repository"], { metadata: { type: "knowledge", title: "Repository", description: "Repository layout", code_refs: ["workspaces/default/job/api/README.md"] }, body: "Repository document" });
    expect((await cli("memory", ["validate"], { strict: true, drift: true })).data.gate_passed).toBe(true);
    expect(await readFile(taskPath, "utf8")).toBe(taskBefore);
    expect(await readFile(monoPath, "utf8")).toBe(monoBefore);
    const memoryPath = join(destination, ".space/default/memory/knowledge/repository.md"), memoryBefore = await readFile(memoryPath, "utf8");
    await cli("tasks", ["workspace", "link", "job"], { repo: ["api"], ifVersion: 1, operationId: "link" });
    await cli("tasks", ["task", "start", "job"], { ifVersion: 2, operationId: "start" });
    await cli("tasks", ["artifact", "add", "job", "readme"], { ref: "workspaces/default/job/api/README.md", description: "Repository document", ifVersion: 3, operationId: "artifact" });
    await cli("tasks", ["checkpoint", "save", "job", "handoff"], { summary: "Checked the repository", next: "Report completion", ifVersion: 4, operationId: "checkpoint" });
    await cli("tasks", ["task", "complete", "job"], { result: "Repository document verified", ifVersion: 4, operationId: "complete" });
    expect(await readFile(monoPath, "utf8")).toBe(monoBefore);
    const taskAfter = await readFile(taskPath, "utf8");
    await cli("monorepo", ["workspace", "remove", "job"], { dryRun: true });
    await cli("monorepo", ["workspace", "remove", "job"]);
    expect(await readFile(taskPath, "utf8")).toBe(taskAfter);
    expect(await readFile(memoryPath, "utf8")).toBe(memoryBefore);
    expect((await cli("memory", ["show", "knowledge/repository"])).data.body).toBe("Repository document");
    expect((await cli("memory", ["validate"], { drift: true })).data.warnings.join("\n")).toContain("matches no accessible path");
    expect((await cli("tasks", ["task", "show", "job"])).data.completionCurrent).toBe(true);
    expect(JSON.parse(await readFile(join(destination, ".space/default/checkpoint/job/handoff.json"), "utf8")).snapshot.artifacts[0].id).toBe("readme");
    expect((await cli("tasks", ["doctor"])).data.healthy).toBe(true);
    expect((await cli("monorepo", ["doctor"])).data.healthy).toBe(true);
  }
}, 30000);


test("distributed Memory runs alone with the bundled version after removing source and other CLIs", async () => {
  await cp(resolve(import.meta.dir, "../../cli/memory"), join(root, "cli/memory"), { recursive: true });
  await cp(resolve(import.meta.dir, "../../skills/memory"), join(root, "skills/memory"), { recursive: true });
  await build(root);
  await rm(join(root, "cli"), { recursive: true }); await rm(join(root, "skills"), { recursive: true });
  for (const product of ["codex", "claude-code"]) {
    const dist = join(root, "dist", product, "koto"), destination = join(root, "memory-only-" + product);
    await mkdir(destination);
    for (const name of ["monorepo", "tasks"]) await rm(join(dist, "cli", name), { recursive: true });
    const entry = join(dist, "cli/memory/memory.ts");
    async function cli(command: string[], fields = {}) {
      const child = Bun.spawn([entry, "--input-json", JSON.stringify({ command, root: destination, ...fields })], { cwd: destination, stdout: "pipe", stderr: "pipe" });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ code, err }, out).toEqual({ code: 0, err: "" });
      const response = JSON.parse(out); expect(response.ok).toBe(true); return response.data;
    }
    expect((await cli(["version"])).version).toBe("1.2.3");
    await cli(["setup"]);
    await cli(["create", "decisions/auth"], { metadata: { type: "decision", title: "認証判断", description: "方式を選んだ理由" }, body: "判断の内容" });
    expect((await cli(["search", "認証"]))).toHaveLength(1);
    expect((await cli(["search", "認証"], { recordUsage: true, usageSource: "devlow" }))).toHaveLength(1);
    const shown = await cli(["show", "decisions/auth"], { recordUsage: true, taskId: "task-1" });
    expect((await cli(["usage", "stats"]))).toMatchObject({ events: 2, searches: 1, shows: 1 });
    expect((await cli(["usage", "list"], { taskId: "task-1" })).events[0].content_hash).toBe(shown.content_hash);
    await cli(["update", "decisions/auth"], { ifHash: shown.content_hash, body: "更新した理由" });
    expect((await cli(["validate"], { strict: true })).gate_passed).toBe(true);
    await cli(["delete", "decisions/auth"], { dryRun: true });
    await cli(["delete", "decisions/auth"]);
    expect((await cli(["validate"])).concept_count).toBe(0);
    expect((await cli(["usage", "stats"])).concepts[0]).toMatchObject({ concept_id: "decisions/auth", search_results: 1, shows: 1 });
  }
});


test("licensed development skills ship with complete notices and resolvable bundled dependencies", async () => {
  const source = resolve(import.meta.dir, "../..");
  const provenance = JSON.parse(await readFile(join(source, "docs/devlow-restoration-source.json"), "utf8"));
  const names = ["devlow", "recall", "tdd", "blast-radius", "interrogate"];
  for (const name of [...names, "monorepo", "tasks", "memory"]) await cp(join(source, "skills", name), join(root, "skills", name), { recursive: true });
  for (const name of ["monorepo", "tasks", "memory"]) await cp(join(source, "cli", name), join(root, "cli", name), { recursive: true });
  await build(root);
  for (const name of names) {
    const notice = await readFile(join(source, "skills", name, "LICENSE"));
    expect(createHash("sha256").update(notice).digest("hex")).toBe(provenance.skills[name][`skills/${name}/LICENSE`]);
    for (const product of ["codex", "claude-code"]) {
      const dist = join(root, "dist", product, "koto");
      expect(await readFile(join(dist, "skills", name, "LICENSE"))).toEqual(notice);
      expect(await readFile(join(dist, "skills", name, "SKILL.md"))).toEqual(await readFile(join(source, "skills", name, "SKILL.md")));
      expect(await Bun.file(join(dist, "docs/devlow-restoration-source.json")).exists()).toBe(false);
    }
  }
  const tdd = await readFile(join(source, "skills/tdd/SKILL.md"));
  expect(createHash("sha256").update(tdd).digest("hex")).toBe(provenance.skills.tdd["skills/tdd/SKILL.md"]);
  expect(await checkBuild(root)).toEqual([]);
});

test("both distributed instruction updaters work after removing their source checkout", async () => {
  const source = resolve(import.meta.dir, "../..");
  for (const name of ["cli", "skills", "templates"]) await cp(join(source, name), join(root, name), { recursive: true });
  for (const product of ["codex", "claude-code"]) await rm(join(root, "packaging", product, "templates"), { recursive: true });
  await build(root);
  for (const name of ["cli", "skills", "templates"]) await rm(join(root, name), { recursive: true });
  for (const product of ["codex", "claude-code"]) {
    const dist = await realpath(join(root, "dist", product, "koto")), management = join(root, product + "-management"), target = join(root, product + "-target");
    await mkdir(target); const instruction = join(target, product === "codex" ? "AGENTS.md" : "CLAUDE.md");
    await writeFile(instruction, "# Local rules\nKeep these.\n");
    async function run(command: string[], fields = {}) {
      const child = Bun.spawn([process.execPath, join(dist, "cli/monorepo/monorepo.ts"), "--input-json", JSON.stringify({ command, root: management, ...fields })], { cwd: root, stdout: "pipe", stderr: "pipe" });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ code, err }, out).toEqual({ code: 0, err: "" }); return JSON.parse(out).data;
    }
    await run(["setup"]);
    const plan = await run(["instructions", "plan"], { target, product }); expect(plan.canApply).toBe(true);
    expect(await readFile(instruction, "utf8")).toBe("# Local rules\nKeep these.\n");
    expect((await run(["instructions", "apply"], { target, product })).current).toBe(true);
    const actual = await readFile(instruction, "utf8"); expect(actual.startsWith("# Local rules\nKeep these.\n")).toBe(true);
    const refs = [...actual.matchAll(/\]\(<([^>]+)>\)/g)].map(m => decodeURIComponent(m[1]!));
    expect(refs.length).toBe(5);
    for (const ref of refs) { expect(ref.startsWith(dist + "/skills/")).toBe(true); expect(await Bun.file(ref).exists()).toBe(true); }
    expect(actual).not.toContain(source);
    expect((await run(["instructions", "status"], { target, product })).current).toBe(true);
    expect((await run(["instructions", "apply"], { target, product })).action).toBe("unchanged");
    expect(await readFile(instruction, "utf8")).toBe(actual);
  }
});
