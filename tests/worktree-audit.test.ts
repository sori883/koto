import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  audit,
  checkedOutBranches,
  chooseBranchBucket,
  chooseBucket,
  classifyDirty,
  formatSize,
  formatTable,
  lastChats,
  parseCli,
  parseWorktreeList,
  transcriptsDirFor,
} from "../plugin/skills/koto-mode/scripts/worktree-audit.ts";

const script = join(import.meta.dir, "../plugin/skills/koto-mode/scripts/worktree-audit.ts");

describe("pure helpers", () => {
  test("parses worktree paths, including spaces", () => {
    const porcelain = "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt/with space\nHEAD def\ndetached\n";
    expect(parseWorktreeList(porcelain)).toEqual(["/repo", "/wt/with space"]);
  });

  test("separates tracked WIP from untracked scratch", () => {
    expect(classifyDirty("")).toBe("clean");
    expect(classifyDirty("?? a\n?? b\n")).toBe("scratch:2");
    expect(classifyDirty(" M a\n?? b\nA  c\n")).toBe("wip:2");
  });

  test("buckets in priority order", () => {
    const base = { dirty: "clean", pr: "-", recentChat: false, merged: "no" as const };
    expect(chooseBucket({ ...base, dirty: "wip:1", pr: "#1/open", recentChat: true })).toBe("hold-wip");
    expect(chooseBucket({ ...base, pr: "#1/draft", recentChat: true })).toBe("hold-open-pr");
    expect(chooseBucket({ ...base, pr: "#1/merged", recentChat: true })).toBe("verify-recent-chat");
    expect(chooseBucket({ ...base, pr: "#1/closed" })).toBe("safe");
    expect(chooseBucket({ ...base, merged: "YES" })).toBe("safe");
    expect(chooseBucket({ ...base, dirty: "scratch:3" })).toBe("review");
  });

  test("reads checked-out branches and buckets loose branches", () => {
    const porcelain = "worktree /r\nHEAD a\nbranch refs/heads/main\n\nworktree /w\nHEAD b\ndetached\n\nworktree /x\nHEAD c\nbranch refs/heads/feat/x\n";
    expect([...checkedOutBranches(porcelain)]).toEqual(["main", "feat/x"]);
    expect(chooseBranchBucket({ pr: "#3/open", merged: "YES" })).toBe("hold-open-pr");
    expect(chooseBranchBucket({ pr: "-", merged: "YES" })).toBe("safe");
    expect(chooseBranchBucket({ pr: "#3/closed", merged: "no" })).toBe("safe");
    expect(chooseBranchBucket({ pr: "-", merged: "no" })).toBe("review");
  });

  test("formats sizes like du -h", () => {
    expect(formatSize(0)).toBe("0K");
    expect(formatSize(512)).toBe("512K");
    expect(formatSize(4096)).toBe("4.0M");
    expect(formatSize(1536)).toBe("1.5M");
    expect(formatSize(20 * 1024 * 1024)).toBe("20G");
  });

  test("maps the main worktree to its transcripts folder", () => {
    expect(transcriptsDirFor("/Users/me/my.repo", "/home")).toBe("/home/.claude/projects/-Users-me-my-repo");
  });

  test("parses options", () => {
    expect(parseCli([])).toEqual({ help: false, base: undefined, repo: undefined });
    expect(parseCli(["-b", "origin/dev", "/r"])).toEqual({ help: false, base: "origin/dev", repo: "/r" });
    expect(parseCli(["--help"])).toEqual({ help: true });
    expect(() => parseCli(["-b"])).toThrow("needs a ref");
    expect(() => parseCli(["-x"])).toThrow("unknown option");
    expect(() => parseCli(["/a", "/b"])).toThrow("unexpected argument");
  });
});

describe("transcripts", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "audit-chats-"));
    mkdirSync(join(dir, "session", "subagents"), { recursive: true });
    writeFileSync(join(dir, "a.jsonl"), '{"cwd":"/wt/x-1"}\n');
    writeFileSync(join(dir, "session", "subagents", "b.jsonl"), '{"file":"/wt/x/src/a.ts"}\n');
    utimesSync(join(dir, "a.jsonl"), 1000, 1000);
    utimesSync(join(dir, "session", "subagents", "b.jsonl"), 2000, 2000);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("matches a path only when followed by / or a quote, searching subfolders", () => {
    const chats = lastChats(dir, ["/wt/x", "/wt/x-1", "/wt/none"]);
    expect(chats.get("/wt/x")).toBe(2000);
    expect(chats.get("/wt/x-1")).toBe(1000);
    expect(chats.has("/wt/none")).toBe(false);
  });
});

