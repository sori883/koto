import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkBundle,
  createEntry,
  entriesForPath,
  findRoot,
  hookOutput,
  INDEX_LIMIT,
  listEntries,
  matchCodeRef,
  parseEntry,
  renderIndex,
  scalar,
} from "../plugin/skills/knowledge/scripts/knowledge.ts";

const script = join(import.meta.dir, "../plugin/skills/knowledge/scripts/knowledge.ts");
const now = new Date("2026-11-26T01:00:00Z");
let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "knowledge-test-")));
  mkdirSync(join(root, ".space", "kb"), { recursive: true });
  mkdirSync(join(root, "src", "users"), { recursive: true });
  writeFileSync(join(root, "src", "users", "get-user.ts"), "");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const kb = (path: string) => join(root, ".space", "kb", path);
const read = (path: string) => readFileSync(kb(path), "utf8");

function nullConstraint(status: "draft" | "stable" = "stable") {
  return createEntry(root, "constraint", "get-user-returns-null", "取得APIは見つからないとき null を返す", {
    description: "既存の呼び出し側に合わせて null を返す。本当は結果型にしたい",
    tags: ["api", "users"],
    codeRefs: ["src/users/get-user.ts"],
    sources: [".space/tickets/user-fetch/ticket.md"],
    reviewWhen: "呼び出し側をまとめて移行するとき",
    status,
    by: status === "stable" ? "human:me" : "claude-code/opus",
    now,
  });
}

test("new writes an OKF entry with the type's headings and rebuilds the index", () => {
  const file = nullConstraint();
  expect(file).toBe(kb("constraints/get-user-returns-null.md"));
  expect(read("constraints/get-user-returns-null.md")).toBe(`---
type: Constraint
title: 取得APIは見つからないとき null を返す
description: 既存の呼び出し側に合わせて null を返す。本当は結果型にしたい
tags: [api, users]
status: stable
generated: { by: "human:me", at: 2026-11-26T01:00:00Z }
verified: [{ by: "human:me", at: 2026-11-26T01:00:00Z }]
sources:
  - { resource: .space/tickets/user-fetch/ticket.md }
code_refs: [src/users/get-user.ts]
review_when: 呼び出し側をまとめて移行するとき
---

# 取得APIは見つからないとき null を返す

## 制約

## 出所

## 守り方

## 本当はどうしたいか
`);
  expect(read("index.md")).toContain(
    "* [取得APIは見つからないとき null を返す](constraints/get-user-returns-null.md) - 既存の呼び出し側に合わせて null を返す。本当は結果型にしたい",
  );
});

test("the written frontmatter parses back", () => {
  nullConstraint();
  const entry = parseEntry(read("constraints/get-user-returns-null.md"), "constraints/get-user-returns-null.md");
  expect(entry.meta.generated).toEqual({ by: "human:me", at: "2026-11-26T01:00:00Z" });
  expect(entry.meta.verified).toEqual([{ by: "human:me", at: "2026-11-26T01:00:00Z" }]);
  expect(entry.meta.sources).toEqual([{ resource: ".space/tickets/user-fetch/ticket.md" }]);
  expect(entry.meta.code_refs).toEqual(["src/users/get-user.ts"]);
});

test("a draft has no verified record and is marked in the index", () => {
  nullConstraint("draft");
  expect(read("constraints/get-user-returns-null.md")).not.toContain("verified:");
  expect(read("index.md")).toContain("- （未確認）既存の呼び出し側");
});

test("new refuses bad input", () => {
  const base = { description: "d", now };
  expect(() => createEntry(root, "compromise", "a", "t", base)).toThrow("unknown type");
  expect(() => createEntry(root, "decision", "日本語", "t", base)).toThrow("invalid slug");
  expect(() => createEntry(root, "decision", "a", "t", { now, description: "" })).toThrow("--description is required");
  expect(() => createEntry(root, "decision", "a", "t", { ...base, codeRefs: ["../x"] })).toThrow("relative to the project root");
  expect(() => createEntry(root, "reference", "a", "t", { ...base, codeRefs: ["src"] })).toThrow("decision and constraint");
  createEntry(root, "decision", "a", "t", base);
  expect(() => createEntry(root, "decision", "a", "t", base)).toThrow("already exists");
});

test("new needs .space/kb/", () => {
  rmSync(join(root, ".space"), { recursive: true });
  expect(() => createEntry(root, "decision", "a", "t", { description: "d" })).toThrow("Run the setup skill first");
});

test("scalar quotes values plain YAML would misread", () => {
  expect(scalar("plain text")).toBe("plain text");
  expect(scalar("a: b")).toBe('"a: b"');
  expect(scalar("- item")).toBe('"- item"');
  expect(scalar("x #y")).toBe('"x #y"');
  expect(scalar("[x]")).toBe('"[x]"');
});

