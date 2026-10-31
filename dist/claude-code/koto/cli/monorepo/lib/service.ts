import { readFile, readdir, rmdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { directory, exists, locked, readJson, rootPath, safePath, saveJson } from "./files.ts";
import { changes, git, refName, remoteUrl, worktrees } from "./git.ts";
import { emptyProject, identifier, MonorepoError, requireThat, validateProject, validateRoot } from "./model.ts";
import type { Owner, Project, Repository, RootState, Workspace, Worktree } from "./model.ts";
import { instructions } from "./instructions.ts";

interface RemovalCheck {
  repositoryId: string; path: string; branch: string; head?: string;
  canRemove: boolean; alreadyRemoved: boolean; problem?: string; message?: string; details?: unknown;
}

export class Monorepo {
  private constructor(readonly root: string) {}
  static async open(path: string, create = false) { return new Monorepo(await rootPath(path, create)); }
  private async configuration(): Promise<RootState> { return validateRoot(await readJson(await safePath(this.root, ".space/monorepo.json"))); }
  private async projectFile(id: string) { return safePath(this.root, ".space", identifier(id), "monorepo.json"); }
  private async project(id: string): Promise<Project> {
    identifier(id);
    const config = await this.configuration();
    requireThat(config.projects.includes(id), "PROJECT_NOT_FOUND", `Project '${id}' is not registered.`);
    return validateProject(await readJson(await this.projectFile(id)), config.rootId, id);
  }
  private async save(project: Project) { await saveJson(this.root, await this.projectFile(project.id), project); }
  private async prepareProject(config: RootState, id: string): Promise<Project> {
    await directory(this.root, ".space", id);
    await directory(this.root, "repositories", id);
    await directory(this.root, "workspaces", id);
    const file = await this.projectFile(id);
    if (await exists(file)) return validateProject(await readJson(file), config.rootId, id);
    const project = emptyProject(config.rootId, id);
    await saveJson(this.root, file, project);
    return project;
  }
  async setup() {
    return locked(this.root, "setup", async () => {
      await git(["--version"], this.root);
      const file = await safePath(this.root, ".space/monorepo.json");
      const initialized = await exists(file);
      const config = initialized ? validateRoot(await readJson(file)) : { schemaVersion: 1 as const, rootId: crypto.randomUUID(), projects: ["default"] };
      if (!initialized) await saveJson(this.root, file, config);
      await this.prepareProject(config, "default");
      return { root: this.root, project: "default", changed: !initialized };
    });
  }
  async projectAdd(id: string) {
    identifier(id);
    return locked(this.root, "project add", async () => {
      const config = await this.configuration(), changed = !config.projects.includes(id);
      await this.prepareProject(config, id);
      if (changed) { config.projects.push(id); config.projects.sort(); await saveJson(this.root, await safePath(this.root, ".space/monorepo.json"), config); }
      return { id, path: join(this.root, ".space", id), changed };
    });
  }
  async projectList() { return { root: this.root, projects: (await this.configuration()).projects.map(id => ({ id, path: join(this.root, ".space", id) })) }; }
  async projectShow(id: string) {
    const project = await this.project(id);
    return { id, path: join(this.root, ".space", id), repositories: Object.keys(project.repositories), workspaces: Object.keys(project.workspaces) };
  }
  async instructions(id: string, mode: string, target: string, product: string, source?: string) {
    const execute = async () => {
      const project = await this.project(id);
      return instructions(this.root, project.rootId, project.id, mode, target, product, source);
    };
    return mode === "apply" ? locked(this.root, "instructions apply", execute) : execute();
  }
  private repository(project: Project, id: string): Repository {
    identifier(id);
    requireThat(Object.hasOwn(project.repositories, id), "REPOSITORY_NOT_FOUND", `Repository '${id}' is not registered in '${project.id}'.`);
    return project.repositories[id]!;
  }
  private async repoPath(project: string, id: string) { return safePath(this.root, "repositories", identifier(project), `${identifier(id)}.git`); }
  private async workspacePath(project: string, task: string, repo: string) { return safePath(this.root, "workspaces", identifier(project), identifier(task), identifier(repo)); }
  private owner(project: Project, repo: Repository): Owner { return { schemaVersion: 1, rootId: project.rootId, projectId: project.id, repositoryId: repo.id, url: repo.url }; }
  private async checkOwner(project: Project, repo: Repository): Promise<string> {
    remoteUrl(repo.url);
    const path = await this.repoPath(project.id, repo.id);
    requireThat(await exists(path), "MISSING_REPOSITORY", "The managed repository directory is missing.");
    const ownerPath = await safePath(this.root, path, "koto-owner.json");
    requireThat(await exists(ownerPath), "CONFLICT", "The repository directory is not owned by this registration.");
    const actual = await readJson(ownerPath), expected = this.owner(project, repo);
    requireThat(actual !== null && typeof actual === "object" && Object.entries(expected).every(([key, value]) => (actual as Record<string, unknown>)[key] === value), "CONFLICT", "Repository ownership or source differs. Existing files were retained.");
    return path;
  }
  private async checkBare(project: Project, repo: Repository): Promise<string> {
    const path = await this.checkOwner(project, repo);
    await this.checkStorage(path);
    requireThat((await git([`--git-dir=${path}`, "rev-parse", "--is-bare-repository"], this.root)).output.trim() === "true", "INVALID_REPOSITORY", "Expected a bare repository.");
    const origin = await git([`--git-dir=${path}`, "remote", "get-url", "origin"], this.root);
    requireThat(origin.output.trim() === repo.url, "CONFLICT", "Git origin differs from the registered source.");
    return path;
  }
  private async checkStorage(path: string): Promise<void> {
    for (const item of await readdir(path, { withFileTypes: true })) {
      requireThat(!item.isSymbolicLink() && (item.isDirectory() || item.isFile()), "UNSAFE_PATH", "Git storage must contain only directories and regular files.");
      if (item.isDirectory()) await this.checkStorage(join(path, item.name));
    }
  }
  private async fetch(project: Project, repo: Repository, initialize = false) {
    let path: string;
    if (initialize) {
      path = await this.checkOwner(project, repo);
      await this.checkStorage(path);
      await git(["init", "--bare", "--template=", path], this.root);
      const origin = await git([`--git-dir=${path}`, "remote", "get-url", "origin"], this.root, true);
      if (origin.code !== 0) await git([`--git-dir=${path}`, "remote", "add", "origin", repo.url], this.root);
      else requireThat(origin.output.trim() === repo.url, "CONFLICT", "Git origin differs from the registered source.");
    } else path = await this.checkBare(project, repo);
    await git([`--git-dir=${path}`, "fetch", "--no-tags", "origin", "+refs/heads/*:refs/remotes/origin/*"], this.root);
    const refs = (await git([`--git-dir=${path}`, "ls-remote", "--symref", "origin", "HEAD"], this.root)).output;
    const branch = /^ref: refs\/heads\/([^\t\n]+)\tHEAD$/m.exec(refs)?.[1];
    requireThat(branch, "EMPTY_REPOSITORY", "The remote has no usable default branch. Create its first commit or set its default branch, then retry.");
    await refName(branch, this.root);
    await git([`--git-dir=${path}`, "rev-parse", "--verify", `refs/remotes/origin/${branch}^{commit}`], this.root);
    repo.defaultBranch = branch; repo.phase = "ready"; delete repo.error;
  }
  async repoAdd(projectId: string, id: string, source: string) {
    identifier(id); const url = remoteUrl(source);
    return locked(this.root, "repo add", async () => {
      const project = await this.project(projectId);
      const existing = Object.hasOwn(project.repositories, id) ? project.repositories[id] : undefined;
      requireThat(!existing || existing.url === url, "CONFLICT", "This repository ID is already registered with another source.");
      const repo: Repository = existing ?? { id, url, phase: "pending" };
      const path = await this.repoPath(projectId, id);
      if (await exists(path)) await this.checkOwner(project, repo);
      if (existing?.phase === "ready") { await this.checkBare(project, repo); return { ...repo, path, changed: false }; }
      project.repositories[id] = repo; await this.save(project);
      try {
        if (!await exists(path)) { await directory(this.root, path); await saveJson(this.root, await safePath(this.root, path, "koto-owner.json"), this.owner(project, repo)); }
        await this.fetch(project, repo, true); await this.save(project);
      } catch (error) { repo.error = error instanceof MonorepoError ? error.code : "IO_ERROR"; await this.save(project); throw error; }
      return { ...repo, path, changed: true };
    });
  }
  async repoSync(projectId: string, id: string) {
    return locked(this.root, "repo sync", async () => {
      const project = await this.project(projectId), repo = this.repository(project, id);
      requireThat(repo.phase === "ready", "INCOMPLETE", "Repository creation is incomplete. Repeat repo add with the same input.");
      try { await this.fetch(project, repo); await this.save(project); }
      catch (error) { repo.error = error instanceof MonorepoError ? error.code : "IO_ERROR"; await this.save(project); throw error; }
      return { ...repo, path: await this.repoPath(projectId, id) };
    });
  }
  async repoList(projectId: string) {
    const project = await this.project(projectId);
    return { project: projectId, repositories: await Promise.all(Object.values(project.repositories).map(async repo => ({ ...repo, path: await this.repoPath(projectId, repo.id) }))) };
  }
  async repoShow(projectId: string, id: string) {
    const project = await this.project(projectId), repo = this.repository(project, id);
    return { ...repo, project: projectId, path: await this.repoPath(projectId, id) };
  }
  async repoRemove(projectId: string, id: string) {
    identifier(id);
    return locked(this.root, "repo remove", async () => {
      const project = await this.project(projectId);
      if (!Object.hasOwn(project.repositories, id)) return { id, changed: false, dataDeleted: false };
      const repo = this.repository(project, id);
      requireThat(!Object.values(project.workspaces).some(workspace => workspace.repositories.some(entry => entry.repositoryId === id)), "IN_USE", "A workspace still uses this repository. Its registration and data were retained.");
      const path = await this.repoPath(projectId, id);
      if (await exists(path)) {
        await this.checkOwner(project, repo);
        await this.checkStorage(path);
        if (await exists(await safePath(this.root, path, "HEAD"))) {
          const listed = await worktrees(path, this.root);
          requireThat(listed.every(entry => entry.bare), "IN_USE", "Git still has linked worktrees for this repository.");
        }
      }
      delete project.repositories[id]; await this.save(project);
      return { id, changed: true, dataDeleted: false, retainedPath: path };
    });
  }
  private async checkWorktree(project: Project, workspace: Workspace, entry: Worktree) {
    const repo = this.repository(project, entry.repositoryId), bare = await this.checkBare(project, repo);
    const path = await this.workspacePath(project.id, workspace.id, repo.id);
    requireThat(await exists(path), "MISSING_WORKTREE", "The recorded worktree directory is missing.");
    const dotGit = await safePath(this.root, path, ".git");
    const pointer = /^gitdir: (.+)\n?$/.exec(await readFile(dotGit, "utf8"))?.[1];
    requireThat(pointer, "INVALID_WORKTREE", "Expected a linked worktree .git file.");
    const gitDirectory = resolve(path, pointer), expectedParent = join(bare, "worktrees");
    const rel = relative(expectedParent, gitDirectory);
    requireThat(rel.length > 0 && rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep), "INVALID_WORKTREE", "The worktree points outside its registered repository.");
    await safePath(this.root, gitDirectory);
    const commonFile = await safePath(this.root, gitDirectory, "commondir");
    requireThat(resolve(gitDirectory, (await readFile(commonFile, "utf8")).trim()) === bare, "INVALID_WORKTREE", "Worktree common directory does not match its repository.");
    const backPointer = await safePath(this.root, gitDirectory, "gitdir");
    requireThat(resolve(gitDirectory, (await readFile(backPointer, "utf8")).trim()) === dotGit, "INVALID_WORKTREE", "Worktree Git registration points to another directory.");
    const listed = (await worktrees(bare, this.root)).find(item => item.path === path);
    requireThat(listed && listed.branch === `refs/heads/${entry.branch}`, "CONFLICT", "The worktree branch or Git registration differs from its recorded state.");
    return { repo, bare, path, gitDirectory, locked: listed.locked };
  }
  async workspaceCreate(projectId: string, taskId: string, repositoryIds: string[], branchInput?: string, baseInput?: string) {
    identifier(taskId); repositoryIds.forEach(identifier);
    requireThat(repositoryIds.length > 0 && new Set(repositoryIds).size === repositoryIds.length, "INVALID_INPUT", "Specify one or more distinct --repo IDs.");
    const ids = [...repositoryIds].sort(), branch = await refName(branchInput ?? `koto/${taskId}`, this.root);
    if (baseInput) await refName(baseInput, this.root);
    return locked(this.root, "workspace create", async () => {
      const project = await this.project(projectId);
      let workspace = Object.hasOwn(project.workspaces, taskId) ? project.workspaces[taskId] : undefined;
      if (workspace) {
        requireThat(!workspace.removal, "REMOVAL_IN_PROGRESS", "Workspace removal is in progress. Repeat workspace remove to finish it.");
        requireThat(JSON.stringify(workspace.repositories.map(entry => entry.repositoryId).sort()) === JSON.stringify(ids) && workspace.repositories.every(entry => entry.branch === branch && (!baseInput || entry.base === baseInput)), "CONFLICT", "This task ID already has a different repository, branch or base selection.");
      } else {
        const entries: Worktree[] = [];
        for (const id of ids) {
          const repo = this.repository(project, id);
          requireThat(repo.phase === "ready", "INCOMPLETE", "A selected repository is not ready.");
          const bare = await this.checkBare(project, repo), base = baseInput ?? repo.defaultBranch!;
          await refName(base, this.root);
          const path = await this.workspacePath(projectId, taskId, id);
          requireThat(!await exists(path), "CONFLICT", "The destination already exists and is not registered to this task.");
          const occupied = await git([`--git-dir=${bare}`, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], this.root, true);
          requireThat(occupied.code === 1, "CONFLICT", "The requested work branch already exists or cannot be inspected.");
          const commit = (await git([`--git-dir=${bare}`, "rev-parse", "--verify", `refs/remotes/origin/${base}^{commit}`], this.root)).output.trim();
          entries.push({ repositoryId: id, branch, base, commit, phase: "pending" });
        }
        workspace = { id: taskId, repositories: entries };
        project.workspaces[taskId] = workspace; await this.save(project);
      }
      for (const entry of workspace.repositories) {
        try {
          const repo = this.repository(project, entry.repositoryId), bare = await this.checkBare(project, repo);
          const path = await this.workspacePath(projectId, taskId, repo.id), listed = await worktrees(bare, this.root);
          if (listed.some(item => item.path === path)) await this.checkWorktree(project, workspace, entry);
          else {
            requireThat(entry.phase === "pending", "MISSING_WORKTREE", "A completed worktree is missing. It will not be recreated automatically.");
            requireThat(!await exists(path), "CONFLICT", "The worktree destination exists but is not registered by Git.");
            requireThat(!listed.some(item => item.branch === `refs/heads/${entry.branch}`), "CONFLICT", "The work branch is already checked out elsewhere.");
            await directory(this.root, dirname(path));
            const branchState = await git([`--git-dir=${bare}`, "show-ref", "--verify", "--quiet", `refs/heads/${entry.branch}`], this.root, true);
            if (branchState.code === 0) {
              const tip = (await git([`--git-dir=${bare}`, "rev-parse", `refs/heads/${entry.branch}`], this.root)).output.trim();
              requireThat(tip === entry.commit, "CONFLICT", "The interrupted work branch has changed. Existing data was retained.");
              await git([`--git-dir=${bare}`, "worktree", "add", path, entry.branch], this.root);
            } else {
              requireThat(branchState.code === 1, "GIT_FAILED", "The work branch cannot be inspected.");
              await git([`--git-dir=${bare}`, "worktree", "add", "--no-track", "-b", entry.branch, path, entry.commit], this.root);
            }
            await this.checkWorktree(project, workspace, entry);
          }
          entry.phase = "ready"; delete entry.error; await this.save(project);
        } catch (error) {
          entry.error = error instanceof MonorepoError ? error.code : "IO_ERROR"; await this.save(project);
          throw new MonorepoError("PARTIAL_FAILURE", "Workspace creation is incomplete. Repeat the same command after resolving the reported error; completed worktrees were retained.", { cause: entry.error, workspace: workspace.id, repositories: workspace.repositories.map(item => ({ repositoryId: item.repositoryId, phase: item.phase, error: item.error })) });
        }
      }
      const result = await this.describeWorkspace(project, workspace);
      requireThat(result.ready, "INCOMPLETE", "Worktrees were created but their current state could not be verified. Run workspace show or doctor.");
      return result;
    });
  }
  private async describeWorkspace(project: Project, workspace: Workspace) {
    const repositories = [];
    for (const entry of workspace.repositories) {
      try {
        const { path, bare } = await this.checkWorktree(project, workspace, entry);
        const head = (await git(["-C", path, "rev-parse", "HEAD"], this.root)).output.trim();
        const modified = changes((await git(["-C", path, "status", "--porcelain=v1", "-z", "--untracked-files=all"], this.root)).output);
        const distance = await git([`--git-dir=${bare}`, "rev-list", "--left-right", "--count", `refs/remotes/origin/${entry.base}...${head}`], this.root, true);
        const [behind, ahead] = distance.code === 0 ? distance.output.trim().split(/\s+/).map(Number) : [];
        repositories.push({ ...entry, path, observed: "ready", head, dirty: modified.length > 0, changes: modified, baseDistance: distance.code === 0 ? { behind, ahead } : null });
      } catch (error) {
        repositories.push({ ...entry, path: join(this.root, "workspaces", project.id, workspace.id, entry.repositoryId), observed: "unavailable", problem: error instanceof MonorepoError ? error.code : "IO_ERROR" });
      }
    }
    return { id: workspace.id, project: project.id, removing: !!workspace.removal, ready: !workspace.removal && repositories.every(entry => entry.phase === "ready" && entry.observed === "ready"), repositories };
  }
  private async cleanWorktree(project: Project, workspace: Workspace, entry: Worktree) {
    const observed = await this.checkWorktree(project, workspace, entry), path = observed.path;
    requireThat(!observed.locked, "WORKTREE_LOCKED", "Git has locked this worktree. Resolve its active use before removing it.");
    for (const operation of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD", "BISECT_START", "rebase-apply", "rebase-merge", "sequencer"]) {
      requireThat(!await exists(await safePath(this.root, observed.gitDirectory, operation)), "GIT_OPERATION_IN_PROGRESS", "A Git operation is still in progress.", { operation });
    }
    const flags = (await git(["-C", path, "ls-files", "-v", "-z"], this.root)).output.split("\0").filter(line => /^[a-zS] /.test(line));
    requireThat(flags.length === 0, "HIDDEN_INDEX_CHANGES", "Index flags can hide file changes. Clear assume-unchanged or skip-worktree flags before removal.");
    const staged = (await git(["-C", path, "ls-files", "--stage", "-z"], this.root)).output;
    requireThat(!staged.split("\0").some(line => line.startsWith("160000 ")), "SUBMODULE_WORKTREE", "Worktrees containing submodules are not removed by this command.");
    const modified = changes((await git(["-C", path, "-c", "core.untrackedCache=false", "-c", "core.ignoreStat=false", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--ignore-submodules=none"], this.root)).output);
    requireThat(modified.length === 0, "UNSAVED_FILES", "The worktree contains modified, untracked or ignored files.", { changes: modified });
    return (await git(["-C", path, "rev-parse", "HEAD"], this.root)).output.trim();
  }
  private async inspectRemoval(project: Project, workspace: Workspace, entry: Worktree): Promise<RemovalCheck> {
    const result: RemovalCheck = {
      repositoryId: entry.repositoryId, path: join(this.root, "workspaces", project.id, workspace.id, entry.repositoryId),
      branch: entry.branch, canRemove: false, alreadyRemoved: false,
    };
    try {
      const repo = this.repository(project, entry.repositoryId), bare = await this.checkBare(project, repo);
      const path = await this.workspacePath(project.id, workspace.id, entry.repositoryId);
      const recorded = workspace.removal?.[entry.repositoryId];
      const listed = await worktrees(bare, this.root);
      if (recorded && !await exists(path) && !listed.some(item => item.path === path)) {
        const retained = (await git([`--git-dir=${bare}`, "rev-parse", "--verify", `refs/heads/${entry.branch}^{commit}`], this.root)).output.trim();
        requireThat(retained === recorded && !listed.some(item => item.branch === `refs/heads/${entry.branch}`), "CONFLICT", "The branch retained by an interrupted removal has changed or is in use elsewhere.");
        return { ...result, head: retained, canRemove: true, alreadyRemoved: true };
      }
      requireThat(entry.phase === "ready", "INCOMPLETE", "Finish workspace creation before removing it.");
      const head = await this.cleanWorktree(project, workspace, entry);
      result.head = head;
      requireThat(!recorded || recorded === head, "CONFLICT", "The worktree HEAD changed after removal started.");
      await this.fetch(project, { ...repo });
      const remoteHeads = (await git([`--git-dir=${bare}`, "ls-remote", "--heads", "origin"], this.root)).output;
      let published = false;
      for (const line of remoteHeads.trim().split("\n").filter(Boolean)) {
        const [commit, ref] = line.split(/\s+/);
        requireThat(commit && /^[0-9a-f]{40,64}$/.test(commit) && ref?.startsWith("refs/heads/"), "GIT_FAILED", "Cannot verify the remote branches.");
        const ancestor = await git([`--git-dir=${bare}`, "merge-base", "--is-ancestor", head, commit], this.root, true);
        requireThat(ancestor.code === 0 || ancestor.code === 1, "GIT_FAILED", "Remote history changed during verification. Retry after syncing.");
        if (ancestor.code === 0) { published = true; break; }
      }
      requireThat(published, "UNPUBLISHED_COMMITS", "HEAD is not contained in a current origin branch. Save its commits remotely before removal.");
      requireThat(await this.cleanWorktree(project, workspace, entry) === head, "CONFLICT", "The worktree changed while its remote history was being verified.");
      return { ...result, canRemove: true };
    } catch (error) {
      const problem = error instanceof MonorepoError ? error : new MonorepoError("IO_ERROR", "Cannot verify the worktree for removal.");
      return { ...result, problem: problem.code, message: problem.message, details: problem.details };
    }
  }
  async workspaceRemove(projectId: string, id: string, dryRun = false) {
    identifier(id);
    return locked(this.root, "workspace remove", async () => {
      const project = await this.project(projectId);
      const workspace = Object.hasOwn(project.workspaces, id) ? project.workspaces[id] : undefined;
      if (!workspace) return { id, project: projectId, dryRun, canRemove: true, changed: false, repositories: [] };
      const repositories: RemovalCheck[] = [];
      for (const entry of workspace.repositories) repositories.push(await this.inspectRemoval(project, workspace, entry));
      const plan = { id, project: projectId, dryRun, canRemove: repositories.every(item => item.canRemove), changed: false, repositories };
      if (dryRun) return plan;
      if (!plan.canRemove) throw new MonorepoError("CLEANUP_BLOCKED", "Workspace removal is blocked. No remaining worktrees were removed.", plan);
      if (!workspace.removal) {
        workspace.removal = Object.fromEntries(repositories.map(item => [item.repositoryId, item.head!]));
        await this.save(project);
      }
      for (const entry of workspace.repositories) {
        try {
          const checked = await this.inspectRemoval(project, workspace, entry);
          if (!checked.canRemove) throw new MonorepoError(checked.problem!, checked.message!, checked.details);
          if (checked.alreadyRemoved) continue;
          const bare = await this.repoPath(projectId, entry.repositoryId);
          await git([`--git-dir=${bare}`, "worktree", "remove", checked.path], this.root);
          requireThat(!await exists(await safePath(this.root, checked.path)) && !(await worktrees(bare, this.root)).some(item => item.path === checked.path), "INCOMPLETE", "Git has not finished removing this worktree.");
        } catch (error) {
          throw new MonorepoError("PARTIAL_FAILURE", "Workspace removal is incomplete. Resolve the reported issue and repeat workspace remove; retained branches preserve commit history.", {
            workspace: id, repositoryId: entry.repositoryId, cause: error instanceof MonorepoError ? error.code : "IO_ERROR",
          });
        }
      }
      delete project.workspaces[id]; await this.save(project);
      const parent = await safePath(this.root, "workspaces", projectId, id);
      let parentRetained = false;
      try { await rmdir(parent); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") parentRetained = true;
      }
      return { ...plan, changed: true, parentRetained, retainedBranches: repositories.map(item => ({ repositoryId: item.repositoryId, branch: item.branch, head: item.head })) };
    });
  }
  async workspaceShow(projectId: string, id: string) {
    identifier(id); const project = await this.project(projectId);
    requireThat(Object.hasOwn(project.workspaces, id), "WORKSPACE_NOT_FOUND", `Workspace '${id}' does not exist in '${projectId}'.`);
    return this.describeWorkspace(project, project.workspaces[id]!);
  }
  async workspaceList(projectId: string) {
    const project = await this.project(projectId);
    const workspaces = [];
    for (const workspace of Object.values(project.workspaces)) workspaces.push(await this.describeWorkspace(project, workspace));
    return { project: projectId, workspaces };
  }
  async status(projectId: string) {
    const project = await this.project(projectId), repositories = [];
    for (const repo of Object.values(project.repositories)) {
      try { const path = await this.checkBare(project, repo); repositories.push({ ...repo, path, observed: "ready" }); }
      catch (error) { repositories.push({ ...repo, observed: "unavailable", problem: error instanceof MonorepoError ? error.code : "IO_ERROR" }); }
    }
    const workspaces = [];
    for (const workspace of Object.values(project.workspaces)) workspaces.push(await this.describeWorkspace(project, workspace));
    return { root: this.root, project: projectId, locked: await exists(await safePath(this.root, ".space/monorepo.lock")), repositories, workspaces };
  }
  async doctor(projectId: string) {
    const version = (await git(["--version"], this.root)).output.trim();
    const status = await this.status(projectId);
    const healthy = !status.locked && status.repositories.every(repo => repo.phase === "ready" && repo.observed === "ready" && !repo.error) && status.workspaces.every(workspace => workspace.ready && workspace.repositories.every(entry => !entry.error));
    return { ...status, git: version, healthy };
  }
}
