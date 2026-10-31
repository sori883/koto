import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { initMemory, saveConcept } from "../../cli/memory/lib/mutate.ts";
import { openProjectMemory } from "../../cli/memory/lib/memory.ts";
import { parseDocument, type Metadata } from "../../cli/memory/lib/frontmatter.ts";
import { WriteError } from "../../cli/memory/lib/files.ts";

let root: string;
const cliPath = resolve(import.meta.dir, "../../cli/memory/memory.ts");
const metadata: Metadata = { type: "knowledge", title: "認証", description: "認証方式の説明" };
const path = (relative: string, project = "default") => join(root, ".space", project, "memory", relative);
const read = (relative: string, project = "default") => readFile(path(relative, project), "utf8");
async function put(relative: string, content: string) {
  await mkdir(dirname(path(relative)), { recursive: true }); await writeFile(path(relative), content);
}
async function create(id = "knowledge/auth", extra: Metadata = {}) {
  return saveConcept("create", root, "default", id, { ...metadata, ...extra }, "本文\r\n");
}
async function update(patch: Metadata = {}, body?: string, options = {}) {
  return saveConcept("update", root, "default", "knowledge/auth", patch, body, options);
}
async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, cliPath, ...args, "--root", root, "--json"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { data: (JSON.parse(stdout).data ?? JSON.parse(stdout).error), stderr, code };
}
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "koto-memory-mutate-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("memory mutations", () => {
  test("init is repeatable, repairs missing navigation and stays inside the selected memory", async () => {
    await mkdir(join(root, ".space/default/tasks"), { recursive: true });
    await writeFile(join(root, ".space/default/tasks/keep"), "task");
    const first = await initMemory(root);
    expect(first.changed_paths).toHaveLength(7);
    const log = await read("log.md");
    expect((await initMemory(root)).unchanged).toBe(true);
    await unlink(path("rules/index.md"));
    expect((await initMemory(root)).changed_paths).toEqual(["rules/index.md"]);
    expect(await read("log.md")).toBe(log);
    await initMemory(root, "project-x");
    await create();
    expect(await (await openProjectMemory(root, "project-x")).search("認証")).toEqual([]);
    expect(await readFile(join(root, ".space/default/tasks/keep"), "utf8")).toBe("task");
    expect((await readdir(root)).sort()).toEqual([".space"]);
  });

  test("init rejects an invalid existing root before creating files", async () => {
    await put("index.md", '---\nokf_version: "0.1"\n---\nmanual');
    await expect(initMemory(root)).rejects.toThrow("okf_version");
    expect(await readdir(path(""))).toEqual(["index.md"]);
    expect(await read("index.md")).toContain("manual");
  });

  test("init and saving preserve existing directory link labels and descriptions", async () => {
    await initMemory(root);
    const raw = (await read("index.md")).replace("* [knowledge](knowledge/index.md)", "* [Project-specific knowledge](knowledge/index.md) - KEEP DESCRIPTION");
    await put("index.md", raw);
    expect((await initMemory(root)).unchanged).toBe(true);
    await create();
    expect(await read("index.md")).toBe(raw);
  });

  test("nested creation is readable/searchable and updates each index with one timestamp", async () => {
    await initMemory(root);
    const result = await create("knowledge/security/auth");
    expect(result.changed_paths).toEqual(["knowledge/security/auth.md", "knowledge/security/index.md", "knowledge/index.md", "log.md"]);
    const memory = await openProjectMemory(root);
    const concept = await memory.show("knowledge/security/auth");
    expect(concept.body).toBe("本文\r\n");
    const generated = concept.metadata.generated as { by: string; at: string };
    expect(generated.by).toBe("agent/cli");
    expect(await read("log.md")).toContain(`## ${generated.at.slice(0, 10)}\n`);
    expect(await read("log.md")).toContain(`At: ${generated.at}.`);
    expect(await read("knowledge/security/index.md")).toContain("[認証](auth.md) - 認証方式の説明");
    expect(await read("knowledge/index.md")).toContain("security/index.md");
    expect((await memory.search("認証"))[0]?.concept_id).toBe("knowledge/security/auth");
  });

  test("partial updates preserve body, unknown fields and human verification; unset removes optional keys", async () => {
    await initMemory(root);
    const verified = [{ by: "human:alice", at: "2026-10-28T10:00:00Z" }];
    await create(undefined, { verified, custom: { a: 1, b: 2 }, tags: ["old"], status: "draft" });
    await update({ title: "新しい認証" }, undefined, { unset: ["tags", "status"], actor: "agent:codex" });
    const concept = await (await openProjectMemory(root)).show("knowledge/auth");
    expect(concept.metadata).toMatchObject({ title: "新しい認証", verified, custom: { a: 1, b: 2 }, generated: { by: "agent:codex" } });
    expect(concept.metadata).not.toHaveProperty("tags");
    expect(concept.metadata).not.toHaveProperty("status");
    expect(concept.body).toBe("本文\r\n");
    expect(await read("knowledge/index.md")).toContain("[新しい認証](auth.md)");
    await update({}, "");
    expect(parseDocument(await read("knowledge/auth.md")).body).toBe("");
  });

  test("same values, reordered object keys and a different actor preserve exact bytes and mtimes", async () => {
    await initMemory(root);
    await create(undefined, { custom: { a: 1, b: 2 } });
    const raw = (await read("knowledge/auth.md")).replace("title: 認証", "title: 認証 # keep this comment");
    await put("knowledge/auth.md", raw);
    const paths = ["knowledge/auth.md", "knowledge/index.md", "index.md", "log.md"];
    const before = await Promise.all(paths.map(async p => [await read(p), (await lstat(path(p))).mtimeMs]));
    expect(await update({ custom: { b: 2, a: 1 } }, undefined, { actor: "agent:other" })).toMatchObject({ unchanged: true, changed_paths: [] });
    expect(await Promise.all(paths.map(async p => [await read(p), (await lstat(path(p))).mtimeMs]))).toEqual(before);
  });

  test("update can repair a parseable concept missing required metadata", async () => {
    await initMemory(root);
    await put("knowledge/auth.md", "---\ntype: knowledge\ntitle: 認証\n---\n本文");
    await update({ description: "補った説明" });
    expect((await (await openProjectMemory(root)).show("knowledge/auth")).metadata.description).toBe("補った説明");
  });

  test("failed validation and bookkeeping preflight leave the concept unchanged", async () => {
    await initMemory(root); await create();
    const raw = await read("knowledge/auth.md"), log = await read("log.md");
    for (const patch of [{ type: "rule" }, { title: "" }, { generated: {} }, { custom: Infinity }] as Metadata[]) {
      await expect(update(patch)).rejects.toBeInstanceOf(WriteError);
    }
    await expect(update({}, undefined, { unset: ["description"] })).rejects.toThrow("Cannot unset");
    await put("knowledge/index.md", "# Manual\n```md\nunclosed");
    await expect(update({ title: "変更" })).rejects.toThrow("Unclosed");
    expect(await read("knowledge/auth.md")).toBe(raw);
    expect(await read("log.md")).toBe(log);
  });

  test("ordinary no-op does not repair indexes; sync repairs once without changing generated", async () => {
    await initMemory(root); await create();
    const raw = await read("knowledge/auth.md");
    await put("knowledge/index.md", "# 手書き\n\n残す文章\n\n");
    await put("log.md", "# 既存履歴\n");
    expect((await update()).unchanged).toBe(true);
    expect(await read("knowledge/index.md")).not.toContain("auth.md");
    expect((await update({}, undefined, { sync: true })).changed_paths).toEqual(["knowledge/index.md", "log.md"]);
    expect(await read("knowledge/auth.md")).toBe(raw);
    expect(await read("log.md")).toContain("**Synchronization**");
    expect(await read("log.md")).toContain("# 既存履歴");
    expect((await update({}, undefined, { sync: true })).unchanged).toBe(true);
  });

  test("indexes preserve hand-written prose, code and commented links; URLs are escaped", async () => {
    await initMemory(root);
    const manual = '# 手書き\n\n```md\n* [example](a%20b%28c%29.md)\n```\n<!--\n* [comment](a%20b%28c%29.md)\n-->\n\n残す文章\n';
    await put("knowledge/index.md", manual);
    await create("knowledge/a b(c)", { title: "角[括弧]", description: "説明*です" });
    expect(await read("knowledge/index.md")).toStartWith(manual);
    expect(await read("knowledge/index.md")).toContain("* [角\\[括弧\\]](a%20b%28c%29.md) - 説明\\*です");
    expect((await saveConcept("update", root, "default", "knowledge/a b(c)", {}, undefined, { sync: true })).unchanged).toBe(true);
  });

  test("HTML syntax in metadata cannot make generated navigation uneditable", async () => {
    await initMemory(root);
    await saveConcept("create", root, "default", "knowledge/auth", { ...metadata, title: "<!-- コメントの扱い", description: "a & <b> -->" }, "body", { actor: "agent:<!--" });
    expect(await read("knowledge/index.md")).toContain("&lt;!-- コメントの扱い");
    expect(await read("knowledge/index.md")).toContain("a &amp; &lt;b&gt; --&gt;");
    expect(await read("log.md")).toContain("agent:&lt;!--");
    await update({ description: "更新後 <!--" });
    expect((await update({}, undefined, { sync: true })).unchanged).toBe(true);
  });

  test("literal backticks across metadata fields do not hide links or duplicate sync entries", async () => {
    await initMemory(root);
    await create(undefined, { title: "バッククォート `", description: "` の使い方" });
    const index = await read("knowledge/index.md"), log = await read("log.md");
    expect((await update({}, undefined, { sync: true })).unchanged).toBe(true);
    expect((await update({}, undefined, { sync: true })).unchanged).toBe(true);
    expect(await read("knowledge/index.md")).toBe(index);
    expect(await read("log.md")).toBe(log);
  });

  test("inline code can explain HTML comments without opening a comment", async () => {
    await initMemory(root);
    const manual = "HTML comments start with `<!--`.\n<!-- backtick ` in a comment\n    -->\n";
    await put("knowledge/index.md", manual);
    await create();
    expect(await read("knowledge/index.md")).toStartWith(manual);
    expect((await update({}, undefined, { sync: true })).unchanged).toBe(true);
  });

  test("a navigation row with multiple concept links is rejected without losing its text", async () => {
    await initMemory(root); await create();
    const manual = "* [A](auth.md) and [B](other.md)\n";
    await put("knowledge/index.md", manual);
    await expect(update({ title: "changed" })).rejects.toThrow("Ambiguous");
    expect(await read("knowledge/index.md")).toBe(manual);
    expect(parseDocument(await read("knowledge/auth.md")).metadata.title).toBe("認証");
  });

  test("links within hand-written list prose are preserved as a managed entry is added", async () => {
    await initMemory(root); await create();
    const manual = "* To onboard a new engineer, review [Auth](auth.md) with the owner.\n* [Auth](auth.md) is useful during onboarding.\n";
    await put("knowledge/index.md", manual);
    await update({ title: "新しい題名" });
    expect(await read("knowledge/index.md")).toBe(`${manual}* [新しい題名](auth.md) - 認証方式の説明\n`);
    expect((await update({}, undefined, { sync: true })).unchanged).toBe(true);
  });

  test("no-index/no-log affect only bookkeeping and sync cannot combine with them", async () => {
    await initMemory(root);
    const index = await read("knowledge/index.md"), log = await read("log.md");
    await saveConcept("create", root, "default", "knowledge/auth", metadata, "body", { noIndex: true, noLog: true });
    expect(await read("knowledge/index.md")).toBe(index);
    expect(await read("log.md")).toBe(log);
    await expect(update({}, undefined, { sync: true, noLog: true })).rejects.toThrow("--sync");
  });

  test("symlinked ancestors, concepts and bookkeeping files cannot redirect mutations", async () => {
    const outside = join(root, "outside"); await mkdir(outside);
    await symlink(outside, join(root, ".space"));
    await expect(initMemory(root)).rejects.toThrow("Symbolic links");
    expect(await readdir(outside)).toEqual([]);
    await unlink(join(root, ".space")); await initMemory(root); await create();
    const raw = await read("knowledge/auth.md");
    await writeFile(join(outside, "secret"), "secret");
    await unlink(path("log.md")); await symlink(join(outside, "secret"), path("log.md"));
    await expect(update({ title: "changed" })).rejects.toThrow("Symbolic links");
    expect(await read("knowledge/auth.md")).toBe(raw);
    await unlink(path("knowledge/auth.md")); await symlink(join(outside, "secret"), path("knowledge/auth.md"));
    await expect(update()).rejects.toThrow("Symbolic links");
    expect(await readFile(join(outside, "secret"), "utf8")).toBe("secret");
  });

  test("existing and missing IDs are errors; updates do not initialize unknown projects", async () => {
    await initMemory(root); await create();
    await expect(create()).rejects.toThrow("already exists");
    await expect(saveConcept("update", root, "other", "knowledge/auth", {}, undefined)).rejects.toThrow("does not exist");
    await expect(saveConcept("update", root, "default", "knowledge/missing", {}, undefined)).rejects.toThrow("not found");
    expect(await readdir(join(root, ".space"))).toEqual(["default"]);
  });
});

