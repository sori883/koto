import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { distribution } from "../../scripts/build.ts";
import type { Manifest, State } from "../../skills/setup/scripts/lib/model.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const hash = (body: string) => createHash("sha256").update(body).digest("hex");
async function put(root: string, path: string, body: string | Buffer) {
  const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, body);
}
async function run(cli: string, args: string[], cwd: string) {
  const child = Bun.spawn([process.execPath, "--no-install", cli, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, err, failure: code ? out : "" }).toEqual({ code: 0, err: "", failure: "" });
  return JSON.parse(out).data;
}
const concept = (type: string, title: string, body: string) => `---\ntype: ${type}\nscope: dev\ntitle: ${title}\ndescription: ${title}\n---\n# ${title}\n\n${body}\n`;

for (const product of ["codex", "claude-code", "copilot"] as const) test(`${product} updates from Memory-owned principles and supports selective cleanup without losing local knowledge`, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "koto-principles-update-"))); roots.push(root);
  const plugin = join(root, "plugin"), project = join(root, "consumer"); await mkdir(project);
  const prefix = `dist/${product === "copilot" ? "claude-code" : product}/koto/`;
  const files = new Map([...await distribution(resolve(import.meta.dir, "../.."))]
    .filter(([path]) => path.startsWith(prefix)).map(([path, body]) => [path.slice(prefix.length), body]));
  for (const [path, body] of files) await put(plugin, path, body);
  const skillRoot = product === "codex" ? ".agents/skills" : ".claude/skills";
  const manifestPath = product === "copilot" ? "setup-manifest.copilot.json" : "setup-manifest.project.json";
  const manifest: Manifest = JSON.parse(files.get(manifestPath)!.toString());
  const previous: Manifest = structuredClone(manifest);
  previous.files = previous.files.filter(entry => !entry.source.startsWith("skills/devlaw/references/principles/") && entry.source !== "skills/memory/references/record-design-decisions.md");
  const legacy = new Map([
    ["principles/minimize-reader-load.md", concept("principle", "Old standard", "Keep code readable.")],
    ["principles/test-behavior-not-implementation.md", concept("principle", "Local adaptation", "Test observable results.")],
    ["procedures/record-design-decisions.md", concept("procedure", "Referenced guide", "Record the rationale.")],
  ]);
  for (const [path, body] of legacy) {
    await put(plugin, `space/default/${path}`, body);
    previous.files.push({ source: `space/default/${path}`, destination: `.space/default/memory/${path}`, mode: "copy" });
  }
  await put(plugin, "space/default/principles/index.md", "# principles\n* [Old standard](minimize-reader-load.md)\n* [Local adaptation](test-behavior-not-implementation.md)\n");
  await put(plugin, "space/default/procedures/index.md", "# procedures\n* [Referenced guide](record-design-decisions.md)\n");
  const oldSkill = "---\nname: use-principles\ndescription: Read principles\n---\nRead Memory.\n";
  if (product !== "copilot") {
    await put(plugin, "skills/use-principles/SKILL.md", oldSkill);
    previous.files.push({ source: "skills/use-principles/SKILL.md", destination: `${skillRoot}/use-principles/SKILL.md`, mode: "copy" });
  }
  await put(plugin, manifestPath, JSON.stringify(previous));
  const setup = join(plugin, "skills/setup/scripts/setup.ts"), memory = join(plugin, "cli/memory/memory.ts");
  const args = ["--project", project, "--product", product, "--json", ...(product === "copilot" ? [] : ["--scope", "project"])];
  await run(setup, ["apply", ...args], project);
  const bundle = ".space/default/memory", editedPath = `${bundle}/principles/test-behavior-not-implementation.md`;
  const modified = legacy.get("principles/test-behavior-not-implementation.md")! + "\nOur project requires a real database.\n";
  await put(project, editedPath, modified);
  await run(memory, ["create", "knowledge/project-policy", "--root", project, "--type", "knowledge", "--scope", "dev", "--title", "Project policy", "--desc", "Local requirements", "--body", "# Policy\nUse the recorded decision criteria.\n\n# Related\n- [Guide](../procedures/record-design-decisions.md): Required local context.\n", "--json"], project);
  const ownPath = `${bundle}/knowledge/project-policy.md`, ownContent = await readFile(join(project, ownPath), "utf8");
  if (product !== "copilot") await put(project, `${skillRoot}/use-principles/local-notes.md`, "Personal notes\n");

  // Replace the source with the new distribution before updating the consumer.
  for (const [path, body] of files) await put(plugin, path, body);
  for (const path of legacy.keys()) await rm(join(plugin, `space/default/${path}`));
  await rm(join(plugin, "skills/use-principles"), { recursive: true, force: true });
  const plan = await run(setup, ["plan", ...args], project);
  expect(plan.conflicts).toEqual([]);
  for (const path of legacy.keys()) expect(plan.actions).toContainEqual(expect.objectContaining({ destination: `${bundle}/${path}`, action: "retain" }));
  await run(setup, ["apply", ...args], project);
  expect(await readFile(join(project, editedPath), "utf8")).toBe(modified);
  expect(await readFile(join(project, ownPath), "utf8")).toBe(ownContent);
  const state: State = JSON.parse(await readFile(join(project, `.space/setup/koto-${product}.json`), "utf8"));
  const baseline = (path: string) => state.entries.find(entry => entry.destination === path)!.hash;
  expect(hash(modified)).not.toBe(baseline(editedPath));
  const obsolete = `${bundle}/principles/minimize-reader-load.md`;
  expect(hash(await readFile(join(project, obsolete), "utf8"))).toBe(baseline(obsolete));
  const referenced = await run(memory, ["delete", "procedures/record-design-decisions", "--root", project, "--dry-run", "--json"], project);
  expect(referenced.updated_concepts).toContain("knowledge/project-policy");
  expect(await readFile(join(project, ownPath), "utf8")).toBe(ownContent);
  const preview = await run(memory, ["delete", "principles/minimize-reader-load", "--root", project, "--dry-run", "--json"], project);
  expect(preview.updated_concepts).toEqual([]);
  await run(memory, ["delete", "principles/minimize-reader-load", "--root", project, "--if-hash", preview.content_hash, "--json"], project);
  if (product !== "copilot") {
    const oldPath = `${skillRoot}/use-principles/SKILL.md`;
    expect(hash(await readFile(join(project, oldPath), "utf8"))).toBe(baseline(oldPath));
    await rm(join(project, oldPath));
    expect(await readFile(join(project, `${skillRoot}/use-principles/local-notes.md`), "utf8")).toBe("Personal notes\n");
    expect(await Bun.file(join(project, skillRoot, "devlaw/references/principles/minimize-reader-load.md")).exists()).toBe(true);
    expect(await Bun.file(join(project, skillRoot, "memory/references/record-design-decisions.md")).exists()).toBe(true);
  }
  await run(setup, ["apply", ...args], project);
  expect(await Bun.file(join(project, obsolete)).exists()).toBe(false);
  if (product !== "copilot") expect(await Bun.file(join(project, skillRoot, "use-principles/SKILL.md")).exists()).toBe(false);
  expect(await readFile(join(project, ownPath), "utf8")).toBe(ownContent);
  expect(await readFile(join(project, editedPath), "utf8")).toBe(modified);
  expect((await run(memory, ["show", "knowledge/project-policy", "--root", project, "--json"], project)).body).toContain("Required local context");
  expect((await run(memory, ["validate", "--root", project, "--json"], project)).errors).toEqual([]);
}, 30_000);
