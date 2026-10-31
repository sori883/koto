import { describe, expect, test } from "bun:test";
import { createSearchIndex, type SearchDocument } from "../../cli/memory/lib/search.ts";

function document(overrides: Partial<SearchDocument> = {}): SearchDocument {
  return { id: "knowledge/entry", type: "knowledge", title: "Entry", description: "Overview", body: "", ...overrides };
}

const ids = (results: ReturnType<ReturnType<typeof createSearchIndex>["search"]>) => results.map(result => result.concept_id);

describe("Japanese and keyword matching", () => {
  test("finds a word inside a Japanese sentence", () => {
    const index = createSearchIndex([
      document({ id: "rules/auth", type: "rule", title: "認証変更の保留ルール" }),
      document({ id: "knowledge/billing", title: "請求書の作成" }),
    ]);
    expect(ids(index.search("ルール"))).toEqual(["rules/auth"]);
    expect(ids(index.search("認証"))).toEqual(["rules/auth"]);
  });

  test("normalizes full-width Latin, half-width katakana, case, and combining marks", () => {
    const index = createSearchIndex([
      document({ id: "knowledge/api", title: "API トークン café" }),
      document({ id: "knowledge/invoice", title: "請求書" }),
    ]);
    for (const query of ["API", "api", "ａｐｉ", "ＡＰＩ", "ﾄｰｸﾝ", "cafe\u0301"]) {
      expect(ids(index.search(query))).toEqual(["knowledge/api"]);
    }
  });

  test("matches prefixes, but does not perform infix or fuzzy matching", () => {
    const index = createSearchIndex([document({ title: "authentication" })]);
    expect(ids(index.search("auth"))).toEqual(["knowledge/entry"]);
    expect(index.search("entication")).toEqual([]);
    expect(index.search("authentcation")).toEqual([]);
  });

  test("combines query words with OR", () => {
    const index = createSearchIndex([
      document({ id: "knowledge/auth", title: "ログイン" }),
      document({ id: "knowledge/billing", title: "請求" }),
      document({ id: "knowledge/build", title: "ビルド" }),
    ]);
    expect(ids(index.search("ログイン 請求")).sort()).toEqual(["knowledge/auth", "knowledge/billing"]);
  });

  test("skips common particles without removing negation", () => {
    const index = createSearchIndex([document({ title: "削除してはいけない" })]);
    expect(index.search("の は が を に へ と で も や")).toEqual([]);
    expect(ids(index.search("ない"))).toEqual(["knowledge/entry"]);
  });

  test("searches all five fields and reports the actual matching fields", () => {
    const index = createSearchIndex([
      document({ id: "knowledge/title", title: "quasar" }),
      document({ id: "knowledge/tags", tags: ["quasar"] }),
      document({ id: "knowledge/description", description: "quasar" }),
      document({ id: "knowledge/quasar" }),
      document({ id: "knowledge/body", body: "quasar" }),
    ]);
    const found = new Map(index.search("quasar").map(result => [result.concept_id, result.matched_on]));
    expect(found.size).toBe(5);
    expect(found.get("knowledge/title")).toEqual(["title"]);
    expect(found.get("knowledge/tags")).toEqual(["tags"]);
    expect(found.get("knowledge/description")).toEqual(["description"]);
    expect(found.get("knowledge/quasar")).toEqual(["id"]);
    expect(found.get("knowledge/body")).toEqual(["body"]);
  });

  test("returns a compact result without exposing the body", () => {
    const index = createSearchIndex([document({ title: "quasar", tags: ["astronomy"], body: "Long private body" })]);
    expect(index.search("quasar")[0]).toEqual({
      concept_id: "knowledge/entry", type: "knowledge", title: "quasar", description: "Overview",
      governance: "context", score: 1.15, matched_on: ["title"], tags: ["astronomy"],
    });
  });
});