describe("write CLI", () => {
  test("a partially saved creation retains its plan and is completed by recover", async () => {
    await initMemory(root); await mkdir(path("knowledge/nested"));
    await chmod(path("knowledge"), 0o555);
    let result;
    try { result = await cli(["create", "knowledge/nested/auth", "--type", "knowledge", "--title", "認証", "--desc", "説明"]); }
    finally { await chmod(path("knowledge"), 0o755); }
    expect(result.code).toBe(1);
    expect(result.data.details.written_paths).toEqual(["knowledge/nested/auth.md", "knowledge/nested/index.md"]);
    const raw = await read("knowledge/nested/auth.md");
    expect((await cli(["recover"])).code).toBe(0);
    expect(await read("knowledge/nested/auth.md")).toBe(raw);
    expect(await read("log.md")).toContain("**Creation**");
    expect(await read("knowledge/index.md")).toContain("nested/index.md");
  });

  test("external input rejects invalid UTF-8, oversized files and FIFOs", async () => {
    await initMemory(root);
    const input = join(root, "input");
    const args = ["create", "knowledge/auth", "--type", "knowledge", "--title", "認証", "--desc", "説明", "--body-file", input];
    await writeFile(input, Buffer.from([0xff]));
    expect((await cli(args)).code).toBe(1);
    await writeFile(input, "a".repeat(16 * 1024 * 1024 + 1));
    expect((await cli(args)).data.message).toContain("16 MiB");
    await unlink(input);
    expect(await Bun.spawn(["mkfifo", input], { stdout: "ignore", stderr: "pipe" }).exited).toBe(0);
    expect((await cli(args)).data.message).toContain("regular file");
    expect(await readdir(path("knowledge"))).toEqual(["index.md"]);
  });

  test("real init/create/show/search/update with external metadata and body files", async () => {
    expect((await cli(["init"])).code).toBe(0);
    const metaPath = join(root, "metadata.json"), bodyPath = join(root, "body.md");
    await writeFile(metaPath, JSON.stringify({ ...metadata, title: "file title", custom: { value: 4 }, status: "draft" }));
    await writeFile(bodyPath, "authentication 認証\r\n");
    const result = await cli(["create", "knowledge/auth", "--metadata-file", metaPath, "--title", "flag title", "--tags", "auth, 認証", "--body-file", bodyPath, "--actor", "agent:codex"]);
    expect(result.code).toBe(0); expect(result.stderr).toBe("");
    const shown = await cli(["show", "knowledge/auth"]);
    expect(shown.data).toMatchObject({ body: "authentication 認証\r\n", metadata: { title: "flag title", tags: ["auth", "認証"], custom: { value: 4 } } });
    expect((await cli(["search", "認証"])).data[0].concept_id).toBe("knowledge/auth");
    expect((await cli(["update", "knowledge/auth", "--desc", "新しい説明", "--unset", "status", "--unset", "custom"])).code).toBe(0);
    expect((await cli(["show", "knowledge/auth"])).data.metadata).not.toHaveProperty("custom");
  });

  test.each(["type: knowledge\ntitle: YAML\ndescription: YAML説明\n", "---\ntype: knowledge\ntitle: Markdown\ndescription: Markdown説明\n---\nignored body"])("metadata-file accepts mappings/frontmatter: %s", async raw => {
    await initMemory(root); await writeFile(join(root, "meta"), raw);
    expect((await cli(["create", "knowledge/auth", "--metadata-file", join(root, "meta")])).code).toBe(0);
    expect(parseDocument(await read("knowledge/auth.md")).body).toBe("");
  });

  test.each([
    ["init", "extra"], ["init", "--body", "ignored"], ["create", "knowledge/auth", "--unset", "status"],
    ["create", "knowledge/auth", "--sync"], ["update", "knowledge/auth", "--body", "x", "--body-file", "anything"],
    ["search", "認証", "--title", "ignored"], ["show", "knowledge/auth", "--sync"],
    ["update", "knowledge/auth", "--title", "a", "--title", "b"], ["init", "--actor", "invalid"],
  ].map(args => ({ args })))("inapplicable or ambiguous options fail before saving: %j", async ({ args }) => {
    await initMemory(root); const log = await read("log.md");
    const result = await cli(args);
    expect(result.code).toBe(1); expect(result.data.code).toBeDefined();
    expect(await read("log.md")).toBe(log);
  });

  test("concurrent child processes cannot create the same ID twice", async () => {
    await initMemory(root);
    const args = ["create", "knowledge/auth", "--type", "knowledge", "--title", "認証", "--desc", "説明"];
    const results = await Promise.all([cli(args), cli(args)]);
    expect(results.map(result => result.code).sort()).toEqual([0, 1]);
    expect(results.find(result => result.code === 1)?.data.details.written_paths).toEqual([]);
    expect((await read("log.md")).match(/\]\(knowledge\/auth.md\)/g)).toHaveLength(1);
    expect(await readdir(path(""))).not.toContain(".okf-write-lock");
  });
});