test("parseEntry reads block lists and quoted values written by hand", () => {
  const entry = parseEntry(
    `---\ntype: Decision\ntitle: 'It''s fine'\ntags:\n  - a\n  - "b, c"\ncode_refs:\n- src/**\n---\nbody\n`,
    "decisions/x.md",
  );
  expect(entry.meta.title).toBe("It's fine");
  expect(entry.meta.tags).toEqual(["a", "b, c"]);
  expect(entry.meta.code_refs).toEqual(["src/**"]);
  expect(entry.body).toBe("body\n");
  expect(() => parseEntry("type: Decision\n", "x.md")).toThrow("must start");
  expect(() => parseEntry("---\ntype: Decision\n", "x.md")).toThrow("no closing");
});

test("matchCodeRef handles files, folders and globs", () => {
  expect(matchCodeRef("src/users/get-user.ts", "src/users/get-user.ts")).toBe(true);
  expect(matchCodeRef("src/users", "src/users/get-user.ts")).toBe(true);
  expect(matchCodeRef("./src/users/", "src/users/get-user.ts")).toBe(true);
  expect(matchCodeRef("src/user", "src/users/get-user.ts")).toBe(false);
  expect(matchCodeRef("src/**/*.ts", "src/users/get-user.ts")).toBe(true);
  expect(matchCodeRef("src/*.ts", "src/users/get-user.ts")).toBe(false);
});

test("entriesForPath leaves out deprecated entries", () => {
  nullConstraint();
  createEntry(root, "decision", "old", "古い判断", { description: "d", codeRefs: ["src/users"], now });
  const old = kb("decisions/old.md");
  writeFileSync(old, readFileSync(old, "utf8").replace("status: draft", "status: deprecated"));
  expect(entriesForPath(root, "src/users/get-user.ts").map((e) => e.path)).toEqual(["constraints/get-user-returns-null.md"]);
  expect(entriesForPath(root, "src/other.ts")).toEqual([]);
  expect(() => entriesForPath(root, "/elsewhere/x.ts")).toThrow("outside the project root");
});

test("list filters by type, tag, status and text", () => {
  nullConstraint("draft");
  createEntry(root, "reference", "billing-guide", "決済の手引き", { description: "決済の仕様", resource: "https://example.com/billing", now });
  expect(listEntries(root, { type: "reference" }).map((e) => e.path)).toEqual(["documents/billing-guide.md"]);
  expect(listEntries(root, { tag: "users" }).map((e) => e.path)).toEqual(["constraints/get-user-returns-null.md"]);
  expect(listEntries(root, { status: "draft" })).toHaveLength(2);
  expect(listEntries(root, { query: "結果型" }).map((e) => e.path)).toEqual(["constraints/get-user-returns-null.md"]);
});

test("the index leaves out deprecated entries and lists every type", () => {
  const entries = [
    parseEntry("---\ntype: Decision\ntitle: A\ndescription: a\n---\n", "decisions/a.md"),
    parseEntry("---\ntype: Decision\ntitle: B\ndescription: b\nstatus: deprecated\n---\n", "decisions/b.md"),
  ];
  const index = renderIndex(entries);
  expect(index).toContain("# 判断（Decision）\n\n* [A](decisions/a.md) - a");
  expect(index).not.toContain("[B]");
  expect(index).toContain("# 制約（Constraint）\n\n（なし）");
  expect(index).toContain("# 参照（Reference）");
});

test("check reports broken entries, missing code, stale dates and an old index", () => {
  nullConstraint("draft");
  createEntry(root, "decision", "gone", "消えたコード", {
    description: "d",
    codeRefs: ["src/removed.ts"],
    now,
  });
  writeFileSync(kb("decisions/broken.md"), "no frontmatter");
  writeFileSync(kb("decisions/wrong-type.md"), "---\ntype: Constraint\ntitle: x\ndescription: y\n---\n[link](/documents/missing.md)\n");
  const contract = kb("constraints/contract.md");
  writeFileSync(contract, "---\ntype: Constraint\ntitle: c\ndescription: d\nstale_after: 2026-01-01T00:00:00Z\n---\n");
  const findings = checkBundle(root, now).map((f) => `${f.level} ${f.path} ${f.message}`);
  expect(findings).toContain("error decisions/broken.md frontmatter must start with a '---' line");
  expect(findings).toContain("error decisions/wrong-type.md type 'Constraint' does not belong in decisions/");
  expect(findings).toContain("warn decisions/wrong-type.md broken link: /documents/missing.md");
  expect(findings).toContain("warn decisions/gone.md code_refs points to nothing: src/removed.ts");
  expect(findings).toContain("warn constraints/contract.md stale since 2026-01-01T00:00:00Z");
  expect(findings).toContain("info constraints/get-user-returns-null.md draft: waiting for a person to confirm");
  expect(findings).toContain("info constraints/get-user-returns-null.md review when: 呼び出し側をまとめて移行するとき");
  expect(findings).toContain("warn index.md out of date. Run knowledge.ts index");
});