describe("Ranking", () => {
  test("matches a hand-calculated BM25 example", () => {
    const index = createSearchIndex([
      document({ id: "knowledge/a", title: "alpha" }),
      document({ id: "knowledge/b", title: "beta" }),
    ]);
    expect(index.search("alpha")[0]?.score).toBe(2.77);
  });

  test("prefers title matches over a body-only match", () => {
    const index = createSearchIndex([
      document({ id: "knowledge/a", title: "quasar" }),
      document({ id: "knowledge/b", title: "topic", body: "quasar" }),
    ]);
    expect(ids(index.search("quasar"))).toEqual(["knowledge/a", "knowledge/b"]);
  });

  test("compensates for irrelevant text in a long field", () => {
    const index = createSearchIndex([
      document({ id: "knowledge/long", body: `quasar ${"irrelevant ".repeat(200)}` }),
      document({ id: "knowledge/short", body: "quasar brief" }),
    ]);
    expect(ids(index.search("quasar"))).toEqual(["knowledge/short", "knowledge/long"]);
  });

  test("repeated terms have diminishing returns", () => {
    const index = createSearchIndex([
      document({ id: "knowledge/ten", body: "quasar ".repeat(10) }),
      document({ id: "knowledge/hundred", body: "quasar ".repeat(100) }),
    ]);
    const scores = new Map(index.search("quasar").map(result => [result.concept_id, result.score]));
    expect(scores.get("knowledge/hundred")!).toBeGreaterThanOrEqual(scores.get("knowledge/ten")!);
    expect(scores.get("knowledge/hundred")!).toBeLessThan(scores.get("knowledge/ten")! * 2);
  });

  test("prefers an exact word over an otherwise equivalent prefix match", () => {
    const index = createSearchIndex([
      document({ id: "knowledge/expanded", title: "authentication" }),
      document({ id: "knowledge/exact", title: "auth" }),
    ]);
    expect(ids(index.search("auth"))).toEqual(["knowledge/exact", "knowledge/expanded"]);
  });

  test("repeated and overlapping prefixes cannot inflate the score", () => {
    const index = createSearchIndex([document({ title: "authentication" })]);
    expect(index.search("auth auth")).toEqual(index.search("auth"));
    expect(index.search("auth authentication")).toEqual(index.search("authentication"));
    expect(index.search("a auth")).toEqual(index.search("auth"));
  });

  test("query order and document order do not change results", () => {
    const documents = [
      document({ id: "knowledge/b", title: "quasar", tags: ["galaxy"] }),
      document({ id: "knowledge/a", title: "galaxy", body: "quasar" }),
      document({ id: "knowledge/c", title: "star", body: "galaxy" }),
    ];
    const forward = createSearchIndex(documents);
    const backward = createSearchIndex([...documents].reverse());
    expect(forward.search("quasar galaxy")).toEqual(backward.search("galaxy quasar"));
  });

  test("breaks score ties by ID without locale-dependent collation", () => {
    const index = createSearchIndex([
      document({ id: "knowledge/b", title: "quasar" }),
      document({ id: "knowledge/a", title: "quasar" }),
    ]);
    expect(ids(index.search("quasar"))).toEqual(["knowledge/a", "knowledge/b"]);
  });
});

describe("Filtering and limits", () => {
  const documents: SearchDocument[] = [
    document({ id: "knowledge/strong", title: "quasar", tags: ["quasar"], description: "quasar" }),
    document({ id: "rules/context", type: "rule", title: "quasar", governance: "context" }),
    document({ id: "rules/hold", type: "rule", body: "quasar", governance: "hold" }),
    document({ id: "rules/constraint", type: "rule", governance: "constraint" }),
  ];

  test("filters before applying the result limit", () => {
    const index = createSearchIndex(documents);
    expect(ids(index.search("quasar", { type: "rule", limit: 1 }))).toEqual(["rules/context"]);
    expect(index.search("quasar", { type: "rule" })[0]?.matched_on).toEqual(["title", "type"]);
  });

  test("filtering leaves the original document scores unchanged", () => {
    const index = createSearchIndex(documents);
    const all = new Map(index.search("quasar").map(result => [result.concept_id, result.score]));
    for (const result of index.search("quasar", { type: "rule" })) {
      const score = all.get(result.concept_id);
      if (score === undefined) throw new Error(`Missing unfiltered result: ${result.concept_id}`);
      expect(result.score).toBe(score);
    }
  });

  test("type-only search lists hold, constraint, context in that order", () => {
    const index = createSearchIndex(documents);
    expect(ids(index.search(" \n", { type: "rule" }))).toEqual(["rules/hold", "rules/constraint", "rules/context"]);
    expect(index.search("", { type: "rule" }).every(result => result.score === 0 && result.matched_on.join() === "type")).toBe(true);
  });

  test("does not elevate a hold above keyword relevance", () => {
    expect(ids(createSearchIndex(documents).search("quasar", { type: "rule" }))).toEqual(["rules/context", "rules/hold"]);
  });

  test("defaults to ten, caps numeric limits at one hundred, and supports all", () => {
    const index = createSearchIndex(Array.from({ length: 125 }, (_,i) => document({ id: `knowledge/${i}`, title: "quasar" })));
    expect(index.search("quasar")).toHaveLength(10);
    expect(index.search("quasar", { limit: 3 })).toHaveLength(3);
    expect(index.search("quasar", { limit: 1000 })).toHaveLength(100);
    expect(index.search("quasar", { all: true })).toHaveLength(125);
  });

  test.each([0, -1, 0.5, NaN, Infinity])("rejects invalid limit %s", limit => {
    expect(() => createSearchIndex(documents).search("quasar", { limit })).toThrow(RangeError);
  });

  test("rejects all with limit and invalid option values", () => {
    const index = createSearchIndex(documents);
    expect(() => index.search("quasar", { all: true, limit: 5 })).toThrow("cannot be combined");
    expect(() => index.search("quasar", { type: "unknown" } as never)).toThrow("Unknown search type");
    expect(() => index.search("quasar", { all: "yes" } as never)).toThrow("boolean");
    expect(() => index.search(null as never)).toThrow("query must be a string");
  });
});

