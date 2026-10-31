import { describe, expect, test } from "bun:test";
import { parseDocument, searchDocument, type Concept } from "../../cli/memory/lib/frontmatter.ts";

function concept(extra = "", body = "本文\n"): Concept {
  const raw_content = `---\ntype: knowledge\ntitle: 認証\ndescription: 認証の説明\n${extra}---\n${body}`;
  return { id: "knowledge/auth", path: "knowledge/auth.md", raw_content, ...parseDocument(raw_content) };
}

describe("OKF frontmatter", () => {
  test("keeps original body, unknown nested fields, aliases and reserved-looking metadata", () => {
    const c = concept("id: custom\nbody: metadata body\nconstructor: custom constructor\n__proto__: safe\nextra: &extra\n  list: [true, 1, null]\ncopy: *extra\ntext: |\n  first\n  second\n");
    expect(c.metadata).toMatchObject({ id: "custom", body: "metadata body", constructor: "custom constructor", extra: { list: [true, 1, null] }, copy: { list: [true, 1, null] }, text: "first\nsecond\n" });
    expect(Object.hasOwn(c.metadata, "__proto__")).toBe(true);
    expect(c.body).toBe("本文\n");
    expect(searchDocument(c).governance).toBe("context");
  });

  test("accepts BOM, CRLF and a final delimiter without newline", () => {
    expect(parseDocument("\uFEFF---\r\ntitle: hello\r\n---\r\nbody\r\n").body).toBe("body\r\n");
    expect(parseDocument("---\nx: 1\n---").body).toBe("");
  });

  test.each([
    "no frontmatter", "---\ntype: knowledge\n", "---\n- one\n---\n", "---\nx: [\n---\n",
    "---\nx: &cycle [*cycle]\n---\n", "---\nx: .inf\n---\n",
  ])("rejects invalid or non-JSON frontmatter: %s", raw => {
    expect(() => parseDocument(raw)).toThrow();
  });

  test("bounds alias expansion and nesting", () => {
    expect(() => parseDocument(`---\nx: ${"[".repeat(66)}0${"]".repeat(66)}\n---\n`)).toThrow("nesting");
    const aliases = ["v0: &v0 [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]"];
    for (let i = 1; i < 6; i++) aliases.push(`v${i}: &v${i} [${Array(10).fill(`*v${i - 1}`).join(", ")}]`);
    expect(() => parseDocument(`---\n${aliases.join("\n")}\n---\n`)).toThrow("limit");
  });

  test("reads historical verification and expired knowledge without a freshness gate", () => {
    const c = concept("generated: {by: 'agent:codex', at: '2026-10-30T10:00:00+09:00'}\nverified: [{by: 'human:tester', at: '2025-01-01T00:00:00Z'}]\nstale_after: 2020-01-01T00:00:00Z\nsources: [{resource: 'reference.md', id: 'one', usage_count: 0}]\ncode_refs: ['src/**/*.ts']\n");
    expect(searchDocument(c).type).toBe("knowledge");
  });

  test.each([
    "title: ''\n", "description: |\n  line one\n  line two\n", "type: unknown\n", "type: rule\n",
    "tags: [same, same]\n", "tags: plain\n", "resource: null\n", "status: reviewed\n", "governance: admin\n",
    "generated: {by: robot, at: '2026-01-01T00:00:00Z'}\n",
    "generated: {by: 'agent:test', at: '2026-02-30T00:00:00Z'}\n",
    "verified: [{by: 'agent:test', at: '2026-01-01T00:00:00Z'}]\n",
    "stale_after: '2026-01-01'\n", "sources: [{}]\n", "sources: [{resource: a, usage_count: -1}]\n",
    "sources: [{resource: a, id: duplicate}, {resource: b, id: duplicate}]\n",
    "code_refs: ['../outside']\n", "code_refs: ['/outside']\n",
  ])("checks the koto metadata profile: %s", extra => {
    expect(() => searchDocument(concept(extra))).toThrow();
  });
});
