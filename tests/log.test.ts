import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRow, clean } from "../plugin/skills/show-me-your-work/scripts/log.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "log-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const now = new Date("2026-05-24T09:02:00.500Z");

test("writes the header once, then appends rows", () => {
  const file = join(dir, "nested", "decisions.tsv");
  appendRow(file, ["frame", "数えた", "大きさを知る", "commit 3a9f1c2", "open"], now);
  appendRow(file, ["widget", "移した", "小さく保つ", "pixel-diff 0", "tests green"], now);
  expect(readFileSync(file, "utf8")).toBe(
    "ts\tphase\tdecision\twhy\tevidence\tresult\n" +
      "2026-05-24T09:02:00Z\tframe\t数えた\t大きさを知る\tcommit 3a9f1c2\topen\n" +
      "2026-05-24T09:02:00Z\twidget\t移した\t小さく保つ\tpixel-diff 0\ttests green\n",
  );
});

test("never truncates an existing log", () => {
  const file = join(dir, "decisions.tsv");
  writeFileSync(file, "ts\tphase\tdecision\twhy\tevidence\tresult\nold\trow\n");
  appendRow(file, ["p", "d", "w", "e", "r"], now);
  expect(readFileSync(file, "utf8")).toStartWith("ts\tphase\tdecision\twhy\tevidence\tresult\nold\trow\n2026");
});

test("keeps cells on one line and defuses spreadsheet formulas", () => {
  expect(clean("a\tb\nc\rd")).toBe("a b c d");
  for (const lead of ["=", "+", "-", "@"]) expect(clean(`${lead}SUM(A1)`)).toBe(`'${lead}SUM(A1)`);
  expect(clean("plain")).toBe("plain");
});

test("cli exits 1 without six arguments", () => {
  const script = join(import.meta.dir, "../plugin/skills/show-me-your-work/scripts/log.ts");
  const result = Bun.spawnSync(["bun", script, join(dir, "x.tsv")], { stderr: "pipe" });
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("Usage:");
});