describe("audit on a real repository", () => {
  let root: string;
  let repo: string;
  const sh = (cwd: string, ...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "audit-repo-")));
    repo = join(root, "repo");
    mkdirSync(repo);
    sh(repo, "init", "-q", "-b", "main");
    sh(repo, "config", "user.email", "t@example.com");
    sh(repo, "config", "user.name", "t");
    writeFileSync(join(repo, "a.txt"), "a\n");
    sh(repo, "add", "a.txt");
    sh(repo, "commit", "-q", "-m", "init");
    // merged: branch at main's commit
    sh(repo, "worktree", "add", "-q", join(root, "merged"), "-b", "merged");
    // wip: tracked edit on a new commit
    sh(repo, "worktree", "add", "-q", join(root, "wip"), "-b", "wip");
    writeFileSync(join(root, "wip", "b.txt"), "b\n");
    sh(join(root, "wip"), "add", "b.txt");
    sh(join(root, "wip"), "commit", "-q", "-m", "b");
    writeFileSync(join(root, "wip", "a.txt"), "changed\n");
    // scratch: untracked file only, unmerged commit, open PR is closed
    sh(repo, "worktree", "add", "-q", join(root, "scratch dir"), "-b", "scratch");
    writeFileSync(join(root, "scratch dir", "c.txt"), "c\n");
    sh(join(root, "scratch dir"), "add", "c.txt");
    sh(join(root, "scratch dir"), "commit", "-q", "-m", "c");
    writeFileSync(join(root, "scratch dir", "junk.log"), "x\n");
    // detached, open PR elsewhere
    sh(repo, "worktree", "add", "-q", "--detach", join(root, "detached"));
    // loose branches: a backup of unmerged work, a merged leftover, one with an open PR
    sh(repo, "branch", "backup/scratch", "scratch");
    sh(repo, "branch", "old-merged", "main");
    sh(repo, "branch", "in-review", "wip");
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("classifies each worktree and skips the main one", () => {
    const now = Math.floor(Date.now() / 1000);
    const { base, rows, branches } = audit({
      repo,
      base: "main",
      prs: [
        { number: 7, state: "closed", head: "scratch" },
        { number: 9, state: "open", head: "in-review" },
      ],
      transcriptsDir: join(root, "no-transcripts"),
      now,
      warn: () => {},
    });
    expect(base).toBe("main");
    const byName = Object.fromEntries(rows.map((row) => [row.worktree.slice(root.length + 1), row]));
    expect(Object.keys(byName).sort()).toEqual(["detached", "merged", "scratch dir", "wip"]);
    expect(byName.merged).toMatchObject({ merged: "YES", dirty: "clean", remote: "no-remote", pr: "-", bucket: "safe", age: "0d" });
    expect(byName.wip).toMatchObject({ merged: "no", dirty: "wip:1", bucket: "hold-wip" });
    expect(byName["scratch dir"]).toMatchObject({ merged: "no", dirty: "scratch:1", pr: "#7/closed", bucket: "safe" });
    expect(byName.detached).toMatchObject({ remote: "detached", merged: "YES", bucket: "safe" });
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.sizeKb).toBeGreaterThanOrEqual(rows[i]!.sizeKb);
    expect(formatTable(base, rows).split("\n")[1]).toBe("SIZE\tAGE\tMERGED\tDIRTY\tREMOTE\tPR\tLAST_CHAT\tBUCKET\tWORKTREE");

    // Branches checked out in a worktree (main, merged, wip, scratch) are not listed.
    expect(branches.map((b) => b.branch)).toEqual(["backup/scratch", "in-review", "old-merged"]);
    const byBranch = Object.fromEntries(branches.map((b) => [b.branch, b]));
    expect(byBranch["backup/scratch"]).toMatchObject({ merged: "no", unique: 1, remote: "no-remote", pr: "-", bucket: "review", age: "0d" });
    expect(byBranch["old-merged"]).toMatchObject({ merged: "YES", unique: 0, bucket: "safe" });
    expect(byBranch["in-review"]).toMatchObject({ pr: "#9/open", bucket: "hold-open-pr" });
    const table = formatTable(base, rows, branches).split("\n");
    expect(table).toContain("# branches not checked out in any worktree");
    expect(table).toContain("0d\tno\t1\tno-remote\t-\treview\tbackup/scratch");
  });

  test("fails clearly on a missing base ref", () => {
    expect(() => audit({ repo, base: "nope", prs: [], warn: () => {} })).toThrow("base ref not found: nope");
  });

  test("cli prints usage and rejects unknown options", () => {
    const help = Bun.spawnSync(["bun", script, "--help"], { stdout: "pipe" });
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("Usage:");
    const bad = Bun.spawnSync(["bun", script, "--bogus"], { stderr: "pipe" });
    expect(bad.exitCode).toBe(2);
  });
});
