import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const cli = resolve(import.meta.dir, "../../cli/monorepo/monorepo.ts");
let temp: string, root: string;
const env = () => ({ ...process.env, GIT_CONFIG_GLOBAL: join(temp, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid", GIT_TERMINAL_PROMPT: "0" });
beforeEach(async () => { temp = await realpath(await mkdtemp(join(tmpdir(), "koto-monorepo-"))); root = join(temp, "workspace root"); await writeFile(join(temp, "gitconfig"), ""); });
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });

async function run(args: string[], expected = 0, options: { root?: string; env?: Record<string, string | undefined> } = {}) {
  const selectedRoot = args.includes("--input-json") ? [] : ["--root", options.root ?? root];
  const child = Bun.spawn([process.execPath, cli, ...args, ...selectedRoot, "--json"], { cwd: temp, env: { ...env(), ...options.env }, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, err, failure: code === expected ? "" : out }).toEqual({ code: expected, err: "", failure: "" });
  return JSON.parse(out);
}
async function git(...args: string[]) {
  const child = Bun.spawn(["git", ...args], { cwd: temp, env: env(), stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, error: code ? err : "" }).toEqual({ code: 0, error: "" });
  return out.trim();
}
async function remote(name: string) {
  const path = join(temp, name); await git("init", "-q", "-b", "main", path);
  await writeFile(join(path, "README.md"), `# ${name}\n`);
  await git("-C", path, "add", "README.md"); await git("-C", path, "commit", "-qm", "initial");
  return path;
}
async function register(id: string, source: string, project?: string) {
  return run(["repo", "add", id, "--url", source, ...(project ? ["--project", project] : [])]);
}

test("setup and project creation are idempotent and explicit project errors do not fall back", async () => {
  await mkdir(join(root, ".space/default/memory"), { recursive: true });
  await writeFile(join(root, ".space/default/memory/personal.md"), "keep");
  expect((await run(["setup"])).data.changed).toBe(true);
  const config = await readFile(join(root, ".space/monorepo.json"), "utf8");
  expect((await run(["setup"])).data.changed).toBe(false);
  expect(await readFile(join(root, ".space/monorepo.json"), "utf8")).toBe(config);
  await run(["project", "add", "project-x"]);
  expect((await run(["project", "add", "project-x"])).data.changed).toBe(false);
  expect((await run(["project", "list"])).data.projects.map((p: { id: string }) => p.id)).toEqual(["default", "project-x"]);
  expect((await run(["project", "show", "--project", "project-x"])).data.id).toBe("project-x");
  expect((await run(["repo", "list", "--project", "missing"], 1)).error.code).toBe("PROJECT_NOT_FOUND");
  expect(await readFile(join(root, ".space/default/memory/personal.md"), "utf8")).toBe("keep");
  expect(await Bun.file(join(root, ".git")).exists()).toBe(false);
});

test("real Git supports multiple repositories and tasks, status changes, fetch isolation and reuse", async () => {
  await run(["setup"]); const api = await remote("api source"), web = await remote("web source");
  await register("api", api); await register("web", web);
  expect((await register("api", api)).data.changed).toBe(false);
  const args = ["workspace", "create", "task-1", "--repo", "api", "--repo", "web"];
  const created = (await run(args)).data;
  expect(created.ready).toBe(true); expect(created.repositories).toHaveLength(2);
  await run(["workspace", "create", "task-2", "--repo", "api"]);
  const first = join(root, "workspaces/default/task-1/api"), second = join(root, "workspaces/default/task-2/api");
  const initial = await git("-C", first, "rev-parse", "HEAD");
  await writeFile(join(first, "README.md"), "changed\n");
  await writeFile(join(first, "new\nfile.txt"), "untracked");
  const status = (await run(["workspace", "show", "task-1"])).data;
  expect(status.repositories[0].dirty).toBe(true);
  expect(status.repositories[0].changes).toContainEqual({ status: "??", path: "new\nfile.txt" });
  expect(await readFile(join(second, "README.md"), "utf8")).toBe("# api source\n");
  await run(args);
  expect(await readFile(join(first, "README.md"), "utf8")).toBe("changed\n");
  await writeFile(join(api, "README.md"), "remote update\n"); await git("-C", api, "add", "."); await git("-C", api, "commit", "-qm", "remote update");
  await run(["repo", "sync", "api"]);
  expect(await git("-C", first, "rev-parse", "HEAD")).toBe(initial);
  expect((await run(["workspace", "show", "task-1"])).data.repositories[0].baseDistance).toEqual({ behind: 1, ahead: 0 });
  const third = (await run(["workspace", "create", "task-3", "--repo", "api"])).data;
  expect(third.repositories[0].head).not.toBe(initial);
  expect((await run(["workspace", "create", "task-1", "--repo", "api"], 1)).error.code).toBe("CONFLICT");
  expect((await run(["doctor"])).data.healthy).toBe(true);
}, 30_000);

test("projects register the same source independently without sharing Git storage", async () => {
  await run(["setup"]); await run(["project", "add", "client"]);
  const source = await remote("source"); await register("api", source); await register("api", source, "client");
  await run(["workspace", "create", "job", "--repo", "api"]);
  await run(["workspace", "create", "job", "--repo", "api", "--project", "client"]);
  const a = await git("-C", join(root, "workspaces/default/job/api"), "rev-parse", "--path-format=absolute", "--git-common-dir");
  const b = await git("-C", join(root, "workspaces/client/job/api"), "rev-parse", "--path-format=absolute", "--git-common-dir");
  expect(a).toBe(join(root, "repositories/default/api.git")); expect(b).toBe(join(root, "repositories/client/api.git"));
  expect((await run(["repo", "list", "--project", "client"])).data.repositories).toHaveLength(1);
});

test("partial multi-repository creation retains completed work and safely retries", async () => {
  await run(["setup"]); const source = await remote("source"); await register("a", source); await register("b", source);
  const lock = join(root, "repositories/default/b.git/refs/heads/koto/job.lock");
  await mkdir(join(lock, ".."), { recursive: true }); await writeFile(lock, "busy");
  const args = ["workspace", "create", "job", "--repo", "a", "--repo", "b"];
  const failed = await run(args, 1);
  expect(failed.error.code).toBe("PARTIAL_FAILURE");
  expect(failed.error.details.repositories.map((r: { phase: string }) => r.phase)).toEqual(["ready", "pending"]);
  const work = join(root, "workspaces/default/job/a/README.md"); await writeFile(work, "work survives retry");
  expect((await run(["doctor"], 1)).data.healthy).toBe(false);
  await rm(lock); expect((await run(args)).data.ready).toBe(true);
  expect(await readFile(work, "utf8")).toBe("work survives retry");
  expect((await run(["workspace", "list"])).data.workspaces).toHaveLength(1);
});

test("failed repository acquisition can resume with the same input", async () => {
  await run(["setup"]); const source = join(temp, "later");
  expect((await run(["repo", "add", "api", "--url", source], 1)).error.code).toBe("GIT_FAILED");
  expect((await run(["repo", "show", "api"])).data.phase).toBe("pending");
  await remote("later"); expect((await register("api", source)).data.phase).toBe("ready");
  const other = await remote("other");
  expect((await run(["repo", "add", "api", "--url", other], 1)).error.code).toBe("CONFLICT");
});

test("unregistering preserves Git data, allows re-registration and blocks used repositories", async () => {
  await run(["setup"]); const source = await remote("source"); await register("api", source);
  const bare = join(root, "repositories/default/api.git");
  const before = await git(`--git-dir=${bare}`, "rev-parse", "refs/remotes/origin/main");
  const result = (await run(["repo", "remove", "api"])).data;
  expect(result.dataDeleted).toBe(false); expect(result.retainedPath).toBe(bare);
  expect((await run(["repo", "list"])).data.repositories).toEqual([]);
  expect(await git(`--git-dir=${bare}`, "rev-parse", "refs/remotes/origin/main")).toBe(before);
  expect((await run(["repo", "remove", "api"])).data.changed).toBe(false);
  const other = await remote("other");
  expect((await run(["repo", "add", "api", "--url", other], 1)).error.code).toBe("CONFLICT");
  expect((await run(["repo", "list"])).data.repositories).toEqual([]);
  await register("api", source); await run(["workspace", "create", "task", "--repo", "api"]);
  expect((await run(["repo", "remove", "api"], 1)).error.code).toBe("IN_USE");
  expect((await run(["repo", "show", "api"])).data.phase).toBe("ready");
});

test("rejects traversal, managed symlinks, foreign destinations, bad options and embedded credentials", async () => {
  await run(["setup"]); const source = await remote("source");
  expect((await run(["project", "add", "../outside"], 1)).error.code).toBe("INVALID_ID");
  expect((await run(["repo", "add", "api", "--url", "https://secret:token@example.invalid/repo"], 1)).error.code).toBe("INVALID_URL");
  expect((await run(["repo", "list", "--url", source], 2)).error.code).toBe("INVALID_INPUT");
  await mkdir(join(root, "repositories/default/foreign.git")); await writeFile(join(root, "repositories/default/foreign.git/keep"), "keep");
  expect((await run(["repo", "add", "foreign", "--url", source], 1)).error.code).toBe("CONFLICT");
  expect(await readFile(join(root, "repositories/default/foreign.git/keep"), "utf8")).toBe("keep");
  await symlink(source, join(root, "repositories/default/link.git"));
  expect((await run(["repo", "add", "link", "--url", source], 1)).error.code).toBe("UNSAFE_PATH");
  await register("api", source);
  await symlink(source, join(root, "workspaces/default/escape"));
  expect((await run(["workspace", "create", "escape", "--repo", "api"], 1)).error.code).toBe("UNSAFE_PATH");
  const otherRoot = join(temp, "other-root"); await mkdir(otherRoot); await symlink(join(root, ".space"), join(otherRoot, ".space"));
  expect((await run(["setup"], 1, { root: otherRoot })).error.code).toBe("UNSAFE_PATH");
});

test("a lock prevents writes and management data with unknown schema is rejected", async () => {
  await run(["setup"]);
  const config = join(root, ".space/monorepo.json"), before = await readFile(config, "utf8");
  const lock = join(root, ".space/monorepo.lock"); await writeFile(lock, JSON.stringify({ pid: process.pid }));
  expect((await run(["project", "add", "locked"], 1)).error.code).toBe("LOCKED");
  expect(await readFile(config, "utf8")).toBe(before);
  expect((await run(["doctor"], 1)).data.locked).toBe(true);
  await rm(lock);
  await writeFile(config, JSON.stringify({ schemaVersion: 99 }));
  expect((await run(["project", "list"], 1)).error.code).toBe("INVALID_STATE");
});

test("missing or retargeted worktrees are reported, never silently recreated", async () => {
  await run(["setup"]); const source = await remote("source"); await register("api", source);
  const args = ["workspace", "create", "job", "--repo", "api"]; await run(args);
  const path = join(root, "workspaces/default/job/api");
  await writeFile(join(path, ".git"), `gitdir: ${join(source, ".git")}\n`);
  const status = (await run(["workspace", "show", "job"])).data;
  expect(status.ready).toBe(false); expect(status.repositories[0].problem).toBe("INVALID_WORKTREE");
  expect((await run(args, 1)).error.code).toBe("PARTIAL_FAILURE");
  await rm(path, { recursive: true });
  expect((await run(args, 1)).error.code).toBe("PARTIAL_FAILURE");
  expect(await Bun.file(join(path, ".git")).exists()).toBe(false);
});

test("inherited Git directory variables cannot redirect an operation", async () => {
  await run(["setup"]); const source = await remote("source"), decoy = await remote("decoy");
  await run(["repo", "add", "api", "--url", source], 0, { env: { GIT_DIR: join(decoy, ".git"), GIT_WORK_TREE: decoy, GIT_INDEX_FILE: join(decoy, "foreign-index") } });
  expect(await git("-C", decoy, "remote")).toBe("");
  expect(await Bun.file(join(decoy, "foreign-index")).exists()).toBe(false);
  expect((await run(["repo", "show", "api"])).data.phase).toBe("ready");
});

test("nested Git storage symlinks are refused, including during acquisition retries", async () => {
  await run(["setup"]); const source = await remote("source"); await register("api", source);
  const outside = join(temp, "outside"); await mkdir(outside);
  await symlink(outside, join(root, "repositories/default/api.git/refs/heads/koto"));
  expect((await run(["workspace", "create", "escape", "--repo", "api"], 1)).error.code).toBe("UNSAFE_PATH");
  expect(await Bun.file(join(outside, "escape")).exists()).toBe(false);
  expect((await run(["doctor"], 1)).data.repositories[0].problem).toBe("UNSAFE_PATH");
  const pending = join(temp, "later");
  await run(["repo", "add", "pending", "--url", pending], 1);
  const config = join(root, "repositories/default/pending.git/config");
  const saved = await readFile(config, "utf8"), external = join(outside, "config");
  await writeFile(external, saved); await rm(config); await symlink(external, config);
  await remote("later");
  expect((await run(["repo", "add", "pending", "--url", pending], 1)).error.code).toBe("UNSAFE_PATH");
  expect(await readFile(external, "utf8")).toBe(saved);
});

test("empty sources can recover, and an explicit base and work branch are honored", async () => {
  await run(["setup"]); const source = join(temp, "empty"); await git("init", "-q", "-b", "main", source);
  expect((await run(["repo", "add", "api", "--url", source], 1)).error.code).toBe("EMPTY_REPOSITORY");
  await writeFile(join(source, "README.md"), "first"); await git("-C", source, "add", "."); await git("-C", source, "commit", "-qm", "initial");
  await git("-C", source, "checkout", "-qb", "release");
  await writeFile(join(source, "README.md"), "release"); await git("-C", source, "commit", "-qam", "release");
  await git("-C", source, "checkout", "-q", "main");
  await register("api", source);
  const created = (await run(["workspace", "create", "job", "--repo", "api", "--base", "release", "--branch", "feature/job"])).data;
  expect(created.repositories[0].branch).toBe("feature/job");
  expect(await readFile(join(created.repositories[0].path, "README.md"), "utf8")).toBe("release");
  expect((await run(["workspace", "create", "job", "--repo", "api", "--base", "main", "--branch", "feature/job"], 1)).error.code).toBe("CONFLICT");
});

test("JSON requests use the same validations and Git workflow as command arguments", async () => {
  const input = (value: object) => ["--input-json", JSON.stringify({ root, ...value })];
  await run(input({ command: ["setup"] }));
  const source = await remote("source");
  await run(input({ command: ["repo", "add", "api"], url: source }));
  expect((await run(input({ command: ["workspace", "create", "job"], repo: ["api"] }))).data.ready).toBe(true);
  expect((await run(["workspace", "show", "job"])).data.ready).toBe(true);
  const config = join(root, ".space/default/monorepo.json"), before = await readFile(config, "utf8");
  expect((await run(input({ command: ["workspace", "create", "bad"], repo: "api" }), 2)).error.code).toBe("INVALID_INPUT");
  expect((await run(input({ command: ["project", "add", "--help"] }), 1)).error.code).toBe("INVALID_ID");
  expect((await run(input({ command: ["status"], project: "missing" }), 1)).error.code).toBe("PROJECT_NOT_FOUND");
  expect((await run(input({ command: ["status"], unexpected: true }), 2)).error.code).toBe("INVALID_INPUT");
  expect(await readFile(config, "utf8")).toBe(before);
});

test("concurrent writes are refused and an interrupted completed Git worktree resumes without losing edits", async () => {
  await run(["setup"]); const source = await remote("source"); await register("api", source);
  const bin = join(temp, "bin"), signal = join(temp, "git-completed.json"), realGit = Bun.which("git")!;
  await mkdir(bin);
  await writeFile(join(bin, "git"), `#!/usr/bin/env bun
const args = process.argv.slice(2);
const child = Bun.spawn([${JSON.stringify(realGit)}, ...args], { stdout: "pipe", stderr: "pipe" });
const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
process.stdout.write(out); process.stderr.write(err);
if (code === 0 && args.some((arg, i) => arg === "worktree" && args[i + 1] === "add")) {
  await Bun.write(${JSON.stringify(signal)}, JSON.stringify({ pid: process.pid }));
  await Bun.sleep(30000);
}
process.exit(code);
`, { mode: 0o755 });
  const args = ["workspace", "create", "job", "--repo", "api"];
  const child = Bun.spawn([process.execPath, cli, ...args, "--root", root, "--json"], {
    cwd: temp, env: { ...env(), PATH: `${bin}:${process.env.PATH}` }, stdout: "pipe", stderr: "pipe",
  });
  const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  let gitPid: number | undefined;
  const stop = async () => {
    child.kill("SIGKILL"); await child.exited;
    if (gitPid) {
      try { process.kill(gitPid, "SIGKILL"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      gitPid = undefined;
    }
    await output;
  };
  const work = join(root, "workspaces/default/job/api/uncommitted.txt");
  try {
    const deadline = Date.now() + 8000;
    while (!await Bun.file(signal).exists() && Date.now() < deadline && child.exitCode === null) await Bun.sleep(20);
    expect(await Bun.file(signal).exists()).toBe(true);
    gitPid = (await Bun.file(signal).json()).pid;
    expect((await run(["project", "add", "concurrent"], 1)).error.code).toBe("LOCKED");
    expect((await run(["project", "list"])).data.projects.map((p: { id: string }) => p.id)).toEqual(["default"]);
    await writeFile(work, "edit made before the management record was finalized\n");
  } finally { await stop(); }
  const project = JSON.parse(await readFile(join(root, ".space/default/monorepo.json"), "utf8"));
  expect(project.workspaces.job.repositories[0].phase).toBe("pending");
  expect((await run(args, 1)).error.code).toBe("LOCKED");
  await rm(join(root, ".space/monorepo.lock"));
  const resumed = (await run(args)).data;
  expect(resumed.ready).toBe(true);
  expect(resumed.repositories[0].dirty).toBe(true);
  expect(await readFile(work, "utf8")).toBe("edit made before the management record was finalized\n");
  expect((await run(["doctor"])).data.healthy).toBe(true);
}, 15_000);

test("cleanup previews and removes a task while retaining branches, other tasks and Git history", async () => {
  await run(["setup"]); const source = await remote("source"); await register("api", source);
  await run(["workspace", "create", "done", "--repo", "api"]);
  await run(["workspace", "create", "active", "--repo", "api"]);
  const work = join(root, "workspaces/default/done/api"), bare = join(root, "repositories/default/api.git");
  const head = await git("-C", work, "rev-parse", "HEAD");
  const config = join(root, ".space/default/monorepo.json"), before = await readFile(config, "utf8");
  const preview = (await run(["workspace", "remove", "done", "--dry-run"])).data;
  expect(preview.canRemove).toBe(true); expect(preview.dryRun).toBe(true);
  expect(await readFile(config, "utf8")).toBe(before);
  expect(await Bun.file(join(work, ".git")).exists()).toBe(true);
  const result = (await run(["workspace", "remove", "done"])).data;
  expect(result.changed).toBe(true);
  expect(await Bun.file(join(work, ".git")).exists()).toBe(false);
  expect(await git(`--git-dir=${bare}`, "rev-parse", "refs/heads/koto/done")).toBe(head);
  expect((await run(["workspace", "show", "active"])).data.ready).toBe(true);
  expect((await run(["workspace", "remove", "done"])).data.changed).toBe(false);
  await run(["workspace", "remove", "active"]);
  expect((await run(["repo", "remove", "api"])).data.dataDeleted).toBe(false);
}, 30_000);

test("cleanup protects modified, staged, untracked, ignored and hidden index changes, Git locks and operations", async () => {
  await run(["setup"]); const source = await remote("source");
  await writeFile(join(source, ".gitignore"), "ignored.txt\n");
  await git("-C", source, "add", ".gitignore"); await git("-C", source, "commit", "-qm", "ignore fixture");
  await register("api", source);
  for (const kind of ["modified", "staged", "untracked", "ignored", "hidden", "locked", "operation"]) {
    await run(["workspace", "create", kind, "--repo", "api"]);
    const path = join(root, "workspaces/default", kind, "api");
    if (kind === "locked") await git("-C", path, "worktree", "lock", "--reason", "active worker", path);
    else if (kind === "operation") {
      const dir = await git("-C", path, "rev-parse", "--absolute-git-dir");
      await writeFile(join(dir, "MERGE_HEAD"), (await git("-C", path, "rev-parse", "HEAD")) + "\n");
    } else {
      const name = kind === "ignored" ? "ignored.txt" : kind === "untracked" ? "untracked.txt" : "README.md";
      if (kind === "hidden") await git("-C", path, "update-index", "--assume-unchanged", "README.md");
      await writeFile(join(path, name), "keep this work\n");
      if (kind === "staged") await git("-C", path, "add", "README.md");
    }
    const preview = (await run(["workspace", "remove", kind, "--dry-run"], 1)).data;
    expect(preview.canRemove).toBe(false);
    expect((await run(["workspace", "remove", kind], 1)).error.code).toBe("CLEANUP_BLOCKED");
    expect(await Bun.file(join(path, ".git")).exists()).toBe(true);
  }
}, 30_000);

test("cleanup rejects unpublished commits and stale tracking refs but accepts a currently published branch", async () => {
  await run(["setup"]); const source = await remote("source"); await register("api", source);
  await run(["workspace", "create", "job", "--repo", "api"]);
  const path = join(root, "workspaces/default/job/api");
  await writeFile(join(path, "README.md"), "local commit\n");
  await git("-C", path, "add", "."); await git("-C", path, "commit", "-qm", "local only");
  let preview = (await run(["workspace", "remove", "job", "--dry-run"], 1)).data;
  expect(preview.repositories[0].problem).toBe("UNPUBLISHED_COMMITS");
  await git("-C", path, "push", "origin", "HEAD:refs/heads/published");
  await run(["repo", "sync", "api"]);
  await git("-C", source, "branch", "-D", "published");
  preview = (await run(["workspace", "remove", "job", "--dry-run"], 1)).data;
  expect(preview.repositories[0].problem).toBe("UNPUBLISHED_COMMITS");
  await git("-C", path, "push", "origin", "HEAD:refs/heads/published");
  const input = { command: ["workspace", "remove", "job"], root, dryRun: true };
  expect((await run(["--input-json", JSON.stringify(input)])).data.canRemove).toBe(true);
  await run(["workspace", "remove", "job"]);
  expect(await Bun.file(join(path, ".git")).exists()).toBe(false);
}, 30_000);

test("cleanup checks the whole task before deleting and does not cross projects or discard task-level files", async () => {
  await run(["setup"]); const source = await remote("source"); await register("a", source); await register("b", source);
  await run(["project", "add", "client"]); await register("a", source, "client");
  await run(["workspace", "create", "job", "--repo", "a", "--project", "client"]);
  await run(["workspace", "create", "job", "--repo", "a", "--repo", "b"]);
  const task = join(root, "workspaces/default/job");
  await writeFile(join(task, "notes.txt"), "keep task notes\n");
  await writeFile(join(task, "b/untracked.txt"), "keep\n");
  expect((await run(["workspace", "remove", "job"], 1)).error.code).toBe("CLEANUP_BLOCKED");
  expect(await Bun.file(join(task, "a/.git")).exists()).toBe(true);
  await rm(join(task, "b/untracked.txt"));
  await run(["workspace", "remove", "job"]);
  expect(await readFile(join(task, "notes.txt"), "utf8")).toBe("keep task notes\n");
  expect((await run(["workspace", "show", "job", "--project", "client"])).data.ready).toBe(true);
}, 30_000);

test("cleanup resumes after partial removal and after Git succeeds but its caller reports failure", async () => {
  await run(["setup"]); const source = await remote("source"); await register("a", source); await register("b", source);
  await run(["workspace", "create", "job", "--repo", "a", "--repo", "b"]);
  const bin = join(temp, "bin"), realGit = Bun.which("git")!;
  await mkdir(bin);
  await writeFile(join(bin, "git"), `#!/usr/bin/env bun
const args = process.argv.slice(2);
const target = args.includes("remove") && args.at(-1).endsWith("/job/b");
if (target && process.env.KOTO_TEST_FAILURE === "before") process.exit(9);
const child = Bun.spawn([${JSON.stringify(realGit)}, ...args], { stdout: "inherit", stderr: "inherit" });
const code = await child.exited;
process.exit(target && process.env.KOTO_TEST_FAILURE === "after" ? 9 : code);
`, { mode: 0o755 });
  const args = ["workspace", "remove", "job"];
  const options = (mode: string) => ({ env: { PATH: `${bin}:${process.env.PATH}`, KOTO_TEST_FAILURE: mode } });
  expect((await run(args, 1, options("before"))).error.code).toBe("PARTIAL_FAILURE");
  expect(await Bun.file(join(root, "workspaces/default/job/a/.git")).exists()).toBe(false);
  expect(await Bun.file(join(root, "workspaces/default/job/b/.git")).exists()).toBe(true);
  expect((await run(["workspace", "create", "job", "--repo", "a", "--repo", "b"], 1)).error.code).toBe("REMOVAL_IN_PROGRESS");
  expect((await run(["doctor"], 1)).data.healthy).toBe(false);
  expect((await run(args, 1, options("after"))).error.code).toBe("PARTIAL_FAILURE");
  expect(await Bun.file(join(root, "workspaces/default/job/b/.git")).exists()).toBe(false);
  expect((await run(args)).data.changed).toBe(true);
  expect((await run(["workspace", "list"])).data.workspaces).toEqual([]);
  expect((await run(["doctor"])).data.healthy).toBe(true);
}, 30_000);

test("cleanup rechecks files after network operations and rejects another worktree's Git pointer", async () => {
  await run(["setup"]); const source = await remote("source");
  await writeFile(join(source, ".gitignore"), "ignored.txt\n");
  await git("-C", source, "add", ".gitignore"); await git("-C", source, "commit", "-qm", "ignore fixture");
  await register("api", source); await run(["workspace", "create", "job", "--repo", "api"]);
  const path = join(root, "workspaces/default/job/api"), bin = join(temp, "bin"), realGit = Bun.which("git")!;
  await mkdir(bin);
  await writeFile(join(bin, "git"), `#!/usr/bin/env bun
const args = process.argv.slice(2);
const child = Bun.spawn([${JSON.stringify(realGit)}, ...args], { stdout: "inherit", stderr: "inherit" });
const code = await child.exited;
if (args.includes("fetch")) await Bun.write(${JSON.stringify(join(path, "ignored.txt"))}, "created during fetch");
process.exit(code);
`, { mode: 0o755 });
  const failure = await run(["workspace", "remove", "job"], 1, { env: { PATH: `${bin}:${process.env.PATH}` } });
  expect(failure.error.code).toBe("CLEANUP_BLOCKED");
  expect(failure.error.details.repositories[0].problem).toBe("UNSAVED_FILES");
  expect(await readFile(join(path, "ignored.txt"), "utf8")).toBe("created during fetch");
  await rm(join(path, "ignored.txt"));
  await run(["workspace", "create", "other", "--repo", "api"]);
  const other = join(root, "workspaces/default/other/api");
  await writeFile(join(path, ".git"), await readFile(join(other, ".git")));
  const preview = (await run(["workspace", "remove", "job", "--dry-run"], 1)).data;
  expect(preview.repositories[0].problem).toBe("INVALID_WORKTREE");
  expect(await Bun.file(join(other, ".git")).exists()).toBe(true);
}, 30_000);
