export class MonorepoError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
}
export function requireThat(value: unknown, code: string, message: string, details?: unknown): asserts value {
  if (!value) throw new MonorepoError(code, message, details);
}
export function identifier(value: string): string {
  requireThat(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) && !["constructor", "prototype"].includes(value), "INVALID_ID", "IDs must use 1–64 lowercase letters, digits, hyphens or underscores and start with a letter or digit.");
  return value;
}
export interface RootState { schemaVersion: 1; rootId: string; projects: string[] }
export interface Repository { id: string; url: string; phase: "pending" | "ready"; defaultBranch?: string; error?: string }
export interface Worktree { repositoryId: string; branch: string; base: string; commit: string; phase: "pending" | "ready"; error?: string }
export interface Workspace { id: string; repositories: Worktree[]; removal?: Record<string, string> }
export interface Project { schemaVersion: 1; rootId: string; id: string; repositories: Record<string, Repository>; workspaces: Record<string, Workspace> }
export interface Owner { schemaVersion: 1; rootId: string; projectId: string; repositoryId: string; url: string }

function object(value: unknown): asserts value is Record<string, unknown> {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_STATE", "Expected a JSON object.");
}
function text(value: unknown): asserts value is string { requireThat(typeof value === "string" && value.length > 0 && !value.includes("\0"), "INVALID_STATE", "Invalid text in management data."); }
function id(value: unknown): asserts value is string { text(value); identifier(value); }
function phase(value: unknown) { requireThat(value === "pending" || value === "ready", "INVALID_STATE", "Invalid operation state."); }
export function validateRoot(value: unknown): RootState {
  object(value); requireThat(value.schemaVersion === 1, "INVALID_STATE", "Unsupported root schema."); text(value.rootId);
  requireThat(Array.isArray(value.projects), "INVALID_STATE", "Invalid project registry."); value.projects.forEach(id);
  requireThat(new Set(value.projects).size === value.projects.length && value.projects.includes("default"), "INVALID_STATE", "Invalid project registry.");
  return value as unknown as RootState;
}
export function validateProject(value: unknown, rootId: string, projectId: string): Project {
  object(value); requireThat(value.schemaVersion === 1 && value.rootId === rootId && value.id === projectId, "INVALID_STATE", "Project identity does not match this root.");
  object(value.repositories); object(value.workspaces);
  for (const [key, repo] of Object.entries(value.repositories)) {
    id(key); object(repo); requireThat(repo.id === key, "INVALID_STATE", "Repository identity mismatch."); text(repo.url); phase(repo.phase);
    if (repo.phase === "ready") text(repo.defaultBranch);
  }
  for (const [key, workspace] of Object.entries(value.workspaces)) {
    id(key); object(workspace); requireThat(workspace.id === key && Array.isArray(workspace.repositories) && workspace.repositories.length > 0, "INVALID_STATE", "Invalid workspace.");
    const seen = new Set();
    for (const entry of workspace.repositories as unknown[]) {
      object(entry); id(entry.repositoryId); text(entry.branch); text(entry.base); text(entry.commit); phase(entry.phase);
      requireThat(/^[0-9a-f]{40,64}$/.test(entry.commit) && Object.hasOwn(value.repositories, entry.repositoryId) && !seen.has(entry.repositoryId), "INVALID_STATE", "Invalid workspace repository reference.");
      seen.add(entry.repositoryId);
    }
    if (workspace.removal !== undefined) {
      object(workspace.removal);
      requireThat(Object.keys(workspace.removal).length === seen.size, "INVALID_STATE", "Invalid removal journal.");
      for (const [id, head] of Object.entries(workspace.removal)) {
        requireThat(seen.has(id) && typeof head === "string" && /^[0-9a-f]{40,64}$/.test(head), "INVALID_STATE", "Invalid removal journal.");
      }
    }
  }
  return value as unknown as Project;
}
export function emptyProject(rootId: string, id: string): Project { return { schemaVersion: 1, rootId, id, repositories: {}, workspaces: {} }; }
