#!/usr/bin/env bun
// Read-only worktree prune audit. Classifies every git worktree by size, merge
// state, uncommitted work, remote/PR state, and the most recent chat that
// operated in it. Emits a table sorted by size with a suggested bucket. Never
// deletes anything; deletion stays a human-gated step in the playbook.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const USAGE = `Usage: worktree-audit.ts [-b|--base <ref>] [repo-path]
  repo-path defaults to the current repo.
  -b sets the ref the MERGED column checks against (e.g. origin/integration).
  Without it the base is origin/HEAD, then origin/main, then origin/master.
  origin/HEAD is the remote's default branch, not necessarily the branch PRs
  merge into; pass -b when they differ.`;

const DAY = 86_400;
const RECENT_DAYS = 4;

export type Pr = { number: number; state: string; head: string };
export type Bucket = "hold-wip" | "hold-open-pr" | "verify-recent-chat" | "safe" | "review";
export type Row = {
  sizeKb: number;
  size: string;
  age: string;
  merged: "YES" | "no";
  dirty: string;
  remote: string;
  pr: string;
  lastChat: string;
  bucket: Bucket;
  worktree: string;
};

export class AuditError extends Error {
  constructor(message: string, public exitCode = 1) {
    super(message);
  }
}

type Run = { ok: boolean; stdout: string };

function run(command: string, args: string[], cwd?: string): Run {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { ok: result.status === 0, stdout: result.status === 0 ? result.stdout : "" };
}

const git = (cwd: string, ...args: string[]) => run("git", args, cwd);

/** Paths from `git worktree list --porcelain`, main worktree first. Paths may contain spaces. */
export function parseWorktreeList(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

/** Tracked edits are real WIP; untracked-only changes are disposable scratch. */
export function classifyDirty(porcelain: string): string {
  const lines = porcelain.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return "clean";
  const tracked = lines.filter((line) => !line.startsWith("??")).length;
  return tracked > 0 ? `wip:${tracked}` : `scratch:${lines.length}`;
}

export function chooseBucket(row: { dirty: string; pr: string; recentChat: boolean; merged: "YES" | "no" }): Bucket {
  if (row.dirty.startsWith("wip:")) return "hold-wip";
  if (row.pr.endsWith("/open") || row.pr.endsWith("/draft")) return "hold-open-pr";
  if (row.recentChat) return "verify-recent-chat";
  // Squash-merged branches are not ancestors of the base, so any PR counts.
  if (row.merged === "YES" || row.pr !== "-") return "safe";
  return "review";
}

/** Human-readable size like `du -h`: 512K, 4.0M, 12G. */
export function formatSize(kb: number): string {
  const units = ["K", "M", "G", "T", "P"];
  let value = kb;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = value < 10 && unit > 0 ? value.toFixed(1) : String(Math.round(value));
  return `${shown}${units[unit]}`;
}

/** Claude Code stores transcripts under ~/.claude/projects/<path with non-alphanumerics replaced by ->. */
export function transcriptsDirFor(mainWorktree: string, home = homedir()): string {
  return join(home, ".claude", "projects", mainWorktree.replace(/[^A-Za-z0-9]/g, "-"));
}

function listFiles(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

/**
 * Latest modification time (epoch seconds) of a transcript that mentions each
 * worktree. A path must be followed by "/" or a quote, so wt-482 does not match
 * wt-482-r37. Each transcript is read once for all worktrees.
 */
export function lastChats(transcriptsDir: string, worktrees: string[]): Map<string, number> {
  const latest = new Map<string, number>();
  for (const file of listFiles(transcriptsDir)) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const mtime = Math.floor(statSync(file).mtimeMs / 1000);
    for (const wt of worktrees) {
      if ((latest.get(wt) ?? 0) >= mtime) continue;
      if (text.includes(`${wt}/`) || text.includes(`${wt}"`)) latest.set(wt, mtime);
    }
  }
  return latest;
}

/** PR state by branch, newest source first: the Origin CLI when it can read this repo, then gh. */
export function fetchPrs(repo: string): Pr[] {
  const parse = (raw: string, map: (item: Record<string, unknown>) => Pr): Pr[] => {
    try {
      const items = JSON.parse(raw);
      return Array.isArray(items) ? items.map(map) : [];
    } catch {
      return [];
    }
  };
  const origin = run("origin", ["pr", "list", "--author", "@me", "--state", "all", "--limit", "1000", "--json", "number,status,headRef"], repo);
  if (origin.ok) {
    return parse(origin.stdout, (item) => ({ number: Number(item.number), state: String(item.status), head: String(item.headRef) }));
  }
  const gh = run("gh", ["pr", "list", "--author", "@me", "--state", "all", "--limit", "1000", "--json", "number,state,headRefName"], repo);
  if (gh.ok) {
    return parse(gh.stdout, (item) => ({
      number: Number(item.number),
      state: String(item.state).toLowerCase(),
      head: String(item.headRefName),
    }));
  }
  return [];
}

