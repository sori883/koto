import { afterEach, beforeEach, expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
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
