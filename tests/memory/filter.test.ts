import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { matchesFilters, parseFilters } from "../../cli/memory/lib/filter.ts";
import { serializeDocument, type Metadata } from "../../cli/memory/lib/frontmatter.ts";
import { openProjectMemory } from "../../cli/memory/lib/memory.ts";
import { initMemory, saveConcept } from "../../cli/memory/lib/mutate.ts";

const matches = (metadata: Metadata, ...conditions: string[]) => matchesFilters(metadata, parseFilters(conditions));

describe("metadata conditions", () => {
  test("all conditions must match, including multiple values of the same array", () => {
    const metadata = { tags: ["認証", "API"], status: "stable" };
    expect(matches(metadata, "tags=認証", "tags=API", "status=stable")).toBe(true);
    expect(matches(metadata, "tags=認証", "status=draft")).toBe(false);
    expect(matches(metadata, "tags=認証", "tags!=認証")).toBe(false);
  });

  test("strings match exactly without case folding, normalization or prefixes", () => {
    const metadata = { label: "Ａuth", title: "認証方式" };
    expect(matches(metadata, "label=Ａuth", "title=認証方式")).toBe(true);
    for (const condition of ["label=Auth", "label=ａuth", "title=認証"]) expect(matches(metadata, condition)).toBe(false);
  });

  test("scalar types, empty strings and quoted whitespace remain distinct", () => {
    const metadata = { n: 123, s: "123", flag: false, text: "false", nil: null, empty: "", padded: " x " };
    expect(matches(metadata, "n=1.23e2", 's="123"', "flag=false", 'text="false"', "nil=null", 'empty=""', 'padded=" x "')).toBe(true);
    for (const condition of ['n="123"', "s=123", 'flag="false"', "text=false", 'nil="null"', "padded=x"]) expect(matches(metadata, condition)).toBe(false);
  });

  test("literal equality characters and quoted JSON escapes are preserved", () => {
    expect(matches({ url: "https://example.test/?x=1", text: "a\nb", code: "01" }, "url=https://example.test/?x=1", 'text="a\\nb"', "code=01")).toBe(true);
  });

  test("missing, null, empty arrays and empty objects are different states", () => {
    const metadata = { nil: null, empty: [], obj: {} };
    expect(matches(metadata, "!absent", "nil?", "empty?", "obj?", "nil=null")).toBe(true);
    for (const condition of ["absent?", "absent!=x", "absent=null", "!nil", "empty=x", "obj=x"]) expect(matches(metadata, condition)).toBe(false);
    expect(matches(metadata, "nil!=x", "empty!=x", "obj!=x")).toBe(true);
  });

  test("nested paths cross arrays and inequality requires no matching element", () => {
    const metadata: Metadata = { verified: [{ by: "human:alice" }, { by: "human:bob" }, {}], custom: { flags: [[true, false]] } };
    expect(matches(metadata, "verified.by=human:alice", "verified.by=human:bob", "custom.flags=true")).toBe(true);
    expect(matches(metadata, "verified.by!=human:alice")).toBe(false);
    expect(matches(metadata, "verified.by!=human:carol", "verified.by?", "!verified.at")).toBe(true);
  });

  test("separate array clauses are independent, not a correlated element query", () => {
    const metadata = { custom: [{ name: "a", count: 1 }, { name: "b", count: 2 }] };
    expect(matches(metadata, "custom.name=a", "custom.count=2")).toBe(true);
    expect(matches(metadata, "custom.name=c", "custom.count=2")).toBe(false);
  });

  test("status and governance defaults apply to values but not stored-field presence", () => {
    expect(matches({}, "status=stable", "governance=context", "!status", "!governance")).toBe(true);
    expect(matches({}, "status!=draft", "governance!=hold")).toBe(true);
    expect(matches({}, "status?")).toBe(false);
    expect(matches({ status: "draft" }, "status=stable")).toBe(false);
    expect(matches({ custom: {} }, "custom.status=stable")).toBe(false);
  });

  test("only own attributes are visible, including safely stored prototype-like keys", () => {
    expect(matches({}, "!constructor", "!toString", "!__proto__")).toBe(true);
    const metadata = JSON.parse('{"__proto__":{"marker":"own"},"constructor":"own"}');
    expect(matches(metadata, "__proto__.marker=own", "constructor=own", "!__proto__.toString")).toBe(true);
    expect(matches({ "日本語": { "a-b_2": "値" } }, "日本語.a-b_2=値")).toBe(true);
  });

  test.each(["", "field", "x=", "x!=", "=value", "x>1", "x>=1", "a..b=x", "a/b=x", "x[0]=a", "!", "?", "x=[]", "x={}", 'x="broken', "x=1e999", "!x?"])("invalid expression is rejected: %s", expression => {
    expect(() => parseFilters([expression])).toThrow();
  });

  test("input bounds reject excess conditions, characters and path depth", () => {
    expect(parseFilters(Array(50).fill("x?"))).toHaveLength(50);
    expect(() => parseFilters(Array(51).fill("x?"))).toThrow("50");
    expect(parseFilters([`x=${"a".repeat(4094)}`])).toHaveLength(1);
    expect(() => parseFilters([`x=${"a".repeat(4095)}`])).toThrow("4096");
    expect(parseFilters([`${Array(64).fill("x").join(".")}?`])).toHaveLength(1);
    expect(() => parseFilters([`${Array(65).fill("x").join(".")}?`])).toThrow();
  });
});