describe("Boundaries and snapshot isolation", () => {
  test("handles empty collections, empty queries and unknown words", () => {
    expect(createSearchIndex([]).search("quasar")).toEqual([]);
    expect(createSearchIndex([]).search("", { type: "rule" })).toEqual([]);
    const index = createSearchIndex([document({ title: "quasar" })]);
    expect(index.search("")).toEqual([]);
    expect(index.search(" ")).toEqual([]);
    expect(index.search("?!🙂")).toEqual([]);
    expect(index.search("unfindable")).toEqual([]);
  });

  test("does not search arbitrary object property names", () => {
    const index = createSearchIndex([document({ title: "quasar" })]);
    expect(index.search("constructor __proto__ toString")).toEqual([]);
  });

  test("rejects duplicate IDs", () => {
    expect(() => createSearchIndex([document(), document({ title: "Other" })])).toThrow("Duplicate concept ID");
  });

  test("validates the document boundary", () => {
    for (const invalid of [
      { id: " " }, { title: "" }, { description: "" }, { body: null },
      { type: "other" }, { governance: "other" }, { tags: "tag" }, { tags: [""] }, { tags: [2] },
    ]) {
      expect(() => createSearchIndex([document(invalid as never)])).toThrow(TypeError);
    }
  });

  test("later input and result mutations do not change the snapshot", () => {
    const tags = ["quasar"];
    const original = { id: "knowledge/one", type: "knowledge" as const, title: "Entry", description: "Overview", body: "", tags };
    const input = [original];
    const index = createSearchIndex(input);
    const expected = index.search("quasar");
    original.title = "Changed";
    tags[0] = "replaced";
    input.length = 0;
    const results = index.search("quasar");
    results[0]!.title = "Damaged";
    results[0]!.tags!.push("another");
    results[0]!.matched_on.push("body");
    results.length = 0;
    expect(index.search("quasar")).toEqual(expected);
    expect(index.search("replaced")).toEqual([]);
  });

  test("independent inputs can have the same ID without mixing results", () => {
    const first = createSearchIndex([document({ title: "quasar" })]);
    const second = createSearchIndex([document({ title: "galaxy" })]);
    expect(first.search("quasar")).toHaveLength(1);
    expect(second.search("quasar")).toEqual([]);
    expect(second.search("galaxy")).toHaveLength(1);
  });

  test("applies the query character bound using Unicode code points", () => {
    const index = createSearchIndex([document({ title: "quasar" })]);
    expect(index.search("🙂".repeat(999) + "quasar")).toHaveLength(1);
    expect(index.search("🙂".repeat(1000) + "quasar")).toEqual([]);
  });

  test("applies the fifty-word query bound", () => {
    const index = createSearchIndex([document({ title: "quasar" })]);
    expect(index.search("x ".repeat(49) + "quasar")).toHaveLength(1);
    expect(index.search("x ".repeat(50) + "quasar")).toEqual([]);
  });
});
