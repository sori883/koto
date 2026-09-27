import { afterEach, expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { watch } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSetup } from "../scripts/lib/setup.ts";
import { instructionFiles } from "../scripts/lib/model.ts";
import type { Product } from "../scripts/lib/model.ts";

const roots: string[] = [];
async function fixture(plugin = "koto", product: Product = "codex") {
  const root = await mkdtemp(join(tmpdir(), "setup-test-")); roots.push(root);
  const pluginRoot = join(root, "plugin"), project = join(root, "consumer");
  await mkdir(join(pluginRoot, "templates"), { recursive: true }); await mkdir(project);
  const files = [
    { source: "templates/rule.md", destination: ".space/babel/rules/rule.md", mode: "copy" },
    { source: "templates/instructions.md", destination: instructionFiles[product], mode: "managed-block" }
  ];
  const manifest = { schemaVersion: 1, plugin, product, version: "1.0.0", files };
  await writeFile(join(pluginRoot, "setup-manifest.json"), JSON.stringify(manifest));
  await writeFile(join(pluginRoot, "templates/rule.md"), "version one\n");
  await writeFile(join(pluginRoot, "templates/instructions.md"), "Use {{SKILL_ROOT}} and {{BABEL_BUNDLE}}.\n");
  const run = (command: "plan" | "apply" | "status") => runSetup({ command, project, pluginRoot });
  return { root, project, pluginRoot, manifest, run, copy: join(project, files[0]!.destination) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test("plan is read-only; apply creates files once and preserves existing instructions", async () => {
  const f = await fixture(); await writeFile(join(f.project, "AGENTS.md"), "User instructions\n");
  const plan = await f.run("plan"); expect(plan.conflicts).toEqual([]);
  expect(await Bun.file(f.copy).exists()).toBe(false);
  await f.run("apply");
  const first = await readFile(join(f.project, "AGENTS.md"), "utf8");
  expect(first).toStartWith("User instructions\n"); expect(first).toContain(join(f.pluginRoot, "skills"));
  expect(first).toContain(join(f.project, ".space/babel")); expect(first).not.toContain("{{");
  await f.run("apply"); expect(await readFile(join(f.project, "AGENTS.md"), "utf8")).toBe(first);
  expect((await f.run("status")).actions.every((a: any) => a.action === "unchanged")).toBe(true);
});

async function addSharedFiles(f: Awaited<ReturnType<typeof fixture>>) {
  for (const [name, mode, content] of [
    ["index.md", "merge-index", '---\nokf_version: "0.2"\n---\n\n# Knowledge Base\n* [rules](rules/index.md)\n'],
    ["rules/index.md", "merge-index", "# rules\n* [Rule](rule.md) - Shared rule\n"],
    ["log.md", "seed", "# Document history\n"],
    ["LICENSE", "seed", "Shared license\n"],
  ]) {
    const source = `space/babel/${name}`;
    await mkdir(join(f.pluginRoot, source, ".."), { recursive: true });
    await writeFile(join(f.pluginRoot, source), content!);
    f.manifest.files.push({ source, destination: `.space/babel/${name}`, mode: mode! });
  }
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
}

test("existing Babel navigation, history, license and own documents survive install and later edits", async () => {
  const f = await fixture(); await addSharedFiles(f);
  await mkdir(join(f.project, ".space/babel/rules"), { recursive: true });
  const rootIndex = '---\nokf_version: "0.2"\nowner: consumer\n---\n\n# My knowledge\n* [My rules](./rules/index.md)\n';
  await writeFile(join(f.project, ".space/babel/index.md"), rootIndex);
  const localIndex = "# My rules\n\nLocal explanation.\n* [Own](own.md) - Local rule\n";
  await writeFile(join(f.project, ".space/babel/rules/index.md"), localIndex);
  await writeFile(join(f.project, ".space/babel/rules/own.md"), "own content\n");
  await writeFile(join(f.project, ".space/babel/log.md"), "My history\n");
  await writeFile(join(f.project, ".space/babel/LICENSE"), "My license\n");
  await f.run("apply");
  expect(await readFile(join(f.project, ".space/babel/index.md"), "utf8")).toBe(rootIndex);
  const installedIndex = await readFile(join(f.project, ".space/babel/rules/index.md"), "utf8");
  expect(installedIndex).toStartWith(localIndex); expect(installedIndex).toContain("* [Rule](rule.md) - Shared rule");
  await writeFile(join(f.project, ".space/babel/rules/index.md"), installedIndex + "\nMore project notes.\n");
  await writeFile(join(f.project, ".space/babel/log.md"), "My updated history\n");
  await f.run("apply");
  expect(await readFile(join(f.project, ".space/babel/rules/index.md"), "utf8")).toEndWith("More project notes.\n");
  expect(await readFile(join(f.project, ".space/babel/log.md"), "utf8")).toBe("My updated history\n");
  expect(await readFile(join(f.project, ".space/babel/LICENSE"), "utf8")).toBe("My license\n");
  expect(await readFile(join(f.project, ".space/babel/rules/own.md"), "utf8")).toBe("own content\n");
  expect((await f.run("status")).actions.every(a => a.action === "unchanged")).toBe(true);
});

test("shared index updates refresh unchanged listings and stop on competing local edits", async () => {
  const f = await fixture(); await addSharedFiles(f); await f.run("apply");
  const index = join(f.project, ".space/babel/rules/index.md");
  await writeFile(join(f.pluginRoot, "space/babel/rules/index.md"), "# rules\n* [Rule v2](rule.md) - Updated rule\n");
  await f.run("apply");
  expect(await readFile(index, "utf8")).toContain("Rule v2");
  await writeFile(index, (await readFile(index, "utf8")).replace("Updated rule", "Local summary"));
  await f.run("apply"); // Local index edits alone do not block setup.
  await writeFile(join(f.pluginRoot, "space/babel/rules/index.md"), "# rules\n* [Rule v3](rule.md) - New upstream summary\n");
  await expect(f.run("apply")).rejects.toThrow("conflict");
  expect(await readFile(index, "utf8")).toContain("Local summary");
});

test("shared index merge does not mistake fenced examples for navigation and adds OKF metadata without erasing prose", async () => {
  const f = await fixture(); await addSharedFiles(f);
  await mkdir(join(f.project, ".space/babel"), { recursive: true });
  const original = '# My notes\n\n```markdown\n* [rules](rules/index.md)\n```\n';
  await writeFile(join(f.project, ".space/babel/index.md"), original);
  await f.run("apply");
  const merged = await readFile(join(f.project, ".space/babel/index.md"), "utf8");
  expect(merged).toStartWith('---\nokf_version: "0.2"\n---\n');
  expect(merged).toContain(original); expect(merged).toEndWith('* [rules](rules/index.md)\n');
  await f.run("apply"); expect(await readFile(join(f.project, ".space/babel/index.md"), "utf8")).toBe(merged);
});

test("shared modes cannot be used to overwrite knowledge or other project paths", async () => {
  const f = await fixture();
  for (const [destination, mode] of [[".space/babel/rules/rule.md", "seed"], [".space/babel/rules/rule.md", "merge-index"], [".space/babel/vendor/other/index.md", "merge-index"], [".space/babel/index.md", "copy"], [".space/tasks/log.md", "seed"]]) {
    Object.assign(f.manifest.files[0]!, { destination, mode });
    await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
    await expect(f.run("apply")).rejects.toThrow("outside allowed");
  }
});

test("invalid shared indexes stop before any file is placed", async () => {
  const f = await fixture(); await addSharedFiles(f);
  await mkdir(join(f.project, ".space/babel"), { recursive: true });
  const index = join(f.project, ".space/babel/index.md");
  for (const text of ['---\nokf_version: "0.1"\n---\n', '---\nunterminated header\n', '# Index\n```md\n', '# Index\n<!-- unfinished\n']) {
    await writeFile(index, text);
    await expect(f.run("apply")).rejects.toThrow("conflict");
    expect(await readFile(index, "utf8")).toBe(text);
    expect(await Bun.file(f.copy).exists()).toBe(false);
  }
});

for (const product of ["codex", "claude-code", "copilot"] as const) test(`${product} upgrades vendor installs without deleting old files and protects edits before migration`, async () => {
  const f = await fixture();
  f.manifest.product = product;
  f.manifest.files[1]!.destination = product === "codex" ? "AGENTS.md" : product === "claude-code" ? "CLAUDE.md" : ".github/copilot-instructions.md";
  const entry = f.manifest.files[0]!, direct = entry.destination;
  entry.destination = direct.replace(".space/babel/", ".space/babel/vendor/koto/");
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await f.run("apply");
  const legacy = join(f.project, entry.destination);
  await writeFile(legacy, "local vendor edit\n");
  entry.destination = direct; f.manifest.version = "2.0.0";
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await expect(f.run("apply")).rejects.toThrow("conflict");
  expect(await Bun.file(f.copy).exists()).toBe(false); expect(await readFile(legacy, "utf8")).toBe("local vendor edit\n");
  await writeFile(legacy, "version one\n");
  await f.run("apply");
  expect(await readFile(f.copy, "utf8")).toBe("version one\n"); expect(await readFile(legacy, "utf8")).toBe("version one\n");
  expect((await f.run("status")).conflicts).toEqual([]);
});

test("migration checks another product's legacy installation and untracked vendor content", async () => {
  const f = await fixture(), direct = f.manifest.files[0]!.destination;
  f.manifest.files[0]!.destination = direct.replace(".space/babel/", ".space/babel/vendor/koto/");
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await f.run("apply");
  const legacy = join(f.project, f.manifest.files[0]!.destination);
  f.manifest.files[0]!.destination = direct;
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await addCopilot(f);
  await writeFile(legacy, "local edit from Codex\n");
  const copilot = () => runSetup({ command: "apply", project: f.project, pluginRoot: f.pluginRoot, product: "copilot" });
  await expect(copilot()).rejects.toThrow("conflict");
  expect(await Bun.file(join(f.project, ".github/copilot-instructions.md")).exists()).toBe(false);
  await rm(join(f.project, ".space/setup/koto-codex.json"));
  await expect(copilot()).rejects.toThrow("conflict");
  await writeFile(legacy, "version one\n"); await copilot();
  expect(await readFile(f.copy, "utf8")).toBe("version one\n");
});

test("updates managed source and preserves edits outside its instruction block", async () => {
  const f = await fixture(); await f.run("apply");
  await writeFile(join(f.project, "AGENTS.md"), "BEFORE\n" + await readFile(join(f.project, "AGENTS.md"), "utf8") + "AFTER\n");
  await writeFile(join(f.pluginRoot, "templates/rule.md"), "version two\n");
  await writeFile(join(f.pluginRoot, "templates/instructions.md"), "New instructions\n");
  await f.run("apply"); expect(await readFile(f.copy, "utf8")).toBe("version two\n");
  const result = await readFile(join(f.project, "AGENTS.md"), "utf8");
  expect(result).toStartWith("BEFORE\n"); expect(result).toEndWith("AFTER\n"); expect(result).toContain("New instructions");
});

test("local conflict prevents every destination write", async () => {
  const f = await fixture(); await f.run("apply");
  const instructions = await readFile(join(f.project, "AGENTS.md"), "utf8");
  await writeFile(f.copy, "local edit\n"); await writeFile(join(f.pluginRoot, "templates/instructions.md"), "NEW\n");
  expect((await f.run("plan")).conflicts).toHaveLength(1);
  await expect(f.run("apply")).rejects.toThrow("conflict");
  expect(await readFile(join(f.project, "AGENTS.md"), "utf8")).toBe(instructions);
  expect(await readFile(f.copy, "utf8")).toBe("local edit\n");
});

test("refuses source and destination traversal and symlinks", async () => {
  const f = await fixture();
  f.manifest.files[0]!.source = "../outside.md";
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await expect(f.run("plan")).rejects.toThrow();
  f.manifest.files[0]!.source = "templates/rule.md";
  f.manifest.files[0]!.destination = ".space/babel/../other/rule.md";
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await expect(f.run("apply")).rejects.toThrow();
  f.manifest.files[0]!.destination = ".space/babel/rules/rule.md";
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await symlink(join(f.pluginRoot, "templates"), join(f.project, ".space"));
  await expect(f.run("apply")).rejects.toThrow("symlink");
});

test("removed sources are retained in destination", async () => {
  const f = await fixture(); await f.run("apply"); f.manifest.files.shift();
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  const result = await f.run("apply"); expect(result.actions.some((a: any) => a.action === "retain")).toBe(true);
  expect(await readFile(f.copy, "utf8")).toBe("version one\n");
});

test("refuses source symlinks, leaf destination symlinks, and unknown destinations", async () => {
  const f = await fixture();
  await rm(join(f.pluginRoot, "templates/rule.md")); await symlink(join(f.pluginRoot, "templates/instructions.md"), join(f.pluginRoot, "templates/rule.md"));
  await expect(f.run("plan")).rejects.toThrow("symlink");
  await rm(join(f.pluginRoot, "templates/rule.md")); await writeFile(join(f.pluginRoot, "templates/rule.md"), "ok");
  await symlink(join(f.pluginRoot, "templates/instructions.md"), join(f.project, "AGENTS.md"));
  await expect(f.run("plan")).rejects.toThrow("symlink");
  await rm(join(f.project, "AGENTS.md")); f.manifest.files[0]!.destination = "src/app.ts";
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await expect(f.run("plan")).rejects.toThrow("outside allowed");
});

test("an edited or duplicated managed block is a conflict; unrelated existing files survive", async () => {
  const f = await fixture(); await f.run("apply");
  const path = join(f.project, "AGENTS.md"), original = await readFile(path, "utf8");
  await writeFile(path, original.replace("Use ", "My local edit "));
  expect((await f.run("plan")).conflicts).toHaveLength(1);
  await writeFile(path, original + original);
  expect((await f.run("plan")).conflicts).toHaveLength(1);
  await writeFile(path, original); await writeFile(join(f.project, "untouched.md"), "user-owned");
  await f.run("apply"); expect(await readFile(join(f.project, "untouched.md"), "utf8")).toBe("user-owned");
});

test("existing unmanaged file conflicts before any metadata or destination is written", async () => {
  const f = await fixture(); await mkdir(join(f.project, ".space/babel/rules"), { recursive: true });
  await writeFile(f.copy, "user-owned"); await expect(f.run("apply")).rejects.toThrow("conflict");
  expect(await Bun.file(join(f.project, "AGENTS.md")).exists()).toBe(false);
  expect(await Bun.file(join(f.project, ".space/setup/koto-codex.json")).exists()).toBe(false);
  expect(await readFile(f.copy, "utf8")).toBe("user-owned");
});

test("locked apply preserves lock; broken state is not replaced", async () => {
  const f = await fixture(); await mkdir(join(f.project, ".space/setup"), { recursive: true });
  const lock = join(f.project, ".space/setup/koto.lock"); await writeFile(lock, "external lock");
  expect((await f.run("status")).locked).toBe(true); await expect(f.run("apply")).rejects.toThrow("locked");
  expect(await readFile(lock, "utf8")).toBe("external lock"); await rm(lock);
  const state = join(f.project, ".space/setup/koto-codex.json"); await writeFile(state, "not JSON");
  await expect(f.run("apply")).rejects.toThrow(); expect(await readFile(state, "utf8")).toBe("not JSON");
});

test("overlapping and case-equivalent destinations fail before writing", async () => {
  const f = await fixture();
  f.manifest.files.push({ ...f.manifest.files[0]!, destination: f.manifest.files[0]!.destination + "/child.md" });
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await expect(f.run("apply")).rejects.toThrow("overlapping");
  f.manifest.files[2]!.destination = f.manifest.files[0]!.destination.replace("rule.md", "RULE.md");
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await expect(f.run("plan")).rejects.toThrow("Duplicate");
  expect(await Bun.file(f.copy).exists()).toBe(false);
});

test("Claude configuration writes CLAUDE.md and refuses Codex agents", async () => {
  const f = await fixture(), manifest = { ...f.manifest, product: "claude-code", files: f.manifest.files.map(e => ({ ...e, destination: e.destination === "AGENTS.md" ? "CLAUDE.md" : e.destination })) };
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(manifest));
  await writeFile(join(f.project, "CLAUDE.md"), "local Claude instructions\n");
  await f.run("apply"); expect(await readFile(join(f.project, "CLAUDE.md"), "utf8")).toStartWith("local Claude instructions\n");
  expect(await Bun.file(join(f.project, "AGENTS.md")).exists()).toBe(false);
  manifest.files.push({ source: "templates/rule.md", destination: ".codex/agents/test.toml", mode: "copy" });
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(manifest));
  await expect(f.run("plan")).rejects.toThrow("outside allowed");
});

