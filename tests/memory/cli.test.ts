import manifest from "../../package.json";
function payload(raw: string) { const response = JSON.parse(raw); return response.data ?? response.error; }
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const cliPath = resolve(import.meta.dir, "../../cli/memory/memory.ts");
let root: string;
const markdown = (title: string, body = "認証の本文", extra = "") => `---\ntype: knowledge\ntitle: ${title}\ndescription: ${title}の説明\n${extra}---\n${body}\n`;

async function file(path: string, content: string) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function init(project = "default") {
  await file(`.space/${project}/memory/index.md`, '---\nokf_version: "0.2"\n---\n目次');
}

async function cli(args: string[], cwd = root) {
  const process = Bun.spawn([Bun.argv[0] ?? "bun", cliPath, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  return { stdout, stderr, code };
}

async function snapshot(path: string): Promise<unknown[]> {
  const result: unknown[] = [];
  for (const name of (await readdir(path)).sort()) {
    const full = join(path, name);
    const stat = await lstat(full);
    result.push([full, stat.mtimeMs, stat.size, stat.isDirectory() ? await snapshot(full) : createHash("sha256").update(await readFile(full)).digest("hex")]);
  }
  return result;
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "koto-memory-read-cli-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("read-only koto-memory CLI", () => {
  test("help/version work without a root, including JSON", async () => {
    expect((await cli(["--help"])).stdout).toContain("--root");
    const result = await cli(["--version", "--json"]);
    expect(result.code).toBe(0);
    expect(payload(result.stdout).version).toBe(manifest.version);
  });

  test("default and explicit projects stay separate even from a worktree cwd", async () => {
    await init(); await init("project-x");
    await file(".space/default/memory/knowledge/auth.md", markdown("既定プロジェクト"));
    await file(".space/project-x/memory/knowledge/auth.md", markdown("別プロジェクト"));
    await file(".space/default/tasks/knowledge/auth.md", markdown("タスクの秘密"));
    await file("workspaces/w1/knowledge/auth.md", markdown("作業場の秘密"));
    const result = await cli(["search", "認証", "--root", root, "--json"], join(root, "workspaces/w1"));
    expect(result.code).toBe(0);
    expect(payload(result.stdout).map((d: {title:string}) => d.title)).toEqual(["既定プロジェクト"]);
    const other = await cli(["search", "認証", "--root", root, "--project", "project-x", "--json"]);
    expect(payload(other.stdout).map((d: {title:string}) => d.title)).toEqual(["別プロジェクト"]);
    expect((await cli(["search", "認証", "--root", root, "--project", "default", "--json"])).stdout).toBe(result.stdout);
    expect((await cli(["search", "認証", "--root", root, "--project", "missing", "--json"])).code).toBe(2);
    expect((await cli(["search", "認証", "--root", root, "--project", "project-y", "--json"])).code).toBe(2);
  });

  test("show preserves unknown metadata and raw source without reading unrelated bad documents", async () => {
    await init();
    const raw = markdown("認証", "本文", "id: custom-id\nbody: custom-body\nextra: {flag: true}\n");
    await file(".space/default/memory/knowledge/auth.md", raw);
    await file(".space/default/memory/knowledge/broken.md", "not valid OKF");
    const result = await cli(["show", "knowledge/auth", "--root", root, "--json"]);
    expect(result.code).toBe(0);
    expect(payload(result.stdout)).toMatchObject({ id: "knowledge/auth", metadata: { id: "custom-id", body: "custom-body", extra: { flag: true } }, raw_content: raw, body: "本文\n" });
    expect(payload(result.stdout)).not.toHaveProperty("inbound");
    expect((await cli(["show", "knowledge/auth", "--root", root, "--raw"])).stdout).toBe(raw);
    expect((await cli(["show", "knowledge/auth", "--root", root])).stdout).toContain("ID: knowledge/auth");
  });

  test("search does not emit partial success for broken YAML, missing fields or wrong directory types", async () => {
    await init();
    await file(".space/default/memory/knowledge/auth.md", markdown("認証"));
    for (const content of ["no frontmatter", "---\ntype: knowledge\n---\n", markdown("不正", "本文", "type: rule\n")]) {
      await file(".space/default/memory/knowledge/broken.md", content);
      const result = await cli(["search", "認証", "--root", root, "--json"]);
      expect(result.code).toBe(2);
      expect(result.stderr).toBe("");
      expect(payload(result.stdout)).toHaveProperty("code");
      expect(payload(result.stdout).message).toContain("knowledge/broken.md");
    }
  });

  test("type, limits, prefix search and no matches use the existing search engine", async () => {
    await init();
    for (let i = 0; i < 12; i++) await file(`.space/default/memory/knowledge/d${i}.md`, markdown(`文書${i}`, "authentication 認証"));
    await file(".space/default/memory/rules/safety.md", "---\ntype: rule\ntitle: 規則\ndescription: 規則の説明\ngovernance: hold\n---\n認証");
    for (const [options, count] of [[[], 10], [["--limit", "2"], 2], [["--all"], 13], [["--limit", "1000"], 13], [["--type", "rule"], 1]] as const) {
      const result = await cli(["search", "認証", "--root", root, "--json", ...options]);
      expect(result.code).toBe(0);
      expect(payload(result.stdout)).toHaveLength(count);
    }
    expect(payload((await cli(["search", "auth", "--root", root, "--all", "--json"])).stdout)).toHaveLength(12);
    expect(payload((await cli(["search", "--type", "rule", "--root", root, "--json"])).stdout)[0].governance).toBe("hold");
    expect((await cli(["search", "見つからない", "--root", root])).stdout).toBe("No matches.\n");
  });

  test("only type folders are searched, navigation and hidden files are ignored", async () => {
    await init();
    await file(".space/default/memory/knowledge/nested/auth.md", markdown("認証"));
    for (const path of ["log.md", "knowledge/index.md", "knowledge/log.md", "knowledge/AGENTS.md", "knowledge/.temp.md", "other/secret.md"]) {
      await file(`.space/default/memory/${path}`, "not OKF: 認証");
    }
    const result = await cli(["search", "認証", "--root", root, "--json"]);
    expect(result.code).toBe(0);
    expect(payload(result.stdout).map((d:{concept_id:string}) => d.concept_id)).toEqual(["knowledge/nested/auth"]);
  });

  test("root is required even from the monorepo root", async () => {
    await init();
    const result = await cli(["search", "認証", "--json"]);
    expect(result.code).toBe(1);
    expect(payload(result.stdout).message).toContain("--root is required");
  });

  test.each([
    ["search", "認証", "--root", ""], ["search", "認証", "--project", ""],
    ["search", "認証", "--project", "../other"], ["search", "認証", "--type", "unknown"],
    ["search", "認証", "--limit", "0"], ["search", "認証", "--limit", "NaN"],
    ["search", "認証", "--limit", "1", "--all"], ["search", "認証", "--raw"],
    ["search"], ["search", "one", "two"], ["search", "認証", "--unknown"],
    ["show", "knowledge/auth", "--raw"], ["show", "knowledge/auth", "--type", "knowledge"],
    ["show", "../outside"], ["show", "/knowledge/auth"], ["show", "knowledge/../auth"],
    ["show", "knowledge//auth"], ["show", "knowledge/auth.md"], ["show", "knowledge/index"],
    ["show", "knowledge/LOG"], ["show", "knowledge/.hidden"], ["show", "knowledge\\auth"],
    ["show", "knowledge/auth", "extra"], ["search", "認証", "--project", "a", "--project", "b"],
  ].map(args => ({args})))("invalid CLI input fails with JSON and exit 1: %j", async ({args}) => {
    const rootArgs = args.includes("--root") ? [] : ["--root", root];
    const result = await cli([...args, ...rootArgs, "--json"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(payload(result.stdout).code).toBeDefined();
  });

  test("missing or wrong OKF version does not initialize a directory", async () => {
    const missing = await cli(["search", "認証", "--root", root, "--json"]);
    expect(missing.code).toBe(2);
    expect(await readdir(root)).toEqual([]);
    await file(".space/default/memory/index.md", '---\nokf_version: "0.3"\n---\n');
    expect((await cli(["search", "認証", "--root", root, "--json"])).code).toBe(2);
  });

  test("missing IDs are exit 1 and ordinary failures go to stderr", async () => {
    await init();
    const result = await cli(["show", "knowledge/missing", "--root", root]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Concept not found");
  });

  test.each([".space", ".space/default", ".space/default/memory"])("rejects symlink ancestor %s", async ancestor => {
    await file("outside/index.md", '---\nokf_version: "0.2"\n---\n');
    await file("outside/knowledge/secret.md", markdown("OUTSIDE_SECRET"));
    await mkdir(dirname(join(root, ancestor)), {recursive:true});
    await symlink(join(root, "outside"), join(root, ancestor));
    const result = await cli(["search", "認証", "--root", root, "--json"]);
    expect(result.code).toBe(2);
    expect(result.stdout).not.toContain("OUTSIDE_SECRET");
    expect(payload(result.stdout).message).toContain("Symbolic links");
  });

  test.each(["file", "directory"])("rejects symlink %s inside memory", async kind => {
    await init();
    await file("outside/secret.md", markdown("OUTSIDE_SECRET"));
    await mkdir(join(root, ".space/default/memory/knowledge"));
    const dest = kind === "file" ? ".space/default/memory/knowledge/secret.md" : ".space/default/memory/knowledge/nested";
    await symlink(join(root, kind === "file" ? "outside/secret.md" : "outside"), join(root, dest));
    for (const args of [["search", "認証"], ["show", kind === "file" ? "knowledge/secret" : "knowledge/nested/secret"]]) {
      const result = await cli([...args, "--root", root, "--json"]);
      expect(result.code).toBe(2);
      expect(result.stdout).not.toContain("OUTSIDE_SECRET");
    }
  });

  test("rejects FIFO and oversized files without hanging", async () => {
    await init();
    await mkdir(join(root, ".space/default/memory/knowledge"));
    const fifo = Bun.spawn(["mkfifo", join(root, ".space/default/memory/knowledge/pipe.md")]);
    expect(await fifo.exited).toBe(0);
    expect((await cli(["show", "knowledge/pipe", "--root", root, "--json"])).code).toBe(2);
    expect((await cli(["search", "認証", "--root", root, "--json"])).code).toBe(2);
    await rm(join(root, ".space/default/memory/knowledge/pipe.md"));
    await file(".space/default/memory/knowledge/large.md", "x".repeat(16 * 1024 * 1024 + 1));
    const result = await cli(["show", "knowledge/large", "--root", root, "--json"]);
    expect(payload(result.stdout).message).toContain("16 MiB");
  });

  test("reading does not change files, mtimes, directories or metadata", async () => {
    await init();
    await file(".space/default/memory/knowledge/auth.md", markdown("認証"));
    const before = await snapshot(root);
    expect((await cli(["show", "knowledge/auth", "--root", root, "--json"])).code).toBe(0);
    expect((await cli(["search", "認証", "--root", root, "--json"])).code).toBe(0);
    expect(await snapshot(root)).toEqual(before);
  });
});
