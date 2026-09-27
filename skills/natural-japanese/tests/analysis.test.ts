import { beforeAll, expect, test } from "bun:test";
import { analyze } from "../scripts/lib/lint.ts";
import { compareBaseline } from "../scripts/lib/baseline.ts";
import { outlineDocument, termInventory } from "../scripts/lib/structure.ts";
import { getTokenizer } from "../scripts/lib/tokenizer.ts";

beforeAll(async () => { await getTokenizer(); });

test("short prose catches stock phrases and conjugated possibility without long-document statistics", async () => {
  const result = await analyze("いかがでしょうか。歩くことができました。\n最後に箱を閉じます。");
  expect(result.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ category: "forbidden_phrase", line: 1 }),
    expect.objectContaining({ category: "translationese_morph", line: 1, excerpt: expect.stringContaining("歩くことができ") }),
  ]));
  expect(result.findings.some(f => /variance|burstiness|lexical|nominal/.test(f.category))).toBe(false);
  expect(result.stats.total_sentences).toBe(3);
});

test("all analyzers exclude frontmatter, mixed fences and comments while preserving source lines", async () => {
  const text = ["---", "title: API いかがでしょうか", "---", "````md", "# HiddenAPI", "```", "いかがでしょうか", "````", "<!--", "# SecretAPI", "いかがでしょうか", "-->", "# 公開API", "😀 `いかがでしょうか`と[案内](https://example.test/いかがでしょうか)を読む。", "いかがでしょうか。"].join("\n");
  const result = await analyze(text, { experimental: true });
  expect(result.findings.filter(f => f.category === "forbidden_phrase").map(f => f.line)).toEqual([15]);
  const outline = await outlineDocument(text);
  expect(outline.outline.filter(e => e.kind === "heading")).toEqual([{ line: 13, kind: "heading", level: 1, text: "公開API" }]);
  const terms = await termInventory(text);
  expect(terms.find(t => t.term === "API")?.first_line).toBe(13);
  expect(terms.some(t => /Hidden|Secret/.test(t.term))).toBe(false);
});

test("reading load is opt-in and cannot change lint findings or the diagnostic base", async () => {
  const text = "会社の部門の予算の上限を確認する。\n問題を招かないとは言えない。\n参加しなければならない。\n行かないし、来ない。\n確認しないと動かない。";
  const plain = await analyze(text);
  const result = await analyze(text, { readingLoad: true });
  expect(result.findings).toEqual(plain.findings);
  expect(result.score).toEqual(plain.score);
  expect(result.reading_load?.findings.filter(f => f.category === "no_chain").map(f => f.line)).toEqual([1]);
  expect(result.reading_load?.findings.filter(f => f.category === "double_negative").map(f => f.line)).toEqual([2]);
  expect(plain.reading_load).toBeUndefined();
});

test("baseline matches repeated occurrences one to one regardless of line shifts", () => {
  const f = (line: number, excerpt: string) => ({ line, category: "forbidden_phrase", excerpt, detail: "", severity: "warn" as const });
  const current = [f(40, "いかがでしょうか"), f(41, "新しい指摘")];
  const result = compareBaseline(current, { findings: [f(1, "いかがでしょうか"), f(2, "いかがでしょうか")] });
  expect(result?.summary).toEqual({ resolved: 1, new: 1, persisting: 1 });
  expect(current[0]).toHaveProperty("status", "persisting");
  expect(result?.resolved).toHaveLength(1);
  expect(() => compareBaseline(current, { findings: [null, { category: 2 }, f(2, "いかがでしょうか")] })).not.toThrow();
});

test("outline preserves order and terms expose first occurrence and gloss hints", async () => {
  const text = "# APIを統合する\nAPIとは接続の窓口です。二文目です。\n\n- 入力を確認\n- 保存する\n\n## キャッシュ\nキャッシュをTypeScriptで扱う。APIを呼ぶ。";
  const outline = await outlineDocument(text);
  expect(outline.outline.map(e => [e.line, e.kind, e.text])).toEqual([
    [1, "heading", "APIを統合する"], [2, "lead", "APIとは接続の窓口です。"],
    [4, "bullets", "(箇条書き 2 項目)"], [7, "heading", "キャッシュ"], [8, "lead", "キャッシュをTypeScriptで扱う。"],
  ]);
  const terms = await termInventory(text);
  expect(terms.find(t => t.term === "API")).toMatchObject({ first_line: 1, count: 3, has_gloss_hint: true });
  expect(terms.find(t => t.term === "キャッシュ")).toMatchObject({ first_line: 7, count: 2 });
  expect(terms.find(t => t.term === "TypeScript")).toMatchObject({ first_line: 8, count: 1 });
});