describe("filtered CLI search", () => {
  let root: string;
  const cliPath = resolve(import.meta.dir, "../../cli/memory/memory.ts");
  const file = (id: string) => join(root, ".space/default/memory", `${id}.md`);
  async function create(id: string, extra: Metadata = {}, body = "本文", project = "default") {
    await saveConcept("create", root, project, id, { type: "knowledge", title: id.split("/").at(-1)!, description: "説明", ...extra }, body);
  }
  async function cli(args: string[], json = true) {
    const child = Bun.spawn([process.execPath, cliPath, ...args, "--root", root, ...(json ? ["--json"] : [])], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, code, data: json ? (JSON.parse(stdout).data ?? JSON.parse(stdout).error) : undefined };
  }
  async function snapshot(directory = root): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const name of (await readdir(directory)).sort()) {
      const full = join(directory, name), stat = await lstat(full);
      out.push([name, stat.mtimeMs, stat.size, stat.isDirectory() ? await snapshot(full) : await readFile(full, "utf8")]);
    }
    return out;
  }
  const ids = (data: { concept_id: string }[]) => data.map(item => item.concept_id);
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "koto-memory-filter-")); await initMemory(root); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  test("filter-only search combines clauses with AND and orders by governance then ID", async () => {
    await create("knowledge/a", { tags: ["認証"] });
    await create("knowledge/b", { tags: ["認証"], governance: "hold", status: "stable" });
    await create("rules/c", { type: "rule", tags: ["認証"], governance: "constraint" });
    await create("knowledge/d", { tags: ["認証"], status: "draft" });
    await create("knowledge/e", { tags: ["API"] });
    const result = await cli(["search", "--filter", "tags=認証", "--filter", "status=stable", "--all"]);
    expect(result.code).toBe(0); expect(result.stderr).toBe("");
    expect(ids(result.data)).toEqual(["knowledge/b", "rules/c", "knowledge/a"]);
    expect(result.data[0]).toMatchObject({ score: 0, matched_on: ["filter"] });
    const rules = await cli(["search", "--filter", "tags=認証", "--type", "rule"]);
    expect(ids(rules.data)).toEqual(["rules/c"]);
    expect(rules.data[0].matched_on).toEqual(["type", "filter"]);
    expect((await cli(["search", "--filter", "type=rule", "--type", "knowledge"])).data).toEqual([]);
  });

  test("quoted scalar values, unknown metadata, sources and reviewers work through the CLI", async () => {
    await create("knowledge/a", { custom: { code: "123", flag: false }, verified: [{ by: "human:alice", at: "2026-01-01T00:00:00Z" }], sources: [{ resource: "https://example.test/spec", usage_count: 2 }] });
    await create("knowledge/b", { custom: { code: 123, flag: false } });
    const result = await cli(["search", "--filter", 'custom.code="123"', "--filter", "custom.flag=false", "--filter", "verified.by=human:alice", "--filter", "sources.usage_count=2"]);
    expect(result.code).toBe(0); expect(ids(result.data)).toEqual(["knowledge/a"]);
    expect(ids((await cli(["search", "--filter", "custom.code=123", "--filter", "!verified"])).data)).toEqual(["knowledge/b"]);
  });

  test("missing differs from empty verification and defaulted status", async () => {
    await create("knowledge/a"); await create("knowledge/b", { verified: [], status: "stable" });
    expect(ids((await cli(["search", "--filter", "!verified"])).data)).toEqual(["knowledge/a"]);
    expect(ids((await cli(["search", "--filter", "verified?"])).data)).toEqual(["knowledge/b"]);
    expect(ids((await cli(["search", "--filter", "status=stable", "--filter", "!status"])).data)).toEqual(["knowledge/a"]);
  });

  test("id and body filters address metadata, not the document ID or Markdown body", async () => {
    await create("knowledge/a", { id: "custom-id", body: "custom-body" }, "actual-body");
    expect(ids((await cli(["search", "--filter", "id=custom-id", "--filter", "body=custom-body"])).data)).toEqual(["knowledge/a"]);
    expect((await cli(["search", "--filter", "id=knowledge/a"])).data).toEqual([]);
    expect((await cli(["search", "--filter", "body=actual-body"])).data).toEqual([]);
  });

  test("keyword OR and exact conditions are separate, without changing corpus scores", async () => {
    await create("knowledge/a", { tags: ["target"], title: "認証" });
    await create("knowledge/b", { tags: ["target"], title: "支払い" });
    await create("knowledge/c", { tags: ["other"], title: "認証 支払い" });
    const baseline = await cli(["search", "認証 支払い", "--all"]);
    const filtered = await cli(["search", "認証 支払い", "--filter", "tags=target", "--all"]);
    expect(filtered.code).toBe(0);
    expect(filtered.data).toEqual(baseline.data.filter((item: { concept_id: string }) => item.concept_id !== "knowledge/c").map((item: { matched_on: string[] }) => ({ ...item, matched_on: [...item.matched_on, "filter"] })));
    expect(filtered.data).toHaveLength(2);
  });

  test("filtering precedes the default limit, explicit limit and type listing", async () => {
    for (let i = 0; i < 12; i++) await create(`knowledge/a${String(i).padStart(2, "0")}`, { title: "認証", tags: ["other"] });
    await create("knowledge/z", { title: "認証", tags: ["target"] });
    expect(ids((await cli(["search", "認証"])).data)).not.toContain("knowledge/z");
    for (const args of [["認証"], ["認証", "--limit", "1"], ["--type", "knowledge", "--limit", "1"], ["--limit", "1"]]) {
      const result = await cli(["search", ...args, "--filter", "tags=target"]);
      expect(result.code).toBe(0); expect(ids(result.data)).toEqual(["knowledge/z"]);
    }
  });

  test("code path filters run before the limit and retain keyword boost semantics", async () => {
    for (let i = 0; i < 11; i++) await create(`knowledge/a${i}`, { code_refs: ["repositories/default/api/src/auth.ts"], governance: "hold", tags: ["other"] });
    await create("knowledge/z", { code_refs: ["repositories/default/api/src/"], tags: ["target"] });
    await create("knowledge/unrelated", { code_refs: ["repositories/default/ui/"], tags: ["target"] });
    const result = await cli(["search", "見つからない語", "--for-path", "repositories/default/api/src/auth.ts", "--filter", "tags=target", "--limit", "1"]);
    expect(result.code).toBe(0); expect(ids(result.data)).toEqual(["knowledge/z"]);
    expect(result.data[0]).toMatchObject({ score: 0, code_refs: ["repositories/default/api/src/"], matched_on: ["code_refs", "filter"] });
    expect((await cli(["search", "--for-path", "repositories/default/api/src/auth.ts", "--filter", "tags=target", "--type", "rule"])).data).toEqual([]);
  });

  test("all and capped limit still work for filter-only, keyword and code path queries", async () => {
    for (let i = 0; i < 105; i++) await writeFile(file(`knowledge/d${i}`), serializeDocument({ metadata: { type: "knowledge", title: "認証", description: "説明", tags: ["target"], code_refs: ["repositories/default/api/"] }, body: "本文" }));
    for (const query of [[], ["認証"], ["--for-path", "repositories/default/api/a.ts"]]) {
      for (const [options, count] of [[[], 10], [["--limit", "999"], 100], [["--all"], 105]] as const) {
        const result = await cli(["search", ...query, "--filter", "tags=target", ...options]);
        expect(result.code).toBe(0); expect(result.data).toHaveLength(count);
      }
    }
    const memory = await openProjectMemory(root);
    await expect(memory.search("", { filters: parseFilters(["tags=target"]), all: true, limit: 1 })).rejects.toThrow();
  });

  test("filtered-out invalid documents still cause a read failure", async () => {
    await create("knowledge/a", { tags: ["target"] });
    await writeFile(file("knowledge/bad"), '---\ntype: knowledge\ntitle: bad\ndescription: bad\ntags: [other]\nstatus: invalid\n---\n');
    for (const query of [[], ["認証"], ["--for-path", "repositories/default/api/a.ts"]]) {
      const result = await cli(["search", ...query, "--filter", "tags=target"]);
      expect(result.code).toBe(2); expect(result.data.code).toBeDefined(); expect(result.data.message).toContain("knowledge/bad.md");
    }
  });

  test("search remains project-scoped and does not mutate files or directory mtimes", async () => {
    await initMemory(root, "project-x");
    await create("knowledge/a", { tags: ["target"] });
    await create("knowledge/b", { tags: ["target"] }, "本文", "project-x");
    const before = await snapshot();
    expect(ids((await cli(["search", "--filter", "tags=target"])).data)).toEqual(["knowledge/a"]);
    expect(ids((await cli(["search", "--filter", "tags=target", "--project", "project-x"])).data)).toEqual(["knowledge/b"]);
    expect((await cli(["search", "--filter", "tags=missing"])).data).toEqual([]);
    expect((await cli(["search", "--filter", "tags=missing"], false)).stdout).toBe("No matches.\n");
    expect(await snapshot()).toEqual(before);
  });

  test("invalid filters and incompatible flags return JSON usage errors without reading", async () => {
    await rm(join(root, ".space"), { recursive: true });
    const tooMany = Array.from({ length: 51 }, () => ["--filter", "x?"]).flat();
    for (const args of [["search", "--filter", "x="], ["search", ...tooMany], ["search", "--filter", "x?", "--all", "--limit", "1"], ["search", "--filter", "x?", "--limit", "0"], ["show", "knowledge/a", "--filter", "x?"], ["init", "--filter", "x?"]]) {
      const result = await cli(args);
      expect(result.code).toBe(1); expect(result.stderr).toBe(""); expect(result.data.code).toBeDefined();
    }
    expect(await readdir(root)).toEqual([]);
  });
});
