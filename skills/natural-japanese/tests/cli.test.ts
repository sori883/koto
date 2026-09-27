import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const temporary: string[] = [];
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });
const source = resolve(import.meta.dir, "../scripts");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "gear-japanese-")); temporary.push(root);
  const scripts = join(root, "plugin/skills/natural-japanese/scripts"), project = join(root, "consumer"), bin = join(root, "bin");
  await cp(source, scripts, { recursive: true, filter: path => !path.includes("node_modules") });
  await mkdir(project); await mkdir(bin); await symlink(process.execPath, join(bin, "bun"));
  await writeFile(join(project, "package.json"), '{"name":"consumer","private":true}\n');
  await writeFile(join(project, "draft.md"), "# APIの利用\nAPIとは接続の窓口です。\nいかがでしょうか。会社の部門の予算の上限を確認する。\n" + "確認する条件と理由を説明します。".repeat(12));
  return { root, scripts, project, bin };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function run(f: Fixture, args: string[]) {
  const child = Bun.spawn([process.execPath, "--no-install", join(f.scripts, "japanese.ts"), ...args], { cwd: f.project, env: { ...process.env, PATH: f.bin }, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, out, err };
}

test("Bun-only cold install, repeat launch and changed lock keep runtime and input isolated", async () => {
  const f = await fixture(), before = await readFile(join(f.project, "draft.md"));
  const first = await run(f, ["lint", "draft.md", "--json", "--reading-load"]);
  expect(first.code).toBe(0); expect(first.err).toBe("");
  const data = JSON.parse(first.out);
  expect(data.findings.some((x: { category: string }) => x.category === "forbidden_phrase")).toBe(true);
  expect(data.reading_load.findings.some((x: { category: string }) => x.category === "no_chain")).toBe(true);
  const marker = join(f.scripts, "node_modules/.natural-japanese-bootstrap.json");
  const previousMarker = await readFile(marker, "utf8"), mtime = (await stat(marker)).mtimeMs;
  const again = await run(f, ["lint", "draft.md", "--json", "--reading-load"]);
  expect(again).toEqual(first); expect((await stat(marker)).mtimeMs).toBe(mtime);
  const lock = join(f.scripts, "bun.lock"); await writeFile(lock, (await readFile(lock, "utf8")) + "\n");
  expect((await run(f, ["score", "draft.md", "--json"])).code).toBe(0);
  expect(await readFile(marker, "utf8")).not.toBe(previousMarker);
  expect(await readFile(join(f.project, "draft.md"))).toEqual(before);
  expect((await readdir(f.project)).sort()).toEqual(["draft.md", "package.json"]);
  expect(await readFile(join(f.project, "package.json"), "utf8")).toBe('{"name":"consumer","private":true}\n');
  expect(await Bun.file(join(f.scripts, "node_modules/kuromoji/dict/base.dat.gz")).exists()).toBe(true);
}, 20000);

test("CLI handles extraction, score, baseline and invalid input without editing the draft", async () => {
  const f = await fixture();
  for (const command of ["outline", "terms", "score"]) {
    const result = await run(f, [command, "draft.md", "--json"]); expect(result.code).toBe(0);
    const data = JSON.parse(result.out);
    if (command === "outline") expect(data.outline[0]).toMatchObject({ line: 1, kind: "heading" });
    if (command === "terms") expect(data.terms[0]).toMatchObject({ term: "API", first_line: 1 });
    if (command === "score") expect(data.score.base).toBeNumber();
  }
  const previous = await run(f, ["lint", "draft.md", "--json"]);
  await writeFile(join(f.project, "previous.json"), previous.out);
  const same = await run(f, ["lint", "draft.md", "--baseline", "previous.json", "--json"]);
  expect(JSON.parse(same.out).baseline.summary).toMatchObject({ new: 0, resolved: 0 });
  await writeFile(join(f.project, "bad-baseline.json"), '{"findings":[null,{"category":2}]}');
  const invalidItems = await run(f, ["lint", "draft.md", "--baseline", "bad-baseline.json", "--json"]);
  expect(invalidItems.code).toBe(0); expect(invalidItems.err).toContain("読み飛ばし");
  await writeFile(join(f.project, "bad-baseline.json"), "{}");
  const invalidShape = await run(f, ["lint", "draft.md", "--baseline", "bad-baseline.json", "--json"]);
  expect(invalidShape.code).toBe(0); expect(invalidShape.err).toContain("比較を省略");
  expect(JSON.parse(invalidShape.out).baseline).toBeUndefined();
  await writeFile(join(f.project, "invalid.txt"), new Uint8Array([0xff, 0xfe]));
  await writeFile(join(f.project, "broken.json"), "{");
  for (const args of [
    ["lint", "missing.md"], ["lint", "."], ["lint", "invalid.txt"], ["lint", "draft.md", "--genre", "unknown"],
    ["lint", "draft.md", "--baseline", "broken.json"], ["terms", "draft.md", "--reading-load"],
    ["score", "draft.md", "--experimental"], ["semantic", "draft.md"], ["lint", "draft.md", "--typo"],
  ]) { const result = await run(f, [...args, "--json"]); expect(result.code).toBe(1); expect(result.out).toBe(""); expect(result.err.length).toBeGreaterThan(0); }
}, 20000);

test("failed fixed install never starts the analyzer or marks the runtime ready", async () => {
  const f = await fixture();
  const manifest = join(f.scripts, "package.json");
  const pkg = JSON.parse(await readFile(manifest, "utf8")); pkg.dependencies.kuromoji = "0.1.1";
  await writeFile(manifest, JSON.stringify(pkg));
  const result = await run(f, ["lint", "draft.md", "--json"]);
  expect(result.code).toBe(1); expect(result.out).toBe(""); expect(result.err).toContain("installation failed");
  expect(await Bun.file(join(f.scripts, "node_modules/.natural-japanese-bootstrap.json")).exists()).toBe(false);
}, 20000);

test("ancestor workspace is rejected before changing its dependencies", async () => {
  const f = await fixture(), path = join(f.root, "package.json");
  const manifest = '{"name":"host","workspaces":["plugin/skills/*/scripts"]}\n'; await writeFile(path, manifest);
  const result = await run(f, ["lint", "draft.md", "--json"]);
  expect(result.code).toBe(1); expect(result.err).toContain("ancestor workspace");
  expect(await readFile(path, "utf8")).toBe(manifest);
  expect(await Bun.file(join(f.root, "bun.lock")).exists()).toBe(false);
  expect((await readdir(f.scripts)).includes("node_modules")).toBe(false);
});
