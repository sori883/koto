import { expect, test } from "bun:test";
import { buildGraph, linkedPaths, links, resolveReference, unlinkTarget, unsupportedLinks } from "../../cli/memory/lib/references.ts";
import type { Concept } from "../../cli/memory/lib/frontmatter.ts";

test("all reference consumers ignore code, comments, images, escaped syntax and external URLs", () => {
  const body = "[real](b.md)\r\n```md\r\n[code](b.md)\r\n```\r\n    [indented](b.md)\r\n`[inline](b.md)`\r\n<!-- [comment](b.md) -->\r\n![image](b.md)\r\n\\[escaped](b.md)\r\n[external](https://example.com/b.md)\r\n";
  expect(links(body).map(link => link.label)).toEqual(["real"]);
  expect(unlinkTarget(body, "knowledge/a.md", "knowledge/b.md", "concept")).toBe(body.replace("[real](b.md)", "real"));
});

test("URL fragments are removed before decoding encoded filename characters", () => {
  const text = "[encoded](a%20b%28c%29%23x%3Fy.md#heading)";
  expect(linkedPaths(text, "knowledge/from.md")).toEqual(["knowledge/a b(c)#x?y.md"]);
  expect(unlinkTarget(text, "knowledge/from.md", "knowledge/a b(c)#x?y.md", "concept")).toBe("encoded");
  expect(resolveReference("knowledge/a.md", "../rules/r.md?view=1#h")).toEqual({ path: "rules/r.md" });
  expect(resolveReference("knowledge/a.md", "../../outside.md")).toHaveProperty("error");
  expect(resolveReference("knowledge/a.md", "%xx.md")).toHaveProperty("error");
});

test("multiple links on one line are replaced by spans while unrelated bytes and CRLF are preserved", () => {
  const text = "One [B](b.md), two [B](b.md#details), keep [C](c.md).\r\n";
  expect(unlinkTarget(text, "knowledge/a.md", "knowledge/b.md", "concept")).toBe("One B, two B, keep [C](c.md).\r\n");
});

test("managed single-link navigation rows are removed without eating hand-written bullet prose", () => {
  const text = "* [B](b.md) - description\n* [B](b.md) is used in this explanation.\n* Read [B](b.md) first.\n";
  expect(unlinkTarget(text, "knowledge/index.md", "knowledge/b.md", "index")).toBe("* B is used in this explanation.\n* Read B first.\n");
});

test("unsupported local references are detected outside code and block only the selected target", () => {
  const text = '[b]: b.md\n<a href="c.md">C</a>\n`[x]: x.md`\n';
  expect(unsupportedLinks(text)).toEqual(["b.md", "c.md"]);
  expect(() => unlinkTarget(text, "knowledge/a.md", "knowledge/b.md", "concept")).toThrow("reference-style or HTML");
  expect(unlinkTarget(text, "knowledge/a.md", "knowledge/d.md", "concept")).toBe(text);
});

test("graph deduplicates edges and ignores self-links and navigation for isolation", () => {
  const make = (id: string, body: string): Concept => ({ id, path: `${id}.md`, body, metadata: {}, raw_content: "" });
  const concepts = new Map([make("knowledge/a", "[B](b.md) [B](b.md#h) [self](a.md)"), make("knowledge/b", ""), make("knowledge/c", "")].map(c => [c.id, c]));
  const graph = buildGraph(concepts, new Map([["knowledge/index.md", "* [C](c.md) - C\n"]]));
  expect(graph.outbound.get("knowledge/a")).toEqual(["knowledge/b"]);
  expect(graph.inbound.get("knowledge/b")).toEqual(["knowledge/a"]);
  expect(graph.orphans).toEqual(["knowledge/c"]);
});