test("findRoot walks up to the folder that has .space/kb/", () => {
  expect(findRoot(join(root, "src", "users"))).toBe(root);
  expect(findRoot(tmpdir())).toBeNull();
});

test("session-start and subagent-start hooks add the index", () => {
  expect(hookOutput("session-start", { cwd: root })).toBeNull();
  nullConstraint("draft");
  const output = hookOutput("session-start", { cwd: join(root, "src") }) as any;
  expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
  expect(output.hookSpecificOutput.additionalContext).toContain("（未確認）既存の呼び出し側");
  expect((hookOutput("subagent-start", { cwd: root }) as any).hookSpecificOutput.hookEventName).toBe("SubagentStart");
});

test("a long index is summarized instead of added", () => {
  for (let i = 0; i <= INDEX_LIMIT; i++) {
    createEntry(root, "decision", `d-${i}`, `判断${i}`, { description: "d", now });
  }
  const context = (hookOutput("session-start", { cwd: root }) as any).hookSpecificOutput.additionalContext;
  expect(context).toContain(`${INDEX_LIMIT + 1}件`);
  expect(context).toContain(`判断 ${INDEX_LIMIT + 1}件`);
  expect(context).not.toContain("判断0](");
});

test("the pre-tool-use hook shows entries bound to the edited file", () => {
  nullConstraint();
  const output = hookOutput("pre-tool-use", { cwd: root, tool_input: { file_path: join(root, "src/users/get-user.ts") } }) as any;
  expect(output.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  expect(output.hookSpecificOutput.additionalContext).toContain("--- .space/kb/constraints/get-user-returns-null.md ---");
  expect(output.hookSpecificOutput.additionalContext).toContain("review_when: 呼び出し側をまとめて移行するとき");
  expect(hookOutput("pre-tool-use", { cwd: root, tool_input: { file_path: join(root, "src/other.ts") } })).toBeNull();
  expect(hookOutput("pre-tool-use", { cwd: root, tool_input: { file_path: kb("index.md") } })).toBeNull();
  expect(hookOutput("pre-tool-use", { cwd: root, tool_input: {} })).toBeNull();
});

test("the post-read hook shows entries bound to the file that was read", () => {
  nullConstraint();
  const output = hookOutput("post-read", { cwd: root, tool_input: { file_path: join(root, "src/users/get-user.ts") } }) as any;
  expect(output.hookSpecificOutput.hookEventName).toBe("PostToolUse");
  expect(output.hookSpecificOutput.additionalContext).toStartWith("読んだ src/users/get-user.ts には");
  expect(output.hookSpecificOutput.additionalContext).toContain("--- .space/kb/constraints/get-user-returns-null.md ---");
  expect(hookOutput("post-read", { cwd: root, tool_input: { file_path: join(root, "src/other.ts") } })).toBeNull();
});

test("the CLI runs a hook from stdin and prints nothing when there is nothing to add", () => {
  nullConstraint();
  const run = (input: string) =>
    Bun.spawnSync(["bun", script, "hook", "pre-tool-use"], { stdin: new TextEncoder().encode(input) });
  const hit = run(JSON.stringify({ cwd: root, tool_input: { file_path: "src/users/get-user.ts" } }));
  expect(hit.exitCode).toBe(0);
  expect(JSON.parse(hit.stdout.toString()).hookSpecificOutput.additionalContext).toContain("get-user-returns-null");
  const miss = run(JSON.stringify({ cwd: root, tool_input: { file_path: "src/other.ts" } }));
  expect(miss.exitCode).toBe(0);
  expect(miss.stdout.toString()).toBe("");
});

test("the CLI prints list rows and fails check on errors", () => {
  nullConstraint();
  const list = Bun.spawnSync(["bun", script, "list", root]);
  expect(list.stdout.toString()).toBe(
    ".space/kb/constraints/get-user-returns-null.md\tConstraint\tstable\t取得APIは見つからないとき null を返す\t既存の呼び出し側に合わせて null を返す。本当は結果型にしたい\n",
  );
  writeFileSync(kb("decisions.md"), "");
  mkdirSync(kb("decisions"));
  writeFileSync(kb("decisions/bad.md"), "x");
  expect(Bun.spawnSync(["bun", script, "check", root]).exitCode).toBe(1);
  expect(Bun.spawnSync(["bun", script, "new", root, "decision"]).exitCode).toBe(2);
});
