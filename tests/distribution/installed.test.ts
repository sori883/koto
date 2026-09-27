import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { distribution } from "../../scripts/build.ts";

const temporary: string[] = [];
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });
async function run(cli: string, args: string[], cwd: string) {
  const child = Bun.spawn([process.execPath, "--no-install", cli, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, out, err };
}

for (const product of ["codex", "claude-code", "copilot"]) test(`${product} installs outside the repository, preserves user content, and runs all four CLIs`, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "gear-install-"))); temporary.push(root);
  const plugin = join(root, "plugin"), project = join(root, "consumer"); await mkdir(project);
  const prefix = `dist/${product === "copilot" ? "claude-code" : product}/agent-gear/`;
  for (const [path, body] of await distribution(resolve(import.meta.dir, "../.."))) {
    if (!path.startsWith(prefix)) continue;
    const target = join(plugin, path.slice(prefix.length)); await mkdir(dirname(target), { recursive: true }); await writeFile(target, body);
  }
  const instruction = product === "codex" ? "AGENTS.md" : product === "copilot" ? ".github/copilot-instructions.md" : "CLAUDE.md";
  await mkdir(dirname(join(project, instruction)), { recursive: true });
  await writeFile(join(project, instruction), "# Existing project\n\nKeep these user instructions.\n");
  await writeFile(join(project, "package.json"), '{"name":"consumer","private":true}\n');
  const okf = join(plugin, "skills/okf-agent-memory/scripts/okf.ts"), bundle = join(project, ".space/babel");
  expect((await run(okf, ["init", "--json"], project)).code).toBe(0);
  expect((await run(okf, ["create", "knowledge/existing", "--type", "knowledge", "--title", "Existing", "--desc", "Existing project knowledge", "--json"], project)).code).toBe(0);
  const existingKnowledge = await readFile(join(bundle, "knowledge/existing.md"));
  const existingHistory = await readFile(join(bundle, "log.md"));
  const setup = join(plugin, "skills/setup/scripts/setup.ts");
  const setupArgs = ["--project", project, "--json", ...(product === "copilot" ? ["--product", "copilot"] : [])];
  const plan = await run(setup, ["plan", ...setupArgs], project);
  expect(plan.code).toBe(0); expect(await Bun.file(join(bundle, "principles/minimize-reader-load.md")).exists()).toBe(false);
  const apply = await run(setup, ["apply", ...setupArgs], project); expect(apply.code).toBe(0);
  expect(JSON.parse(apply.out).data.product).toBe(product);
  if (product === "copilot") {
    expect(await Bun.file(join(project, "CLAUDE.md")).exists()).toBe(false);
    expect(await Bun.file(join(project, "AGENTS.md")).exists()).toBe(false);
    expect(await Bun.file(join(project, ".space/setup/agent-gear-copilot.json")).exists()).toBe(true);
  }
  const instructions = await readFile(join(project, instruction), "utf8");
  expect(instructions).toContain("Keep these user instructions."); expect(instructions).toContain(join(plugin, "skills")); expect(instructions).not.toContain("{{");
  expect(instructions).toContain(bundle); expect(instructions).not.toContain("vendor");
  const installedAgents = new Map<string, string>();
  for (const name of ["devlow-worker", "comment-curator"]) {
    const path = product === "codex" ? join(project, ".codex/agents", `${name}.toml`) : join(plugin, "agents", `${name}.md`);
    const content = await readFile(path, "utf8"); installedAgents.set(path, content);
    if (product === "codex") {
      const definition = Bun.TOML.parse(content) as Record<string, unknown>;
      expect(definition.name).toBe(name);
      expect(typeof definition.developer_instructions).toBe("string");
      expect(content).toBe(await readFile(join(plugin, "templates/agents", `${name}.toml`), "utf8"));
    } else {
      const frontmatter = /^---\n([\s\S]+?)\n---\n/.exec(content);
      expect(frontmatter).not.toBeNull();
      const definition = Bun.YAML.parse(frontmatter![1]!) as Record<string, unknown>;
      expect(definition.name).toBe(name); expect(typeof definition.description).toBe("string");
      expect(await Bun.file(join(project, ".codex/agents", `${name}.toml`)).exists()).toBe(false);
    }
  }
  expect(await readFile(join(bundle, "knowledge/existing.md"))).toEqual(existingKnowledge);
  expect(await readFile(join(bundle, "log.md"))).toEqual(existingHistory);
  expect(await readFile(join(bundle, "knowledge/index.md"), "utf8")).toContain("existing.md");
  expect((await run(setup, ["apply", ...setupArgs], project)).code).toBe(0);
  expect(await readFile(join(project, instruction), "utf8")).toBe(instructions);
  for (const [path, content] of installedAgents) expect(await readFile(path, "utf8")).toBe(content);
  const principles = await run(okf, ["search", "--type", "principle", "--all", "--json"], project);
  expect(principles.code).toBe(0); expect(JSON.parse(principles.out)).toHaveLength(23);
  const validation = await run(okf, ["validate", bundle, "--drift", "--json"], project);
  expect(validation.code).toBe(0);
  expect(JSON.parse(validation.out)).toMatchObject({ concept_count: 24, errors: [], warnings: [], broken_links: [], is_conformant: true });
  // The curated principles have no concept-to-concept links; strict mode reports that existing limitation.
  const strict = await run(okf, ["validate", bundle, "--strict", "--drift", "--json"], project);
  expect(strict.code).toBe(1); expect(JSON.parse(strict.out).orphans).toHaveLength(24);
  const personal = join(project, ".space/babel");
  expect((await run(okf, ["init", personal, "--json"], project)).code).toBe(0);
  expect((await run(okf, ["create", "knowledge/consumer", personal, "--type", "knowledge", "--title", "Consumer", "--desc", "Project-specific knowledge", "--json"], project)).code).toBe(0);
  expect(await Bun.file(join(bundle, "knowledge/consumer.md")).exists()).toBe(true);
  expect(await Bun.file(join(project, ".space/babel/vendor/agent-gear/index.md")).exists()).toBe(false);
  const ownPrinciples = await run(okf, ["search", "--type", "principle", "--all", personal, "--json"], project);
  expect(JSON.parse(ownPrinciples.out)).toHaveLength(23);
  const log = await readFile(join(bundle, "log.md"), "utf8");
  expect((await run(setup, ["apply", ...setupArgs], project)).code).toBe(0);
  expect(await readFile(join(bundle, "log.md"), "utf8")).toBe(log);
  expect(await readFile(join(bundle, "knowledge/index.md"), "utf8")).toContain("consumer.md");
  const source = join(project, "src/retry.ts");
  await mkdir(dirname(source), { recursive: true });
  await writeFile(source, "// Retry once because the peer may close an idle connection.\nexport const retries = 1;\n");
  const metadata = join(project, "rationale.json"), bodyFile = join(project, "rationale.md");
  const rationale = "# Retry constraint\nThe peer can close an idle connection. Retry once.\nSource: src/retry.ts, retries, before comment removal.\n";
  await writeFile(metadata, JSON.stringify({ type: "knowledge", title: "Retry constraint", description: "Why retries is one.", code_refs: ["src/retry.ts"], sources: [{ resource: "src/retry.ts" }] }));
  await writeFile(bodyFile, rationale);
  const save = await run(okf, ["create", "knowledge/retry", "--metadata-file", metadata, "--body-file", bodyFile, "--json"], project);
  expect(save.code).toBe(0);
  const saved = await run(okf, ["show", "knowledge/retry", "--json"], project);
  expect(saved.code).toBe(0); expect(JSON.parse(saved.out).body).toBe(rationale);
  expect((await run(okf, ["validate", bundle, "--drift", "--json"], project)).code).toBe(0);
  await writeFile(source, "export const retries = 1;\n");
  const byPath = await run(okf, ["search", "--for-path", "src/retry.ts", "--all", "--json"], project);
  expect(byPath.code).toBe(0);
  expect(JSON.parse(byPath.out)).toContainEqual(expect.objectContaining({ concept_id: "knowledge/retry", matched_on: expect.arrayContaining(["code_refs"]) }));
  expect((await run(okf, ["validate", bundle, "--drift", "--json"], project)).code).toBe(0);
  const orch = join(plugin, "skills/orch/scripts/task.ts"), store = join(project, ".space/tasks/.orch");
  expect((await run(orch, ["init", "--store", store, "--project", project, "--actor", "parent", "--session", "one", "--operation-id", "init", "--json"], project)).code).toBe(0);
  const status = await run(orch, ["status", "--store", store, "--json"], project); expect(status.code).toBe(0); expect(JSON.parse(status.out).data.units).toEqual([]);
  const japanese = join(plugin, "skills/natural-japanese/scripts/japanese.ts");
  const draft = "いかがでしょうか。文章を確認することができます。\n";
  await writeFile(join(project, "draft.md"), draft);
  const japaneseResult = await run(japanese, ["lint", "draft.md", "--json"], project);
  expect(japaneseResult.code).toBe(0);
  expect(JSON.parse(japaneseResult.out).findings).toContainEqual(expect.objectContaining({ category: "forbidden_phrase" }));
  expect(await readFile(join(project, "draft.md"), "utf8")).toBe(draft);
  expect(await Bun.file(join(plugin, "skills/natural-japanese/scripts/node_modules/kuromoji/dict/base.dat.gz")).exists()).toBe(true);
  expect(await readFile(join(project, "package.json"), "utf8")).toBe('{"name":"consumer","private":true}\n');
  expect(await Bun.file(join(project, "bun.lock")).exists()).toBe(false);
  if (product === "codex") {
    const agent = join(project, ".codex/agents/devlow-worker.toml");
    const original = installedAgents.get(agent)!;
    await writeFile(agent, original + '\nmodel = "local-choice"\n');
    expect((await run(setup, ["apply", ...setupArgs], project)).code).not.toBe(0);
    expect(await readFile(agent, "utf8")).toBe(original + '\nmodel = "local-choice"\n');
    await writeFile(agent, original);
  }
  const edited = join(bundle, "principles/minimize-reader-load.md"); const modified = (await readFile(edited, "utf8")) + "\nLocal addition.\n"; await writeFile(edited, modified);
  expect((await run(setup, ["apply", ...setupArgs], project)).code).not.toBe(0);
  expect(await readFile(edited, "utf8")).toBe(modified);
  expect(await readFile(join(project, instruction), "utf8")).toBe(instructions);
}, 20000);