function localDay(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function resolveBase(repo: string, base: string | undefined, warn: (message: string) => void): string {
  if (!base) {
    const originHead = git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").stdout.trim();
    base = [originHead, "origin/main", "origin/master"].find(
      (candidate) => candidate && git(repo, "rev-parse", "--verify", "--quiet", `${candidate}^{commit}`).ok,
    );
    if (!base) throw new AuditError("no base ref (origin/HEAD, origin/main, origin/master all missing); pass -b <ref>");
    warn(`no -b given; MERGED checks against ${base}`);
  }
  // The fetch is best-effort (stale is fine for a first pass) and runs before
  // the check, since -b may name a branch not fetched yet. The explicit
  // refspec creates it even in a single-branch clone.
  if (base.startsWith("origin/")) {
    const branch = base.slice("origin/".length);
    if (!git(repo, "fetch", "origin", `+refs/heads/${branch}:refs/remotes/${base}`, "--quiet").ok) {
      warn(`could not fetch ${base}; merged column may be stale`);
    }
  }
  if (!git(repo, "rev-parse", "--verify", "--quiet", `${base}^{commit}`).ok) throw new AuditError(`base ref not found: ${base}`);
  return base;
}

export type AuditOptions = {
  repo?: string;
  base?: string;
  /** Override PR lookup, e.g. in tests. */
  prs?: Pr[];
  transcriptsDir?: string;
  now?: number;
  warn?: (message: string) => void;
};

export function audit(options: AuditOptions = {}): { base: string; rows: Row[] } {
  const warn = options.warn ?? ((message: string) => console.error(`warn: ${message}`));
  const repo = options.repo ?? git(process.cwd(), "rev-parse", "--show-toplevel").stdout.trim();
  if (!repo) throw new AuditError("not in a git repo; pass a repo path");
  if (!git(repo, "rev-parse", "--git-dir").ok) throw new AuditError(`not a git repo: ${repo}`);

  // Main worktree is the first entry; everything else is a candidate.
  const [mainWorktree, ...candidates] = parseWorktreeList(git(repo, "worktree", "list", "--porcelain").stdout);
  if (!mainWorktree) throw new AuditError(`no worktrees listed for ${repo}`);
  const base = resolveBase(repo, options.base, warn);
  const prs = options.prs ?? fetchPrs(repo);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const chats = lastChats(options.transcriptsDir ?? transcriptsDirFor(mainWorktree), candidates);

  const rows = candidates.map((wt): Row => {
    const sizeKb = Number(run("du", ["-sk", wt]).stdout.split("\t")[0]) || 0;
    const head = git(wt, "rev-parse", "HEAD").stdout.trim();
    const headTs = Number(git(wt, "log", "-1", "--format=%ct", "HEAD").stdout.trim()) || 0;
    const age = headTs > 0 ? `${Math.floor((now - headTs) / DAY)}d` : "?";
    // merge-base only catches fast-forward/rebase merges; PR state covers squash merges.
    const merged = head && git(repo, "merge-base", "--is-ancestor", head, base).ok ? "YES" : "no";
    const dirty = classifyDirty(git(wt, "status", "--porcelain").stdout);

    const branch = git(wt, "symbolic-ref", "--quiet", "--short", "HEAD").stdout.trim();
    let remote: string;
    if (!branch) {
      remote = "detached";
    } else if (git(wt, "show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`).ok) {
      const remoteHead = git(wt, "rev-parse", `origin/${branch}`).stdout.trim();
      remote = remoteHead === head ? "pushed" : `ahead${git(wt, "rev-list", "--count", `origin/${branch}..HEAD`).stdout.trim()}`;
    } else {
      remote = "no-remote";
    }

    const match = branch ? prs.find((pr) => pr.head === branch) : undefined;
    const pr = match ? `#${match.number}/${match.state}` : "-";

    const lastTs = chats.get(wt) ?? 0;
    const recentChat = lastTs > 0 && Math.floor((now - lastTs) / DAY) <= RECENT_DAYS;

    return {
      sizeKb,
      size: formatSize(sizeKb),
      age,
      merged,
      dirty,
      remote,
      pr,
      lastChat: lastTs > 0 ? localDay(lastTs) : "-",
      bucket: chooseBucket({ dirty, pr, recentChat, merged }),
      worktree: wt,
    };
  });
  rows.sort((a, b) => b.sizeKb - a.sizeKb);
  return { base, rows };
}

export function formatTable(base: string, rows: Row[]): string {
  const lines = [`# base: ${base}`, "SIZE\tAGE\tMERGED\tDIRTY\tREMOTE\tPR\tLAST_CHAT\tBUCKET\tWORKTREE"];
  for (const row of rows) {
    lines.push([row.size, row.age, row.merged, row.dirty, row.remote, row.pr, row.lastChat, row.bucket, row.worktree].join("\t"));
  }
  return lines.join("\n") + "\n";
}

export function parseCli(argv: string[]): { help: true } | { help: false; base?: string; repo?: string } {
  let base: string | undefined;
  const args = [...argv];
  while (args.length > 0) {
    const arg = args[0]!;
    if (arg === "-b" || arg === "--base") {
      if (args.length < 2) throw new AuditError(`${arg} needs a ref`, 2);
      base = args[1];
      args.splice(0, 2);
    } else if (arg === "-h" || arg === "--help") {
      return { help: true };
    } else if (arg.startsWith("-")) {
      throw new AuditError(`unknown option: ${arg}`, 2);
    } else {
      break;
    }
  }
  if (args.length > 1) throw new AuditError(`unexpected argument: ${args[1]}`, 2);
  return { help: false, base, repo: args[0] };
}

if (import.meta.main) {
  try {
    const cli = parseCli(process.argv.slice(2));
    if (cli.help) {
      console.log(USAGE);
    } else {
      const { base, rows } = audit({ repo: cli.repo, base: cli.base });
      process.stdout.write(formatTable(base, rows));
    }
  } catch (error) {
    if (!(error instanceof AuditError)) throw error;
    console.error(`error: ${error.message}`);
    process.exit(error.exitCode);
  }
}
