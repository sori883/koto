import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const checkout = resolve(import.meta.dir, "../.."), cli = join(checkout, "cli/monorepo/monorepo.ts");
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
let temp: string, root: string, target: string;
beforeEach(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "koto-instructions-")));
  root = join(temp, "management root"); target = join(temp, "existing repo");
  await mkdir(target); await run(["setup"]);
});
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });

async function run(args: string[], code = 0) {
  const child = Bun.spawn([process.execPath, cli, ...args, ...(args.includes("--input-json") ? [] : ["--root", root]), "--json"], { cwd: temp, stdout: "pipe", stderr: "pipe" });
  const [actual, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code: actual, err }, out).toEqual({ code, err: "" });
  return JSON.parse(out);
}
const args = (mode: string, product = "codex", extra: string[] = []) => ["instructions", mode, "--target", target, "--product", product, ...extra];
const statePath = (product = "codex") => join(root, ".space/default/instructions", hash(target), product + ".json");
async function snapshot(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) { result[name + "/"] = "directory"; await visit(join(path, entry.name), name + "/"); }
      else if (entry.isSymbolicLink()) result[name] = "symlink:" + await readlink(join(path, entry.name));
      else result[name] = hash(await readFile(join(path, entry.name)));
    }
  }
  await visit(directory, ""); return result;
}

test("instruction plans are read-only; both products preserve local text and apply idempotently", async () => {
  for (const [product, file] of [["codex", "AGENTS.md"], ["claude-code", "CLAUDE.md"]]) {
    const path = join(target, file!); await writeFile(path, "# Local instructions\r\nKeep my rules.\r\n"); await chmod(path, 0o640);
    const before = await snapshot(temp), plan = (await run(args("plan", product))).data;
    expect(plan.canApply).toBe(true); expect(plan.action).toBe("create");
    expect(await snapshot(temp)).toEqual(before);
    const applied = (await run(args("apply", product))).data;
    expect(applied.current).toBe(true);
    const contents = await readFile(path, "utf8");
    expect(contents.startsWith("# Local instructions\r\nKeep my rules.\r\n")).toBe(true);
    expect(contents).toContain(root); expect(contents).toContain("project");
    expect(contents).not.toMatch(/(?<!\r)\n/);
    expect((await stat(path)).mode & 0o777).toBe(0o640);
    expect((await run(args("apply", product))).data.action).toBe("unchanged");
    expect(await readFile(path, "utf8")).toBe(contents);
    expect((await run(args("status", product))).data.current).toBe(true);
    expect(JSON.parse(await readFile(statePath(product), "utf8")).target).toBe(target);
  }
  expect(await Bun.file(join(target, ".space")).exists()).toBe(false);
});

test("source updates preserve edits outside the block and reject edits or deletion inside it", async () => {
  await run(args("apply")); const path = join(target, "AGENTS.md");
  const initial = await readFile(path, "utf8"), source = join(temp, "new distribution");
  await cp(join(checkout, "skills"), join(source, "skills"), { recursive: true });
  await cp(join(checkout, "cli"), join(source, "cli"), { recursive: true });
  await cp(join(checkout, "templates"), join(source, "templates"), { recursive: true });
  await writeFile(path, "Keep before.\n" + initial + "Keep after.\n");
  const extra = ["--source", source];
  expect((await run(args("plan", "codex", extra))).data.action).toBe("update");
  await run(args("apply", "codex", extra));
  const updated = await readFile(path, "utf8");
  expect(updated.startsWith("Keep before.\n")).toBe(true); expect(updated.endsWith("Keep after.\n")).toBe(true);
  expect(updated).toContain("new%20distribution/skills/devlow/SKILL.md");
  const edited = updated.replace("# koto", "# My koto"); await writeFile(path, edited);
  expect((await run(args("apply", "codex", extra), 1)).data.conflicts.length).toBeGreaterThan(0);
  expect(await readFile(path, "utf8")).toBe(edited);
  await rm(path);
  expect((await run(args("apply", "codex", extra), 1)).data.canApply).toBe(false);
  expect(await Bun.file(path).exists()).toBe(false);
});

