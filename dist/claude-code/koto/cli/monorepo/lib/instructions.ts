import { createHash } from "node:crypto";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { directory, exists, rootPath, safePath, saveJson } from "./files.ts";
import { MonorepoError, requireThat } from "./model.ts";

const products = { codex: "AGENTS.md", "claude-code": "CLAUDE.md" } as const;
type Product = keyof typeof products;
interface State { schemaVersion: 1; rootId: string; projectId: string; target: string; product: Product; source: string; blockHash: string }
interface Pending { schemaVersion: 1; beforeHash: string | null; beforeStateHash: string | null; content: string; mode: number; state: State }
interface Context { root: string; rootId: string; project: string; target: string; source: string; product: Product; file: string; statePath: string; pendingPath: string }
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const digest = (value: Buffer | null) => value === null ? null : hash(value);
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const markers = (product: Product) => ({ start: `<!-- koto:setup:koto:${product}:start -->`, end: `<!-- koto:setup:koto:${product}:end -->` });
const hex = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

async function optional(root: string, path: string): Promise<Buffer | null> {
  await safePath(root, path);
  try {
    requireThat((await lstat(path)).isFile(), "UNSAFE_PATH", "Expected a regular file.");
    return await readFile(path);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
function utf8(value: Buffer) {
  const text = value.toString("utf8");
  requireThat(Buffer.from(text).equals(value), "CONFLICT", "Instruction files and templates must be valid UTF-8.");
  return text;
}
function block(text: string, product: Product) {
  const { start, end } = markers(product), from = text.indexOf(start), ending = text.indexOf(end);
  const tokens = text.match(/(?:koto|agent-gear):setup:/g) ?? [];
  if (from < 0 && ending < 0 && tokens.length === 0) return { value: null, from: -1, to: -1 };
  requireThat(from >= 0 && ending > from && tokens.length === 2 && text.indexOf(start, from + 1) < 0 && text.indexOf(end, ending + 1) < 0, "CONFLICT", "The managed block markers are missing, duplicated, or belong to another setup.");
  const to = ending + end.length;
  return { value: text.slice(from, to), from, to };
}
function parse(raw: Buffer): Record<string, unknown> {
  try {
    const value = JSON.parse(utf8(raw));
    requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_STATE", "Invalid instruction management record.");
    return value;
  } catch (error) { if (error instanceof MonorepoError) throw error; throw new MonorepoError("INVALID_STATE", "Invalid instruction management JSON."); }
}
function state(value: unknown, ctx: Context): State {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_STATE", "Invalid instruction state.");
  const s = value as Record<string, unknown>;
  requireThat(s.schemaVersion === 1 && s.rootId === ctx.rootId && s.projectId === ctx.project && s.target === ctx.target && s.product === ctx.product && typeof s.source === "string" && isAbsolute(s.source) && hex(s.blockHash), "INVALID_STATE", "Instruction state belongs to another context or format.");
  return s as unknown as State;
}
async function context(root: string, rootId: string, project: string, target: string, product: string, source?: string): Promise<Context> {
  requireThat(Object.hasOwn(products, product), "INVALID_INPUT", "--product must be codex or claude-code.");
  requireThat(isAbsolute(target) && (source === undefined || isAbsolute(source)), "INVALID_INPUT", "--target and --source must be absolute directory paths.");
  target = resolve(target);
  const checkBoundary = async (path: string) => {
    const rel = relative(root, path), inside = rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
    if (!inside) return;
    await safePath(root, path);
    const parts = rel.split(sep);
    requireThat(![".space", "repositories"].includes(parts[0]!) && (parts[0] !== "workspaces" || parts[1] === project), "UNSAFE_PATH", "The target must not be management storage or another project's workspace.");
    requireThat(rel === "" || parts[0] === "workspaces" && parts[1] === project, "UNSAFE_PATH", "Within the management root, select the root itself or the selected project's workspaces directory.");
    requireThat(rel !== "" || project === "default", "UNSAFE_PATH", "Only default may place instructions at the shared management root; select this project's workspace directory instead.");
  };
  await checkBoundary(target);
  requireThat(await exists(target), "INVALID_PATH", "--target must name an existing directory.");
  requireThat(!(await lstat(target)).isSymbolicLink(), "UNSAFE_PATH", "The target directory must not be a symbolic link.");
  target = await rootPath(target); source = await rootPath(source ?? resolve(import.meta.dir, "../../.."));
  await checkBoundary(target);
  requireThat([root, target, source].every(path => !/[\x00-\x1f\x7f`]/.test(path)), "UNSAFE_PATH", "Instruction paths must not contain control characters or backticks.");
  const selected = product as Product;
  const statePath = await safePath(root, ".space", project, "instructions", hash(target), `${product}.json`);
  return { root, rootId, project, target, source, product: selected, statePath, pendingPath: statePath.replace(/\.json$/, ".pending.json"), file: await safePath(target, products[selected]) };
}
async function rendered(ctx: Context, newline: string) {
  const values: Record<string, string> = { CONTEXT: JSON.stringify({ root: ctx.root, project: ctx.project, target: ctx.target }, null, 2) };
  for (const name of ["devlow", "recall", "monorepo", "tasks", "memory", "tdd", "blast-radius", "interrogate"]) {
    const path = await safePath(ctx.source, "skills", name, "SKILL.md");
    requireThat((await optional(ctx.source, path)) !== null, "MISSING_SOURCE", `The koto source is missing the ${name} skill.`);
    values[name.toUpperCase().replaceAll("-", "_")] = path.split(sep).map(encodeURIComponent).join("/");
  }
  for (const name of ["monorepo", "tasks", "memory"]) requireThat((await optional(ctx.source, join(ctx.source, "cli", name, `${name}.ts`))) !== null, "MISSING_SOURCE", `The koto source is missing the ${name} CLI.`);
  const template = await optional(ctx.source, join(ctx.source, "templates/AGENTS.md"));
  requireThat(template !== null, "MISSING_SOURCE", "The koto source is missing templates/AGENTS.md.");
  const body = utf8(template).replaceAll(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => {
    requireThat(Object.hasOwn(values, key), "MISSING_SOURCE", `Unknown instruction template input: ${key}.`); return values[key]!;
  }).replaceAll("\r\n", "\n").trimEnd();
  requireThat(!body.includes("{{") && !/(?:koto|agent-gear):setup:/.test(body), "MISSING_SOURCE", "Invalid instruction template.");
  const { start, end } = markers(ctx.product);
  return `${start}\n${body}\n${end}`.replaceAll("\n", newline);
}
async function legacyHash(ctx: Context): Promise<string | null> {
  const raw = await optional(ctx.target, join(ctx.target, ".space/setup", `koto-${ctx.product}.json`));
  if (!raw) return null;
  const old = parse(raw);
  requireThat(old.schemaVersion === 1 && old.plugin === "koto" && old.product === ctx.product && Array.isArray(old.entries), "INVALID_STATE", "Invalid legacy setup record.");
  const entries = old.entries.filter(e => e && typeof e === "object" && e.destination === products[ctx.product]);
  requireThat(entries.length <= 1, "INVALID_STATE", "Duplicate legacy instruction record.");
  if (!entries.length) return null;
  requireThat(entries[0].mode === "managed-block" && hex(entries[0].hash), "INVALID_STATE", "Invalid legacy instruction hash.");
  return entries[0].hash;
}

async function inspect(ctx: Context, owned = new Set<string>()) {
  const current = await optional(ctx.target, ctx.file), rawState = await optional(ctx.root, ctx.statePath), rawPending = await optional(ctx.root, ctx.pendingPath);
  const saved = rawState ? state(parse(rawState), ctx) : null;
  const text = current === null ? "" : utf8(current), newline = text.includes("\r\n") ? "\r\n" : "\n";
  const desired = await rendered(ctx, newline), conflicts: string[] = [];
  const nextState: State = { schemaVersion: 1, rootId: ctx.rootId, projectId: ctx.project, target: ctx.target, product: ctx.product, source: ctx.source, blockHash: hash(desired) };
  const lockPaths = [join(ctx.root, ".space/monorepo.lock"), join(ctx.target, ".koto-instructions.lock"), join(ctx.target, ".space/setup/koto.lock"), join(ctx.target, ".space/setup/agent-gear.lock")];
  for (const path of lockPaths) if (!owned.has(path) && await exists(await safePath(path.startsWith(ctx.root + sep) ? ctx.root : ctx.target, path))) conflicts.push(`An operation holds ${path}.`);
  for (const plugin of ["koto", "agent-gear"]) for (const product of ["codex", "claude-code"]) {
    if (await exists(await safePath(ctx.target, ".space/setup", `${plugin}-${product}.pending.json`))) conflicts.push("Finish the pending legacy setup with its original version first.");
  }
  let existing: ReturnType<typeof block> = { value: null, from: -1, to: -1 };
  try { existing = block(text, ctx.product); }
  catch (error) { if (!(error instanceof MonorepoError)) throw error; conflicts.push(error.message); }
  let action = "unchanged", pending: Pending;
  if (rawPending) {
    const p = parse(rawPending);
    const next = state(p.state, ctx);
    requireThat(p.schemaVersion === 1 && (p.beforeHash === null || hex(p.beforeHash)) && (p.beforeStateHash === null || hex(p.beforeStateHash)) && typeof p.content === "string" && Number.isInteger(p.mode) && (p.mode as number) >= 0 && (p.mode as number) <= 0o777, "INVALID_STATE", "Invalid pending instruction update.");
    const contentBlock = block(p.content, ctx.product).value;
    requireThat(contentBlock !== null && hash(contentBlock) === next.blockHash, "INVALID_STATE", "Pending content does not match its instruction state.");
    pending = p as unknown as Pending;
    if (next.blockHash !== nextState.blockHash || next.source !== ctx.source) conflicts.push("The source or instructions changed during an interrupted update; retry with the original source.");
    if (![pending.beforeHash, hash(pending.content)].includes(digest(current))) conflicts.push("The instruction file changed after an interrupted update.");
    if (![pending.beforeStateHash, hash(json(next))].includes(digest(rawState))) conflicts.push("The management record changed after an interrupted update.");
    action = "resume";
  } else {
    const previousHash = saved?.blockHash ?? await legacyHash(ctx), currentHash = existing.value === null ? null : hash(existing.value);
    if (previousHash !== null && currentHash !== previousHash && currentHash !== nextState.blockHash) conflicts.push("The managed block was edited or deleted; existing content was retained.");
    if (previousHash === null && currentHash !== null && currentHash !== nextState.blockHash) conflicts.push("The existing block has no matching installation record.");
    const content = existing.value === null
      ? text + (text ? text.endsWith("\n") ? newline : newline + newline : "") + desired + newline
      : text.slice(0, existing.from) + desired + text.slice(existing.to);
    action = currentHash === nextState.blockHash ? saved?.blockHash === nextState.blockHash && saved.source === ctx.source ? "unchanged" : "adopt" : existing.value === null ? "create" : "update";
    pending = { schemaVersion: 1, beforeHash: digest(current), beforeStateHash: digest(rawState), content, mode: current === null ? 0o644 : (await lstat(ctx.file)).mode & 0o777, state: nextState };
  }
  return {
    result: { root: ctx.root, project: ctx.project, target: ctx.target, product: ctx.product, instructionFile: ctx.file, statePath: ctx.statePath,
      action, current: action === "unchanged" && conflicts.length === 0, canApply: conflicts.length === 0, pending: rawPending !== null, conflicts, block: desired },
    pending,
  };
}

async function targetLocked<T>(ctx: Context, action: (owned: Set<string>) => Promise<T>): Promise<T> {
  const owned = new Set([join(ctx.root, ".space/monorepo.lock")]);
  const handles: Array<{ path: string; handle: Awaited<ReturnType<typeof open>> }> = [];
  const paths = [join(ctx.target, ".koto-instructions.lock")];
  if (await exists(await safePath(ctx.target, ".space/setup"))) paths.push(join(ctx.target, ".space/setup/koto.lock"));
  try {
    for (const path of paths) {
      await safePath(ctx.target, path);
      let handle;
      try { handle = await open(path, "wx", 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new MonorepoError("LOCKED", `An operation holds ${path}. Confirm its process stopped before removing that lock.`); throw error; }
      handles.push({ path, handle }); owned.add(path);
      await handle.writeFile(json({ pid: process.pid, operation: "instructions apply", root: ctx.root, project: ctx.project, startedAt: new Date().toISOString() }));
    }
    return await action(owned);
  } finally {
    for (const { path, handle } of handles.reverse()) { await handle.close(); await rm(path, { force: true }); }
  }
}
async function replaceInstructions(ctx: Context, pending: Pending) {
  const before = await optional(ctx.target, ctx.file);
  if (digest(before) === hash(pending.content)) return;
  requireThat(digest(before) === pending.beforeHash, "CONFLICT", "The instruction file changed before replacement.");
  const temporary = join(ctx.target, `.koto-instructions-${crypto.randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", pending.mode);
    try { await handle.writeFile(pending.content); await handle.chmod(pending.mode); await handle.sync(); }
    finally { await handle.close(); }
    requireThat(digest(await optional(ctx.target, ctx.file)) === pending.beforeHash, "CONFLICT", "The instruction file changed during replacement.");
    await rename(temporary, ctx.file);
  } finally { await rm(temporary, { force: true }); }
}

export async function instructions(root: string, rootId: string, project: string, mode: string, target: string, product: string, source?: string) {
  const ctx = await context(root, rootId, project, target, product, source);
  if (mode !== "apply") return (await inspect(ctx)).result;
  return targetLocked(ctx, async owned => {
    const plan = await inspect(ctx, owned);
    if (!plan.result.canApply || plan.result.current) return plan.result;
    await directory(root, dirname(ctx.statePath));
    if (!plan.result.pending) await saveJson(root, ctx.pendingPath, plan.pending);
    try {
      await replaceInstructions(ctx, plan.pending);
      const now = digest(await optional(root, ctx.statePath));
      requireThat([plan.pending.beforeStateHash, hash(json(plan.pending.state))].includes(now), "CONFLICT", "The management record changed during replacement.");
      if (now !== hash(json(plan.pending.state))) await saveJson(root, ctx.statePath, plan.pending.state);
      await safePath(root, ctx.pendingPath); await rm(ctx.pendingPath);
    } catch (error) {
      throw new MonorepoError("PARTIAL_FAILURE", "The instruction update is incomplete. Inspect status and retry the same apply after resolving the cause.", { instructionFile: ctx.file, pendingPath: ctx.pendingPath, cause: error instanceof Error ? error.message : String(error) });
    }
    return { ...(await inspect(ctx, owned)).result, action: plan.result.action };
  });
}
