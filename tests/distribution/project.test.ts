import { afterEach, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { distribution } from "../../scripts/build.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function run(cli: string, args: string[], cwd: string) {
  const child = Bun.spawn([process.execPath, "--no-install", cli, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, err, output: code === 0 ? "" : out }).toEqual({ code: 0, err: "", output: "" });
  return JSON.parse(out);
}

test("both products install real project files, survive relocation, and update through a copied setup CLI", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "koto-project-install-"))); roots.push(root);
  let project = join(root, "consumer"); await mkdir(project);
  const packageText = '{"name":"consumer","private":true,"workspaces":["packages/*"]}\n';
  await writeFile(join(project, "package.json"), packageText);
  const all = await distribution(resolve(import.meta.dir, "../.."));
  for (const product of ["codex", "claude-code"] as const) {
    let source = join(root, product); const prefix = `dist/${product}/koto/`;
    const skillRoot = product === "codex" ? ".agents/skills" : ".claude/skills";
    const instruction = product === "codex" ? "AGENTS.md" : "CLAUDE.md";
    await writeFile(join(project, instruction), "# Local instructions\n");
    for (const [path, body] of all) {
      if (!path.startsWith(prefix)) continue;
      const target = join(source, path.slice(prefix.length)); await mkdir(dirname(target), { recursive: true }); await writeFile(target, body);
    }
    const setup = join(source, "skills/setup/scripts/setup.ts");
    const args = ["--project", project, "--scope", "project", "--product", product, "--json"];
    await run(setup, ["plan", ...args], project);
    expect(await Bun.file(join(project, skillRoot, "devlow/SKILL.md")).exists()).toBe(false);
    await run(setup, ["apply", ...args], project);
    for (const [path, body] of all) {
      if (!path.startsWith(`${prefix}skills/`)) continue;
      const target = join(project, skillRoot, path.slice(`${prefix}skills/`.length));
      expect((await lstat(target)).isFile()).toBe(true);
      expect((await readFile(target)).equals(body)).toBe(true);
    }
    for (const name of ["devlow-worker", "comment-curator"]) {
      const from = product === "codex" ? `templates/agents/${name}.toml` : `agents/${name}.md`;
      const to = product === "codex" ? `.codex/agents/${name}.toml` : `.claude/agents/${name}.md`;
      expect(await readFile(join(project, to))).toEqual(await readFile(join(source, from)));
    }
    const instructions = await readFile(join(project, instruction), "utf8");
    expect(instructions).toStartWith("# Local instructions\n"); expect(instructions).toContain(skillRoot);
    expect(instructions).not.toContain(root);
    const moved = join(root, `moved-${product}`); await rename(project, moved); project = moved;
    const movedSource = `${source}-moved`; await rename(source, movedSource); source = movedSource;
    const okf = join(project, skillRoot, "okf-agent-memory/scripts/okf.ts");
    const search = await run(okf, ["search", "--type", "principle", "--all", "--json"], project);
    expect(search.length).toBeGreaterThan(0);
    await run(join(project, skillRoot, "orch/scripts/task.ts"), ["init", "--store", join(project, ".space/tasks", product, ".orch"), "--project", project, "--actor", "parent", "--session", product, "--operation-id", product, "--json"], project);
    const localSetup = join(project, skillRoot, "setup/scripts/setup.ts");
    const localArgs = ["--project", project, "--scope", "project", "--source", source, "--json"];
    const status = await run(localSetup, ["status", ...localArgs], project);
    expect(status.data.scope).toBe("project");
    expect(status.data.actions.every((action: { action: string }) => action.action === "unchanged")).toBe(true);
    const skill = "bro/SKILL.md";
    await writeFile(join(source, "skills", skill), "---\nname: bro\ndescription: Updated skill\n---\nUpdated content.\n");
    await run(localSetup, ["apply", ...localArgs], project);
    expect(await readFile(join(project, skillRoot, skill), "utf8")).toContain("Updated content.");
    expect(await readFile(join(project, instruction), "utf8")).toBe(instructions);
    await expect(lstat(join(project, "node_modules"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await Bun.file(join(project, "bun.lock")).exists()).toBe(false);
    expect(await readFile(join(project, "package.json"), "utf8")).toBe(packageText);
  }
}, 30_000);