test("a matching legacy setup notice migrates while its record and local instructions survive", async () => {
  const old = "<!-- koto:setup:koto:codex:start -->\nOld devlow instructions.\n<!-- koto:setup:koto:codex:end -->";
  const record = { schemaVersion: 1, plugin: "koto", product: "codex", version: "0.1.8", entries: [{ source: "templates/AGENTS.md", destination: "AGENTS.md", mode: "managed-block", hash: hash(old) }] };
  const legacy = join(target, ".space/setup/koto-codex.json");
  await mkdir(join(target, ".space/setup"), { recursive: true }); await writeFile(legacy, JSON.stringify(record));
  await writeFile(join(target, "AGENTS.md"), "Local before\n" + old + "\nLocal after\n");
  expect((await run(args("plan"))).data.action).toBe("update");
  await run(args("apply"));
  expect(await readFile(legacy, "utf8")).toBe(JSON.stringify(record));
  const after = await readFile(join(target, "AGENTS.md"), "utf8");
  expect(after.startsWith("Local before\n")).toBe(true); expect(after.endsWith("\nLocal after\n")).toBe(true);
  expect(after).not.toContain("Old devlow instructions.");
});

test("managed marker damage, invalid text and untracked notices are preserved", async () => {
  const file = join(target, "AGENTS.md"), start = "<!-- koto:setup:koto:codex:start -->", end = "<!-- koto:setup:koto:codex:end -->";
  for (const contents of [start, end + start, start + "\nx\n" + end + start + end, start + "\nuntracked\n" + end]) {
    await writeFile(file, contents); const before = await snapshot(temp);
    expect((await run(args("plan"), 1)).data.canApply).toBe(false);
    expect((await run(args("apply"), 1)).data.canApply).toBe(false);
    expect(await snapshot(temp)).toEqual(before);
  }
  const invalid = Buffer.from([0xff, 0xfe]); await writeFile(file, invalid);
  expect((await run(args("apply"), 1)).error.code).toBe("CONFLICT");
  expect(await readFile(file)).toEqual(invalid);
});

test("explicit context, project boundaries, file symlinks and lock ownership are enforced", async () => {
  expect((await run(["instructions", "apply"], 2)).error.code).toBe("INVALID_INPUT");
  expect((await run(args("apply", "copilot"), 2)).error.code).toBe("INVALID_INPUT");
  expect((await run(args("apply", "codex", ["--project", "missing"]), 1)).error.code).toBe("PROJECT_NOT_FOUND");
  expect((await run(["instructions", "apply", "--target", join(temp, "missing"), "--product", "codex"], 1)).error.code).toBe("INVALID_PATH");
  await run(["project", "add", "other"]);
  for (const path of [join(root, "workspaces/other"), join(root, "repositories/default"), join(root, ".space/default"), join(root, "workspaces")]) {
    expect((await run(["instructions", "apply", "--target", path, "--product", "codex"], 1)).error.code).toBe("UNSAFE_PATH");
  }
  const alias = join(temp, "alias"); await symlink(root, alias);
  expect((await run(["instructions", "apply", "--target", join(alias, "workspaces/other"), "--product", "codex"], 1)).error.code).toBe("UNSAFE_PATH");
  const outside = join(temp, "outside.md"); await writeFile(outside, "keep"); await symlink(outside, join(target, "AGENTS.md"));
  expect((await run(args("apply"), 1)).error.code).toBe("UNSAFE_PATH"); expect(await readFile(outside, "utf8")).toBe("keep");
  await rm(join(target, "AGENTS.md"));
  for (const path of [join(root, ".space/monorepo.lock"), join(target, ".koto-instructions.lock")]) {
    await writeFile(path, "someone else");
    expect((await run(args("status"), 1)).data.canApply).toBe(false);
    expect((await run(args("apply"), 1)).error.code).toBe("LOCKED");
    expect(await readFile(path, "utf8")).toBe("someone else"); await rm(path);
  }
  expect(await Bun.file(join(target, "AGENTS.md")).exists()).toBe(false);
  await run(args("apply")); const original = await snapshot(temp);
  expect((await run(args("apply", "codex", ["--project", "other"]), 1)).data.canApply).toBe(false);
  expect(await snapshot(temp)).toEqual(original);
});