test("Codex agent definition preserves user files and updates only managed content", async () => {
  const f = await fixture();
  f.manifest.files.push({ source: "templates/rule.md", destination: ".codex/agents/helper.toml", mode: "copy" });
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await mkdir(join(f.project, ".codex/agents"), { recursive: true }); await writeFile(join(f.project, ".codex/agents/custom.toml"), "custom");
  await f.run("apply"); expect(await readFile(join(f.project, ".codex/agents/helper.toml"), "utf8")).toBe("version one\n");
  expect(await readFile(join(f.project, ".codex/agents/custom.toml"), "utf8")).toBe("custom");
});

test("both products converge on identical Babel updates while protecting different local edits", async () => {
  const f = await fixture(), claudeRoot = join(f.root, "claude");
  await cp(f.pluginRoot, claudeRoot, { recursive: true });
  const claudeManifest = { ...f.manifest, product: "claude-code", files: f.manifest.files.map(e => ({ ...e, destination: e.destination === "AGENTS.md" ? "CLAUDE.md" : e.destination })) };
  await writeFile(join(claudeRoot, "setup-manifest.json"), JSON.stringify(claudeManifest));
  const runClaude = (command: "apply" | "status") => runSetup({ command, project: f.project, pluginRoot: claudeRoot });
  await f.run("apply"); await runClaude("apply");
  f.manifest.version = "2.0.0"; claudeManifest.version = "2.0.0";
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await writeFile(join(claudeRoot, "setup-manifest.json"), JSON.stringify(claudeManifest));
  await writeFile(join(f.pluginRoot, "templates/rule.md"), "version two\n");
  await writeFile(join(claudeRoot, "templates/rule.md"), "version two\n");
  await f.run("apply");
  const result = await runClaude("apply"); expect(result.conflicts).toEqual([]);
  expect(result.actions.find(a => a.destination === f.manifest.files[0]!.destination)?.action).toBe("unchanged");
  for (const product of ["codex", "claude-code"]) expect(JSON.parse(await readFile(join(f.project, `.space/setup/koto-${product}.json`), "utf8")).version).toBe("2.0.0");
  expect((await f.run("status")).conflicts).toEqual([]); expect((await runClaude("status")).conflicts).toEqual([]);
  await writeFile(f.copy, "local content differs from both versions\n");
  await expect(f.run("apply")).rejects.toThrow("conflict"); await expect(runClaude("apply")).rejects.toThrow("conflict");
  expect(await readFile(f.copy, "utf8")).toBe("local content differs from both versions\n");
});

