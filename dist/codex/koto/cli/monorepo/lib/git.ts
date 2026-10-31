import { execFile } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { MonorepoError, requireThat } from "./model.ts";

export function remoteUrl(value: string): string {
  requireThat(value.length > 0 && !/[\x00-\x1f\x7f]/.test(value) && !value.startsWith("-"), "INVALID_URL", "Provide a Git URL or a local path without control characters.");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    let url: URL; try { url = new URL(value); } catch { throw new MonorepoError("INVALID_URL", "Invalid repository URL."); }
    requireThat(["https:", "ssh:", "file:"].includes(url.protocol), "INVALID_URL", "Use HTTPS, SSH or a local file URL.");
    requireThat(!url.password && !url.search && !url.hash && (url.protocol !== "https:" || !url.username), "INVALID_URL", "Do not embed credentials or query parameters in repository URLs; use Git authentication.");
    return value;
  }
  if (/^(?:[a-zA-Z0-9_.-]+@)?[a-zA-Z0-9_.-]+:[^:]+$/.test(value)) return value;
  requireThat(!value.includes("::") && (isAbsolute(value) || value.startsWith("./") || value.startsWith("../")), "INVALID_URL", "Use an explicit local path or a supported Git URL.");
  return resolve(value);
}
export async function git(args: string[], cwd: string, allowFailure = false): Promise<{ output: string; code: number }> {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_") && !["GIT_SSH", "GIT_SSH_COMMAND", "GIT_SSH_VARIANT", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_NOSYSTEM"].includes(key)) delete env[key];
  env.GIT_TERMINAL_PROMPT = "0"; env.GIT_OPTIONAL_LOCKS = "0"; env.LC_ALL = "C";
  env.GIT_SSH_COMMAND ??= "ssh -oBatchMode=yes";
  const result = await new Promise<{ output: string; code: number }>((resolveResult, reject) => {
    execFile("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "protocol.ext.allow=never", ...args], { cwd, env, timeout: 60_000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" }, (error, stdout) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") { reject(new MonorepoError("GIT_UNAVAILABLE", "Git is not installed or is not on PATH.")); return; }
      if (error && (error.killed || typeof error.code !== "number")) { reject(new MonorepoError("GIT_FAILED", "Git was interrupted, timed out, or exceeded its output limit.")); return; }
      resolveResult({ output: stdout, code: error ? Number(error.code) : 0 });
    });
  });
  if (result.code !== 0 && !allowFailure) throw new MonorepoError("GIT_FAILED", "Git could not complete the operation. Check repository access and Git configuration.", { exitCode: result.code });
  return result;
}
export async function refName(value: string, cwd: string): Promise<string> {
  requireThat(!value.startsWith("-") && !/[\x00-\x20\x7f]/.test(value), "INVALID_REF", "Invalid branch name.");
  const checked = await git(["check-ref-format", `refs/heads/${value}`], cwd, true);
  requireThat(checked.code === 0, "INVALID_REF", "Invalid branch name.");
  return value;
}
export interface GitWorktree { path: string; branch?: string; bare: boolean; locked: boolean }
export async function worktrees(bare: string, root: string): Promise<GitWorktree[]> {
  const { output } = await git([`--git-dir=${bare}`, "worktree", "list", "--porcelain", "-z"], root);
  return output.split("\0\0").filter(Boolean).map(block => {
    const lines = block.split("\0");
    const path = lines.find(line => line.startsWith("worktree "))?.slice(9);
    requireThat(path, "GIT_FAILED", "Git returned an invalid worktree listing.");
    return { path, branch: lines.find(line => line.startsWith("branch "))?.slice(7), bare: lines.includes("bare"), locked: lines.some(line => line === "locked" || line.startsWith("locked ")) };
  });
}
export function changes(output: string) {
  const parts = output.split("\0"), result: { status: string; path: string; from?: string }[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!; if (!part) continue;
    const status = part.slice(0, 2), item: { status: string; path: string; from?: string } = { status, path: part.slice(3) };
    if (/[RC]/.test(status)) item.from = parts[++index];
    result.push(item);
  }
  return result;
}