test("legacy edits, unfinished updates and setup locks cannot be bypassed", async () => {
  const old = "<!-- koto:setup:koto:codex:start -->\nOld\n<!-- koto:setup:koto:codex:end -->";
  const setup = join(target, ".space/setup"); await mkdir(setup, { recursive: true });
  await writeFile(join(setup, "koto-codex.json"), JSON.stringify({ schemaVersion: 1, plugin: "koto", product: "codex", entries: [{ destination: "AGENTS.md", mode: "managed-block", hash: hash(old) }] }));
  await writeFile(join(target, "AGENTS.md"), old.replace("Old", "Local edit"));
  expect((await run(args("apply"), 1)).data.canApply).toBe(false);
  await writeFile(join(target, "AGENTS.md"), old);
  await writeFile(join(setup, "koto-claude-code.pending.json"), "pending");
  expect((await run(args("apply"), 1)).data.canApply).toBe(false);
  await rm(join(setup, "koto-claude-code.pending.json"));
  await writeFile(join(setup, "koto.lock"), "busy");
  expect((await run(args("apply"), 1)).error.code).toBe("LOCKED");
  expect(await readFile(join(target, "AGENTS.md"), "utf8")).toBe(old);
  expect(await readFile(join(setup, "koto.lock"), "utf8")).toBe("busy");
});

async function failStateWrite(destination = statePath()) {
  const script = `import { mock } from 'bun:test';
    const fs = await import('node:fs/promises'); const originalRename = fs.rename;
    mock.module('node:fs/promises', () => ({ ...fs, rename: async (from, to) => {
      if (String(to) === ${JSON.stringify(destination)}) throw new Error('injected rename failure');
      return originalRename(from, to);
    }}));
    const { main } = await import(${JSON.stringify(join(checkout, "cli/monorepo/lib/cli.ts"))});
    process.exitCode = await main(${JSON.stringify([...args("apply"), "--root", root, "--json"])});`;
  const child = Bun.spawn([process.execPath, "--eval", script], { cwd: temp, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, err }, out).toEqual({ code: 1, err: "" });
  expect(JSON.parse(out).error.code).toBe("PARTIAL_FAILURE");
}

test("a failed management write resumes from the saved plan without duplicating instructions", async () => {
  await writeFile(join(target, "AGENTS.md"), "Keep this.\n");
  await failStateWrite();
  const partial = await readFile(join(target, "AGENTS.md"), "utf8"), pendingPath = statePath().replace(/\.json$/, ".pending.json");
  expect(await Bun.file(pendingPath).exists()).toBe(true);
  expect(await Bun.file(statePath()).exists()).toBe(false);
  const before = await snapshot(temp), status = (await run(args("status"))).data;
  expect(status.pending).toBe(true); expect(status.action).toBe("resume"); expect(status.current).toBe(false);
  expect(await snapshot(temp)).toEqual(before);
  expect((await run(args("apply"))).data.current).toBe(true);
  expect(await readFile(join(target, "AGENTS.md"), "utf8")).toBe(partial);
  expect(await Bun.file(pendingPath).exists()).toBe(false);
  expect((await run(args("status"))).data.current).toBe(true);
});

test("edits made after interrupted apply are protected, including text outside the block", async () => {
  await failStateWrite(); const file = join(target, "AGENTS.md");
  const content = await readFile(file, "utf8"); await writeFile(file, content + "More local instructions.\n");
  const before = await snapshot(temp);
  expect((await run(args("apply"), 1)).data.canApply).toBe(false);
  expect(await snapshot(temp)).toEqual(before);
});