test("long repeated text activates rhythm and vocabulary while business suppresses structural warnings", async () => {
  const prose = "この機能は情報を管理することができます。".repeat(250);
  const result = await analyze(prose);
  expect(result.findings.map(f => f.category)).toEqual(expect.arrayContaining(["low_burstiness", "low_sentence_variance", "low_lexical_diversity_ttr", "repeated_sentence_lead"]));
  const structure = "# まとめ\n**要点**\n**状態**\n**結論**\n" + "- 対応する\n".repeat(10);
  const normal = await analyze(structure, { experimental: true });
  const business = await analyze(structure, { experimental: true, genre: "business" });
  expect(normal.findings.map(f => f.category)).toEqual(expect.arrayContaining(["high_bold_density", "high_bullet_ratio", "boilerplate_heading"]));
  expect(business.findings.some(f => /bold|bullet|heading|phase/.test(f.category))).toBe(false);
});

test("source examples keep ordinary prose quiet while detecting the deliberately repetitive draft", async () => {
  const natural = await analyze(await Bun.file(new URL("fixtures/natural.md", import.meta.url)).text(), { experimental: true });
  const repeated = await analyze(await Bun.file(new URL("fixtures/ai-smelly.md", import.meta.url)).text());
  expect(natural.findings).toEqual([]);
  expect(repeated.findings.map(f => f.category)).toEqual(expect.arrayContaining(["forbidden_phrase", "translationese", "antithesis_repetition", "low_specificity"]));
});

test("reading load preserves the distinction between long prose, URL length and a named organization", async () => {
  const text = "あ".repeat(95) + "。\n案内は[こちら](https://example.test/" + "a".repeat(200) + ")です。\n東京地方裁判所で確認します。";
  const common = await analyze(text, { readingLoad: true });
  const essay = await analyze(text, { readingLoad: true, genre: "essay" });
  expect(common.reading_load?.findings.filter(f => f.category === "sentence_too_long").map(f => f.line)).toEqual([1]);
  expect(essay.reading_load?.findings.filter(f => f.category === "sentence_too_long")).toEqual([]);
  expect(common.reading_load?.findings.filter(f => f.category === "kanji_run")).toEqual([]);
});

test("buried noun lists and compound predicates are found through morphology", async () => {
  const text = "運用担当者は、リクエストの再送機能、再送回数の上限管理機能、再送間隔のバックオフ制御機能、障害の記録と通知を用意します。\nこの事実は改善を示唆しています。";
  const result = await analyze(text, { readingLoad: true });
  expect(result.reading_load?.findings).toContainEqual(expect.objectContaining({ category: "buried_list", line: 1 }));
  expect(result.findings).toContainEqual(expect.objectContaining({ category: "inanimate_subject_morph", line: 2 }));
});

test("Unicode before a conjugated phrase does not shift the original excerpt", async () => {
  const result = await analyze("😀 **利用者**は歩くことができました。");
  expect(result.findings).toContainEqual(expect.objectContaining({ category: "translationese_morph", excerpt: expect.stringContaining("歩くことができ") }));
  expect(result.findings.every(f => !f.excerpt.includes("\uFFFD"))).toBe(true);
});

test("empty and structure-only documents are not given a misleading perfect score", async () => {
  for (const text of ["", "   \n", "# 方針\n" + "- 条件を確認する\n".repeat(40), "```md\n" + "説明".repeat(100) + "\n```", "<!--" + "説明".repeat(100) + "-->"]) {
    const result = await analyze(text);
    expect(result.score.base).toBeNull();
    expect(result.stats.total_sentences).toBe(0);
  }
});

test("aggregate baseline survives changed numbers and short excerpts use multiplicity", () => {
  const current = [{ line: 20, category: "low_burstiness", excerpt: "burstiness=-0.300", severity: "warn" as const, detail: "" }];
  const result = compareBaseline(current, { findings: [{ ...current[0], line: 1, excerpt: "burstiness=-0.400" }] });
  expect(result?.summary).toEqual({ resolved: 0, new: 0, persisting: 1 });
});