async function copyCLI(f: Awaited<ReturnType<typeof fixture>>) {
  const scripts = join(f.pluginRoot, "skills/setup/scripts");
  await cp(join(import.meta.dir, "../scripts"), scripts, { recursive: true, filter: path => !path.split("/").includes("node_modules") });
  return join(scripts, "setup.ts");
}
async function cli(entry: string, args: string[], cwd: string) {
  const process = Bun.spawn([Bun.which("bun")!, entry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  return { code, out, err, data: JSON.parse(out) };
}

async function addCopilot(f: Awaited<ReturnType<typeof fixture>>) {
  const manifest = { ...f.manifest, product: "copilot", files: f.manifest.files.map(e => ({ ...e, destination: e.destination === "AGENTS.md" ? ".github/copilot-instructions.md" : e.destination })) };
  await writeFile(join(f.pluginRoot, "setup-manifest.copilot.json"), JSON.stringify(manifest));
  return manifest;
}

test("Copilot CLI selection preserves existing instructions, isolates state, and converges on shared Babel updates", async () => {
  const f = await fixture(), entry = await copyCLI(f), copilot = await addCopilot(f);
  const path = join(f.project, ".github/copilot-instructions.md");
  await mkdir(join(f.project, ".github")); await writeFile(path, "User Copilot instructions\n");
  const args = ["--product", "copilot", "--project", f.project, "--json"];
  const plan = await cli(entry, ["plan", ...args], f.root);
  expect(plan.code).toBe(0); expect(plan.data.data.product).toBe("copilot");
  expect(await Bun.file(f.copy).exists()).toBe(false);
  expect((await cli(entry, ["apply", ...args], f.root)).code).toBe(0);
  const first = await readFile(path, "utf8");
  expect(first).toStartWith("User Copilot instructions\n");
  expect(first).toContain("koto:setup:koto:copilot:start");
  expect(first).toContain(join(f.pluginRoot, "skills"));
  expect(await Bun.file(join(f.project, "AGENTS.md")).exists()).toBe(false);
  expect(await Bun.file(join(f.project, "CLAUDE.md")).exists()).toBe(false);
  expect((await cli(entry, ["apply", ...args], f.root)).code).toBe(0);
  expect(await readFile(path, "utf8")).toBe(first);
  await f.run("apply");
  f.manifest.version = copilot.version = "2.0.0";
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await writeFile(join(f.pluginRoot, "setup-manifest.copilot.json"), JSON.stringify(copilot));
  await writeFile(join(f.pluginRoot, "templates/rule.md"), "version two\n");
  await writeFile(join(f.pluginRoot, "templates/instructions.md"), "Updated {{SKILL_ROOT}}\n");
  await writeFile(path, first + "Outside block edit\n");
  await f.run("apply");
  expect((await cli(entry, ["apply", ...args], f.root)).code).toBe(0);
  expect(await readFile(path, "utf8")).toStartWith("User Copilot instructions\n");
  expect(await readFile(path, "utf8")).toEndWith("Outside block edit\n");
  expect(await readFile(path, "utf8")).toContain("Updated ");
  for (const product of ["codex", "copilot"]) expect(JSON.parse(await readFile(join(f.project, `.space/setup/koto-${product}.json`), "utf8")).version).toBe("2.0.0");
  expect((await cli(entry, ["status", ...args], f.root)).data.data.actions.every((a: { action: string }) => a.action === "unchanged")).toBe(true);
  const edited = (await readFile(path, "utf8")).replace("Updated ", "Local instruction edit ");
  await writeFile(path, edited);
  expect((await cli(entry, ["apply", ...args], f.root)).code).toBe(3);
  expect(await readFile(path, "utf8")).toBe(edited);
});

test("product selection rejects unknown, unavailable, and mismatched manifests before writes", async () => {
  const f = await fixture(), entry = await copyCLI(f);
  for (const [product, error] of [["../outside", "INPUT"], ["copilot", "MANIFEST"]]) {
    const result = await cli(entry, ["apply", "--product", product!, "--project", f.project, "--json"], f.root);
    expect(result.code).toBe(2); expect(result.data.error.code).toBe(error);
  }
  const manifest = await addCopilot(f);
  for (const field of ["product", "plugin", "version"] as const) {
    await writeFile(join(f.pluginRoot, "setup-manifest.copilot.json"), JSON.stringify({ ...manifest, [field]: field === "product" ? "claude-code" : "other" }));
    const result = await cli(entry, ["apply", "--product", "copilot", "--project", f.project, "--json"], f.root);
    expect(result.code).toBe(2);
  }
  expect(await Bun.file(f.copy).exists()).toBe(false);
  expect(await Bun.file(join(f.project, ".space/setup/koto-copilot.json")).exists()).toBe(false);
  const explicit = await cli(entry, ["plan", "--product", "codex", "--project", f.project, "--json"], f.root);
  expect(explicit.code).toBe(0); expect(explicit.data.data.product).toBe("codex");
});

test("Copilot manifests refuse other products' instructions and agents", async () => {
  const f = await fixture(), manifest = await addCopilot(f);
  for (const destination of ["CLAUDE.md", "AGENTS.md", ".codex/agents/helper.toml", ".github/other.md"]) {
    manifest.files[1]!.destination = destination;
    await writeFile(join(f.pluginRoot, "setup-manifest.copilot.json"), JSON.stringify(manifest));
    await expect(runSetup({ command: "apply", project: f.project, pluginRoot: f.pluginRoot, product: "copilot" })).rejects.toThrow("outside allowed");
  }
  expect(await Bun.file(f.copy).exists()).toBe(false);
});

test("copied real CLI uses its own manifest/runtime and requires explicit project", async () => {
  const f = await fixture(), entry = await copyCLI(f);
  await writeFile(join(f.project, "package.json"), '{"name":"consumer"}\n');
  const missing = await cli(entry, ["plan", "--json"], f.project); expect(missing.code).toBe(2); expect(missing.data.error.code).toBe("INPUT");
  const plan = await cli(entry, ["plan", "--project", f.project, "--json"], f.root); expect(plan.code).toBe(0); expect(plan.data.data.actions).toHaveLength(2);
  expect(await Bun.file(join(f.project, ".space/setup/koto-codex.json")).exists()).toBe(false);
  const applied = await cli(entry, ["apply", "--project", f.project, "--json"], f.root); expect(applied.code).toBe(0);
  expect(await readFile(join(f.project, "package.json"), "utf8")).toBe('{"name":"consumer"}\n');
  expect(await Bun.file(join(f.pluginRoot, "skills/setup/scripts/node_modules/.setup-bootstrap.json")).exists()).toBe(true);
  const unknown = await cli(entry, ["plan", "--project", f.project, "--force", "--json"], f.root); expect(unknown.code).toBe(2);
});

test("actual killed CLI resumes a rename migration and does not replace unrelated edits", async () => {
  const f = await fixture("agent-gear"); await addSharedFiles(f); const entry = await copyCLI(f); await f.run("apply");
  const legacyState = await readFile(join(f.project, ".space/setup/agent-gear-codex.json"));
  f.manifest.plugin = "koto";
  await writeFile(join(f.pluginRoot, "space/babel/rules/index.md"), "# rules\n* [Updated](rule.md) - Changed description\n");
  await cli(entry, ["status", "--project", f.project, "--json"], f.root);
  const folder = join(f.project, ".space/babel/rules");
  for (let i = 0; i < 40; i++) {
    const source = `templates/extra-${i}.md`, destination = `.space/babel/rules/extra-${i}.md`;
    f.manifest.files.push({ source, destination, mode: "copy" }); await writeFile(join(f.pluginRoot, source), `content-${i}\n`.repeat(1000));
  }
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  let killed = false, stop = () => {};
  const observer = watch(folder, (_event, name) => { if (name === "extra-0.md") { killed = true; stop(); } });
  const process = Bun.spawn([Bun.which("bun")!, entry, "apply", "--project", f.project, "--json"], { stdout: "pipe", stderr: "pipe" });
  stop = () => { process.kill("SIGKILL"); };
  try {
    const [code, out, err] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
    if (!killed) throw new Error(`Writer exited before interruption: ${code}\n${out}\n${err}`);
  } finally { observer.close(); }
  const pendingPath = join(f.project, ".space/setup/koto-codex.pending.json"); expect(await Bun.file(pendingPath).exists()).toBe(true);
  expect((await f.run("status")).pending).toBe(true);
  // Only after the writer is confirmed stopped may its abandoned lock be removed.
  await rm(join(f.project, ".space/setup/koto.lock"));
  await rm(join(f.project, ".space/setup/agent-gear.lock"));
  const first = join(folder, "extra-0.md"), original = await readFile(first); await writeFile(first, "local edit after interruption");
  await expect(f.run("apply")).rejects.toThrow("conflict"); expect(await readFile(first, "utf8")).toBe("local edit after interruption");
  await writeFile(first, original); await f.run("apply");
  expect(await Bun.file(pendingPath).exists()).toBe(false); expect((await f.run("status")).conflicts).toEqual([]);
  expect(await readFile(join(folder, "extra-39.md"), "utf8")).toBe("content-39\n".repeat(1000));
  expect(await readFile(join(folder, "index.md"), "utf8")).toContain("Changed description");
  expect(await readFile(join(f.project, ".space/setup/agent-gear-codex.json"))).toEqual(legacyState);
  expect(JSON.parse(await readFile(join(f.project, ".space/setup/koto-codex.json"), "utf8")).plugin).toBe("koto");
}, 10000);

async function renamePlugin(f: Awaited<ReturnType<typeof fixture>>) {
  f.manifest.plugin = "koto"; f.manifest.version = "2.0.0";
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
}

for (const product of Object.keys(instructionFiles) as Product[]) test(`${product} adopts the old setup state and replaces its block once`, async () => {
  const f = await fixture("agent-gear", product); await addSharedFiles(f);
  const instruction = join(f.project, instructionFiles[product]);
  await mkdir(join(instruction, ".."), { recursive: true }); await writeFile(instruction, "Keep my instructions.\n");
  await f.run("apply");
  const before = await readFile(instruction), oldState = await readFile(join(f.project, `.space/setup/agent-gear-${product}.json`));
  await renamePlugin(f);
  await writeFile(join(f.pluginRoot, "templates/instructions.md"), "Use koto from {{SKILL_ROOT}}.\n");
  await writeFile(join(f.pluginRoot, "templates/rule.md"), "version two\n");
  await writeFile(join(f.pluginRoot, "space/babel/rules/index.md"), "# rules\n* [Updated](rule.md) - New description\n");
  const plan = await f.run("plan"); expect(plan.conflicts).toEqual([]); expect(plan.plugin).toBe("koto");
  expect(await readFile(instruction)).toEqual(before);
  expect(await Bun.file(join(f.project, `.space/setup/koto-${product}.json`)).exists()).toBe(false);
  await f.run("apply");
  const after = await readFile(instruction, "utf8");
  expect(after).toStartWith("Keep my instructions.\n"); expect(after).not.toContain("agent-gear");
  expect(after.match(new RegExp(`koto:setup:koto:${product}:start`, "g"))).toHaveLength(1);
  expect(await readFile(f.copy, "utf8")).toBe("version two\n");
  expect(await readFile(join(f.project, ".space/babel/rules/index.md"), "utf8")).toContain("New description");
  expect(await readFile(join(f.project, `.space/setup/agent-gear-${product}.json`))).toEqual(oldState);
  const state = JSON.parse(await readFile(join(f.project, `.space/setup/koto-${product}.json`), "utf8"));
  expect(state).toMatchObject({ plugin: "koto", product, version: "2.0.0" });
  await f.run("apply"); expect(await readFile(instruction, "utf8")).toBe(after);
  expect((await f.run("status")).actions.every(a => a.action === "unchanged")).toBe(true);
});

for (const target of ["instructions", "knowledge"]) test(`rename preserves local edits to old ${target}`, async () => {
  const f = await fixture("agent-gear"); await f.run("apply"); await renamePlugin(f);
  const path = target === "instructions" ? join(f.project, "AGENTS.md") : f.copy;
  const edited = (await readFile(path, "utf8")).replace(target === "instructions" ? "Use " : "version one", "My local edit ");
  await writeFile(path, edited);
  expect((await f.run("plan")).conflicts).toHaveLength(1);
  await expect(f.run("apply")).rejects.toThrow("conflict");
  expect(await readFile(path, "utf8")).toBe(edited);
  expect(await Bun.file(join(f.project, ".space/setup/koto-codex.json")).exists()).toBe(false);
});

test("rename rejects orphaned, duplicate, and incomplete old instruction blocks", async () => {
  const f = await fixture("agent-gear"); await f.run("apply"); await renamePlugin(f);
  const path = join(f.project, "AGENTS.md"), old = await readFile(path, "utf8");
  const statePath = join(f.project, ".space/setup/agent-gear-codex.json"), state = await readFile(statePath);
  await rm(statePath); await expect(f.run("apply")).rejects.toThrow("conflict");
  expect(await readFile(path, "utf8")).toBe(old); await writeFile(statePath, state);
  for (const content of [old + old.replaceAll("agent-gear", "koto"), old.replace("agent-gear:codex:end", "agent-gear:codex:broken")]) {
    await writeFile(path, content); await expect(f.run("apply")).rejects.toThrow("conflict");
    expect(await readFile(path, "utf8")).toBe(content);
  }
});

test("rename respects the old writer lock and unfinished transactions from all products", async () => {
  const f = await fixture("agent-gear"); await f.run("apply"); await renamePlugin(f);
  const instruction = await readFile(join(f.project, "AGENTS.md"));
  const lock = join(f.project, ".space/setup/agent-gear.lock"); await writeFile(lock, "old writer");
  expect((await f.run("status")).locked).toBe(true); await expect(f.run("apply")).rejects.toThrow("locked");
  expect(await readFile(lock, "utf8")).toBe("old writer");
  expect(await Bun.file(join(f.project, ".space/setup/koto.lock")).exists()).toBe(false);
  await rm(lock);
  for (const product of Object.keys(instructionFiles)) {
    const pending = join(f.project, `.space/setup/agent-gear-${product}.pending.json`); await writeFile(pending, "unfinished");
    const plan = await f.run("plan"); expect(plan.pending).toBe(true); expect(plan.conflicts[0]!.destination).toEndWith(`agent-gear-${product}.pending.json`);
    await expect(f.run("apply")).rejects.toThrow("conflict");
    expect(await readFile(join(f.project, "AGENTS.md"))).toEqual(instruction); await rm(pending);
  }
  expect(await Bun.file(join(f.project, ".space/setup/koto-codex.json")).exists()).toBe(false);
});

test("rename retains old vendor files and their baselines while adopting the Babel layout", async () => {
  const f = await fixture("agent-gear"), entry = f.manifest.files[0]!;
  const direct = entry.destination; entry.destination = direct.replace(".space/babel/", ".space/babel/vendor/agent-gear/");
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest)); await f.run("apply");
  const vendor = join(f.project, entry.destination); entry.destination = direct; await renamePlugin(f);
  await writeFile(vendor, "local vendor edit\n"); await expect(f.run("apply")).rejects.toThrow("conflict");
  expect(await Bun.file(f.copy).exists()).toBe(false);
  await writeFile(vendor, "version one\n"); await writeFile(join(f.pluginRoot, "templates/rule.md"), "version two\n");
  await f.run("apply"); await f.run("apply");
  expect(await readFile(vendor, "utf8")).toBe("version one\n"); expect(await readFile(f.copy, "utf8")).toBe("version two\n");
  const status = await f.run("status"); expect(status.conflicts).toEqual([]);
  expect(status.actions).toContainEqual(expect.objectContaining({ destination: direct.replace(".space/babel/", ".space/babel/vendor/agent-gear/"), action: "retain" }));
});
