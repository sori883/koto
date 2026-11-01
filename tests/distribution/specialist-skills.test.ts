import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "../../scripts/build.ts";

const source = resolve(import.meta.dir, "../..");
const products = ["codex", "claude-code"] as const;
let root: string;
let provenance: { skills: Record<string, Record<string, string>> };

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "koto-specialist-skills-"));
  provenance = JSON.parse(await readFile(join(source, "docs/specialist-restoration-source.json"), "utf8"));
  for (const path of ["package.json", "packaging", "space/default", "skills", "cli", "templates"]) {
    await cp(join(source, path), join(root, path), { recursive: true });
  }
  await build(root);
  for (const path of ["skills", "cli", "templates"]) await rm(join(root, path), { recursive: true });
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

async function run(args: string[], expected = 0) {
  const child = Bun.spawn(args, { cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, out + err).toBe(expected);
  return out;
}

test("restored skills retain notices in both products without bringing back replaced tools", async () => {
  for (const product of products) {
    const dist = join(root, "dist", product, "koto");
    expect((await readdir(join(dist, "skills"))).length).toBe(25);
    for (const [name, files] of Object.entries(provenance.skills)) {
      expect(await Bun.file(join(dist, "skills", name, "SKILL.md")).exists()).toBe(true);
      for (const [path, hash] of Object.entries(files)) {
        if (!path.endsWith("/LICENSE") && !path.endsWith("/UNICODE-LICENSE.txt")) continue;
        expect(createHash("sha256").update(await readFile(join(dist, path))).digest("hex")).toBe(hash);
      }
    }
    const attributed = await readFile(join(dist, "skills/explain-before-shorten/SKILL.md"), "utf8");
    expect(attributed).toContain("Kazuki Ota");
    expect(attributed).toContain("https://zenn.dev/microsoft/articles/explain-before-shorten");
    for (const name of ["setup", "orch", "okf-agent-memory", "use-principles", "checkpoint-safely"]) {
      expect(await Bun.file(join(dist, "skills", name, "SKILL.md")).exists()).toBe(false);
    }
    for (const path of ["skills/natural-japanese/scripts/calibrate.py", "skills/natural-japanese/scripts/fixtures/ai-smelly.md", "docs/specialist-skills-restoration.md"]) {
      expect(await Bun.file(join(dist, path)).exists()).toBe(false);
    }
  }
});

for (const product of products) {
  test(`${product}: writing tools run outside the checkout and preserve the input document`, async () => {
    const dist = join(root, "dist", product, "koto/skills");
    const input = join(root, `${product}.md`);
    const text = "# 説明\n\nこの機能を活用することができます。重要なのは、シームレスな連携を実現することです。\n";
    await writeFile(input, text);
    const natural = join(dist, "natural-japanese/scripts");
    const lint = JSON.parse(await run(["uv", "run", join(natural, "lint.py"), input, "--json"]));
    expect(lint.findings.some((item: { category: string }) => item.category === "translationese")).toBe(true);
    const outline = JSON.parse(await run(["uv", "run", join(natural, "outline.py"), input, "--json"]));
    expect(outline.outline[0]).toMatchObject({ kind: "heading", text: "説明" });
    const terms = JSON.parse(await run(["uv", "run", join(natural, "terms.py"), input, "--json"]));
    expect(terms.terms.some((item: { term: string }) => item.term === "シームレス")).toBe(true);
    await run(["uv", "run", join(natural, "lint.py"), join(root, "absent.md"), "--json"], 1);

    const yomiyasu = join(dist, "yomiyasu/scripts");
    const findings = JSON.parse(await run(["python3", join(yomiyasu, "yomiyasu_lint.py"), input, "--json"]));
    expect(findings.is_clean).toBe(false);
    expect(findings.findings.some((item: { rule: string }) => item.rule === "meta_filler")).toBe(true);
    const diff = JSON.parse(await run(["python3", join(yomiyasu, "yomiyasu_diff.py"), input, input, "--json"]));
    expect(diff.new_words).toEqual([]);
    expect(diff.lost_words).toEqual([]);
    expect(diff.endings.changes).toEqual([]);
    await run(["python3", join(yomiyasu, "yomiyasu_lint.py"), join(root, "absent.md"), "--json"], 2);
    expect(await readFile(input, "utf8")).toBe(text);
  }, 120000);
}
