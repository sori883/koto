import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup } from "../plugin/skills/setup/scripts/setup.ts";

const script = join(import.meta.dir, "../plugin/skills/setup/scripts/setup.ts");
let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "setup-test-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const results = (outcomes: { result: string; path: string }[]) =>
  outcomes.map(({ result, path }) => `${result} ${path.slice(root.length + 1)}`);

test("creates tickets/ and kb/ with .gitkeep, then keeps them", () => {
  expect(results(setup(root))).toEqual([
    "created .space",
    "created .space/tickets",
    "created .space/tickets/.gitkeep",
    "created .space/kb",
    "created .space/kb/.gitkeep",
  ]);
  expect(results(setup(root))).toEqual([
    "kept .space",
    "kept .space/tickets",
    "kept .space/tickets/.gitkeep",
    "kept .space/kb",
    "kept .space/kb/.gitkeep",
  ]);
});

test("adds kb/ to an existing .space/ without touching tickets", () => {
  mkdirSync(join(root, ".space", "tickets"), { recursive: true });
  writeFileSync(join(root, ".space", "tickets", ".gitkeep"), "");
  expect(results(setup(root))).toEqual([
    "kept .space",
    "kept .space/tickets",
    "kept .space/tickets/.gitkeep",
    "created .space/kb",
    "created .space/kb/.gitkeep",
  ]);
});

test("refuses a file where kb/ should be and changes nothing", () => {
  mkdirSync(join(root, ".space"));
  writeFileSync(join(root, ".space", "kb"), "");
  expect(() => setup(root)).toThrow("not a plain directory");
  expect(existsSync(join(root, ".space", "tickets"))).toBe(false);
});

test("keeps existing tickets", () => {
  mkdirSync(join(root, ".space", "tickets", "a"), { recursive: true });
  writeFileSync(join(root, ".space", "tickets", "a", "ticket.md"), "x");
  expect(results(setup(root)).slice(0, 3)).toEqual(["kept .space", "kept .space/tickets", "created .space/tickets/.gitkeep"]);
  expect(existsSync(join(root, ".space", "tickets", "a", "ticket.md"))).toBe(true);
});

test("refuses a symlinked .space and changes nothing", () => {
  const elsewhere = mkdtempSync(join(tmpdir(), "setup-elsewhere-"));
  symlinkSync(elsewhere, join(root, ".space"));
  expect(() => setup(root)).toThrow("not a plain directory");
  expect(existsSync(join(elsewhere, "tickets"))).toBe(false);
  rmSync(elsewhere, { recursive: true, force: true });
});

test("refuses a file where tickets/ should be", () => {
  mkdirSync(join(root, ".space"));
  writeFileSync(join(root, ".space", "tickets"), "");
  expect(() => setup(root)).toThrow("not a plain directory");
});

test("accepts a project root reached through a symlink", () => {
  const link = `${root}-link`;
  symlinkSync(root, link);
  try {
    expect(setup(link).map((o) => o.result)).toEqual(["created", "created", "created", "created", "created"]);
    expect(existsSync(join(root, ".space", "tickets", ".gitkeep"))).toBe(true);
  } finally {
    rmSync(link);
  }
});

test("cli exits 1 on usage errors and 2 on a missing root", () => {
  const run = (...args: string[]) => Bun.spawnSync(["bun", script, ...args], { stdout: "pipe", stderr: "pipe" });
  expect(run().exitCode).toBe(1);
  const missing = run(join(root, "nope"));
  expect(missing.exitCode).toBe(2);
  expect(missing.stderr.toString()).toContain("not a directory");
  const ok = run(root);
  expect(ok.exitCode).toBe(0);
  expect(ok.stdout.toString()).toBe(`created\t${root}/.space\ncreated\t${root}/.space/tickets\ncreated\t${root}/.space/tickets/.gitkeep\ncreated\t${root}/.space/kb\ncreated\t${root}/.space/kb/.gitkeep\n`);
});