test("an exact incoming block may be adopted and then updated from a new source", async () => {
  const plan = (await run(args("plan"))).data;
  await writeFile(join(target, "AGENTS.md"), "Keep\n" + plan.block + "\n");
  expect((await run(args("apply"))).data.action).toBe("adopt");
  expect(JSON.parse(await readFile(statePath(), "utf8")).blockHash).toBe(hash(plan.block));
  const source = join(temp, "next source");
  for (const name of ["cli", "skills", "templates"]) await cp(join(checkout, name), join(source, name), { recursive: true });
  const next = (await run(args("plan", "codex", ["--source", source]))).data;
  await writeFile(join(target, "AGENTS.md"), "Keep\n" + next.block + "\n");
  expect((await run(args("apply", "codex", ["--source", source]))).data.action).toBe("adopt");
  expect(JSON.parse(await readFile(statePath(), "utf8")).blockHash).toBe(hash(next.block));
});

test("a failed instruction replacement leaves the original file and can resume", async () => {
  const file = join(target, "AGENTS.md"); await writeFile(file, "Original instructions.\n");
  await failStateWrite(file);
  expect(await readFile(file, "utf8")).toBe("Original instructions.\n");
  expect((await run(args("status"))).data.pending).toBe(true);
  expect((await run(args("apply"))).data.current).toBe(true);
  expect((await readFile(file, "utf8")).startsWith("Original instructions.\n")).toBe(true);
});

test("JSON requests bind a selected project and source problems cannot write instructions", async () => {
  await run(["project", "add", "client"]);
  const request = { command: ["instructions", "apply"], root, project: "client", target: join(root, "workspaces/client"), product: "claude-code" };
  const result = (await run(["--input-json", JSON.stringify(request)])).data;
  expect(result.current).toBe(true); expect(result.project).toBe("client");
  const file = join(request.target, "CLAUDE.md"); expect(await readFile(file, "utf8")).toContain('"project": "client"');
  expect((await run(["--input-json", JSON.stringify({ ...request, target: root })], 1)).error.code).toBe("UNSAFE_PATH");
  expect((await run(["--input-json", JSON.stringify({ ...request, project: "default", target: root, product: "codex" })])).data.current).toBe(true);
  expect(await Bun.file(join(root, "AGENTS.md")).exists()).toBe(true);
  const source = join(temp, "incomplete source"); await mkdir(source);
  expect((await run(args("apply", "codex", ["--source", source]), 1)).error.code).toBe("MISSING_SOURCE");
  expect(await Bun.file(join(target, "AGENTS.md")).exists()).toBe(false);
  expect((await run(args("apply", "codex", ["--source", "relative"]), 2)).error.code).toBe("INVALID_INPUT");
});

test("unknown or inconsistent management records are refused without replacing files", async () => {
  await run(args("apply"));
  const record = JSON.parse(await readFile(statePath(), "utf8"));
  for (const change of [{ schemaVersion: 99 }, { projectId: "other" }, { target: temp }, { blockHash: "invalid" }]) {
    await writeFile(statePath(), JSON.stringify({ ...record, ...change })); const before = await snapshot(temp);
    expect((await run(args("apply"), 1)).error.code).toBe("INVALID_STATE");
    expect(await snapshot(temp)).toEqual(before);
  }
  await writeFile(statePath(), JSON.stringify(record));
  const pendingPath = statePath().replace(/\.json$/, ".pending.json");
  await writeFile(pendingPath, JSON.stringify({ schemaVersion: 1, beforeHash: null, beforeStateHash: null, content: "Unexpected", mode: 0o644, state: record }));
  const before = await snapshot(temp);
  expect((await run(args("apply"), 1)).error.code).toBe("INVALID_STATE");
  expect(await snapshot(temp)).toEqual(before);
});
