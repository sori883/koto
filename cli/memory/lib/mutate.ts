import { checkHash, contentHash } from "./errors.ts";
import { posix } from "node:path";
import { escapeText, encodePath, visibleLines, linkedPaths, unlinkTarget, buildGraph } from "./references.ts";
import { collectDocuments, readConcept, requireReadable } from "./documents.ts";
import { isDeepStrictEqual } from "node:util";
import { openProjectFiles, WriteError, type FileChange, type ProjectFiles } from "./files.ts";
import { parseDocument, searchDocument, serializeDocument, typeDirectories, validActor, type Concept, type Metadata } from "./frontmatter.ts";
import { requireInitialized, validateConceptId } from "./memory.ts";

export interface MutationOptions { ifHash?: string; actor?: string; unset?: readonly string[]; sync?: boolean; noIndex?: boolean; noLog?: boolean }
export interface MutationResult { status: "success"; changed_paths: string[]; unchanged: boolean; concept_id?: string; path?: string }
const rootIndex = '---\nokf_version: "0.2"\n---\n\n# Knowledge Base\n\n';
function listing(text: string, source: string, href: string, title: string, description?: string, preserveExisting = false): string {
  const visible = visibleLines(text, true);
  if (!visible.complete) throw new Error(`Unclosed code fence or HTML comment in ${source}.`);
  const row = `* [${escapeText(title)}](${encodePath(href)})${description ? ` - ${escapeText(description)}` : ""}`;
  const target = posix.normalize(posix.join(posix.dirname(source), href));
  const candidates = visible.lines.map((line, index) => ({ line, index })).filter(({ line }) => /^ {0,3}[-*] +/.test(line) && linkedPaths(line, source).includes(target));
  if (preserveExisting && candidates.length) return text;
  if (candidates.some(({ line }) => /^ {0,3}[-*] +\[/.test(line) && linkedPaths(line, source).length > 1)) throw new Error(`Ambiguous index entry with multiple links in ${source}.`);
  const entry = /^ {0,3}[-*] +\[(?:\\.|[^\]\\])*\]\(<?[^\s>]+?\.md(?:[?#][^\s>)]*)?>?(?:\s+"[^"]*")?\)(?:[ \t]*|[ \t]+-[ \t]+.*)$/;
  const index = candidates.find(({ line }) => entry.test(line))?.index ?? -1;
  if (index < 0) return `${text}${text.endsWith("\n") ? "" : "\n"}${row}\n`;
  const lines = text.split("\n");
  lines[index] = row + (lines[index]?.endsWith("\r") ? "\r" : "");
  return lines.join("\n");
}

function planner(files: ProjectFiles) {
  const changes = new Map<string, FileChange>();
  async function edit(relative: string, transform: (text: string | undefined) => string) {
    const existing = changes.get(relative);
    const before = existing ? existing.before : await files.optionalRead(relative);
    changes.set(relative, { relative, before, after: transform(existing ? existing.after ?? undefined : before) });
  }
  async function indexes(concept: Concept) {
    let directory = posix.dirname(concept.path);
    await edit(`${directory}/index.md`, text => listing(text ?? `# ${posix.basename(directory)}\n\n`, `${directory}/index.md`, posix.basename(concept.path), String(concept.metadata.title), String(concept.metadata.description)));
    while (directory !== ".") {
      const child = posix.basename(directory), parent = posix.dirname(directory);
      const index = parent === "." ? "index.md" : `${parent}/index.md`;
      await edit(index, text => listing(text ?? (parent === "." ? rootIndex : `# ${posix.basename(parent)}\n\n`), index, `${child}/index.md`, child, undefined, true));
      directory = parent;
    }
  }
  async function log(action: string, at: string, actor: string, concept?: Concept, detail?: string) {
    const subject = detail ?? (concept ? `[${escapeText(String(concept.metadata.title))}](${encodePath(concept.path)})` : "Initialized OKF v0.2 knowledge bundle");
    await edit("log.md", text => {
      const heading = `## ${at.slice(0, 10)}`;
      const entry = `* **${action}**: ${subject}. Actor: ${escapeText(actor)}. At: ${at}.`;
      const existing = visibleLines(text ?? "").lines.findIndex(line => line === heading);
      if (existing < 0) return `${heading}\n${entry}\n${text ? `\n${text}` : ""}`;
      const lines = (text ?? "").split("\n");
      lines.splice(existing + 1, 0, entry);
      return lines.join("\n");
    });
  }
  return { changes, edit, indexes, log };
}

function serialized(concept: Concept): string {
  searchDocument(concept);
  const raw = serializeDocument(concept), roundtrip = parseDocument(raw);
  if (!isDeepStrictEqual(roundtrip.metadata, concept.metadata) || roundtrip.body !== concept.body) throw new Error("Document cannot be serialized without changing its values.");
  return raw;
}

function optionsFor(options: MutationOptions) {
  const actor = options.actor ?? "agent/cli";
  if (!validActor(actor)) throw new Error("actor must be an identifier such as agent:codex.");
  if (options.sync && (options.noIndex || options.noLog)) throw new Error("--sync cannot be combined with --no-index or --no-log.");
  for (const key of options.unset ?? []) {
    if (!key || ["type", "title", "description", "generated"].includes(key)) throw new Error(`Cannot unset ${key || "an empty key"}.`);
  }
  return { ...options, actor };
}

export async function initMemory(root: string, project = "default", actor = "agent/cli"): Promise<MutationResult> {
  try {
    optionsFor({ actor });
    const files = await openProjectFiles(root, project, true);
    return await files.withWriteLock(async apply => {
      const current = await files.optionalRead("index.md");
      if (current !== undefined && parseDocument(current).metadata.okf_version !== "0.2") throw new Error('Existing index.md must declare okf_version: "0.2".');
      const plan = planner(files);
      await plan.edit("index.md", text => text ?? rootIndex);
      for (const directory of Object.values(typeDirectories)) {
        await plan.edit(`${directory}/index.md`, text => text ?? `# ${directory}\n\n`);
        await plan.edit("index.md", text => listing(text ?? rootIndex, "index.md", `${directory}/index.md`, directory, undefined, true));
      }
      if (await files.optionalRead("log.md") === undefined) await plan.log("Creation", new Date().toISOString(), actor);
      const changed_paths = await apply([...plan.changes.values()]);
      return { status: "success", changed_paths, unchanged: changed_paths.length === 0 };
    });
  } catch (error) { if (error instanceof WriteError) throw error; throw new WriteError(error, []); }
}

export async function saveConcept(command: "create" | "update", root: string, project: string, id: string, patch: Metadata, body: string | undefined, inputOptions: MutationOptions = {}): Promise<MutationResult> {
  try {
    validateConceptId(id);
    const options = optionsFor(inputOptions);
    if (Object.hasOwn(patch, "generated")) throw new Error("generated is automatic; use --actor.");
    if (command === "create" && (options.sync || options.unset?.length)) throw new Error("--sync and --unset require update.");
    const files = await openProjectFiles(root, project);
    return await files.withWriteLock(async apply => {
      await requireInitialized(files);
      const path = `${id}.md`;
      const before = await files.optionalRead(path);
      if (command === "create" && before !== undefined) throw new Error(`Concept already exists: ${id}`);
      if (command === "update" && before === undefined) throw new Error(`Concept not found: ${id}`);
      checkHash(before, options.ifHash);
      const previous = before === undefined ? { metadata: {}, body: "" } : parseDocument(before);
      const metadata = { ...previous.metadata, ...patch };
      for (const key of options.unset ?? []) delete metadata[key];
      const nextBody = body ?? previous.body;
      const unchanged = before !== undefined && isDeepStrictEqual(metadata, previous.metadata) && nextBody === previous.body;
      const at = new Date().toISOString();
      const finalMetadata = unchanged ? metadata : { ...metadata, generated: { by: options.actor, at } };
      const concept: Concept = { id, path, metadata: finalMetadata, body: nextBody, raw_content: before ?? "" };
      searchDocument(concept);
      if (unchanged && !options.sync) return { status: "success", concept_id: id, path, changed_paths: [], unchanged: true };
      const plan = planner(files);
      if (!unchanged) {
        const after = serialized(concept);
        plan.changes.set(path, { relative: path, before, after });
      }
      if (!options.noIndex) await plan.indexes(concept);
      if (!options.noLog) {
        const log = await files.optionalRead("log.md");
        const indexed = [...plan.changes.values()].some(change => change.before !== change.after);
        const logged = visibleLines(log ?? "").lines.some(line => linkedPaths(line, "log.md").includes(path));
        if (!unchanged || indexed || !logged) await plan.log(unchanged ? "Synchronization" : command === "create" ? "Creation" : "Update", at, options.actor, concept);
      }
      const changed_paths = await apply([...plan.changes.values()]);
      return { status: "success", concept_id: id, path, changed_paths, unchanged: changed_paths.length === 0 };
    });
  } catch (error) { if (error instanceof WriteError) throw error; throw new WriteError(error, []); }
}

export async function relateConcepts(root: string, project: string, source: string, target: string, description = "", inputOptions: Pick<MutationOptions, "actor" | "noIndex" | "noLog" | "ifHash"> = {}): Promise<MutationResult> {
  try {
    validateConceptId(source); validateConceptId(target);
    if (source === target) throw new Error("Cannot relate a concept to itself.");
    const options = optionsFor(inputOptions), files = await openProjectFiles(root, project);
    return await files.withWriteLock(async apply => {
      await requireInitialized(files);
      const from = await readConcept(files, source), to = await readConcept(files, target);
      checkHash(from.raw_content, options.ifHash);
      searchDocument(from); searchDocument(to);
      const visible = visibleLines(from.body);
      if (!visible.complete) throw new Error(`Cannot safely append to unclosed Markdown in ${from.path}.`);
      const href = posix.relative(posix.dirname(from.path), to.path);
      const row = `- [${escapeText(String(to.metadata.title))}](${encodePath(href)})${description.trim() ? `: ${escapeText(description.trim())}` : ""}`;
      if (visible.lines.some(line => line.trim() === row)) return { status: "success", concept_id: source, path: from.path, changed_paths: [], unchanged: true };
      const lines = from.body.split("\n"), start = visible.lines.findIndex(line => /^# Related(?: Concepts)?\s*$/.test(line));
      let body: string;
      if (start >= 0) {
        const end = visible.lines.findIndex((line, index) => index > start && /^# /.test(line));
        if (end < 0) body = `${from.body}${from.body.endsWith("\n") ? "" : "\n"}${row}\n`;
        else { lines.splice(end, 0, row); body = lines.join("\n"); }
      } else body = `${from.body}${from.body.endsWith("\n") ? "\n" : "\n\n"}# Related Concepts\n${row}\n`;
      const at = new Date().toISOString(), concept = { ...from, body, metadata: { ...from.metadata, generated: { by: options.actor, at } } };
      const plan = planner(files);
      plan.changes.set(from.path, { relative: from.path, before: from.raw_content, after: serialized(concept) });
      if (!options.noIndex) await plan.indexes(concept);
      if (!options.noLog) await plan.log("Relationship", at, options.actor, concept);
      const changed_paths = await apply([{ relative: to.path, before: to.raw_content, after: to.raw_content }, ...plan.changes.values()]);
      return { status: "success", concept_id: source, path: from.path, changed_paths, unchanged: false };
    });
  } catch (error) { if (error instanceof WriteError) throw error; throw new WriteError(error, []); }
}

export interface DeleteResult {
  content_hash: string; status: "preview" | "success"; concept_id: string; path: string; changed_paths: string[]; updated_concepts: string[];
  removed_relations: { source: string; target: string }[]; new_orphans: string[];
}
export async function deleteConcept(root: string, project: string, id: string, options: { actor?: string; dryRun?: boolean; ifHash?: string } = {}): Promise<DeleteResult> {
  try {
    validateConceptId(id);
    const { actor } = optionsFor(options), files = await openProjectFiles(root, project);
    async function planDeletion() {
      await requireInitialized(files);
      const documents = await collectDocuments(files, true); requireReadable(documents);
      const target = documents.concepts.get(id);
      if (!target) throw new Error(`Concept not found: ${id}`);
      checkHash(target.raw_content, options.ifHash);
      const beforeGraph = buildGraph(documents.concepts, documents.indexes), remaining = new Map(documents.concepts), plan = planner(files);
      remaining.delete(id);
      const updated: string[] = [], at = new Date().toISOString();
      for (const concept of remaining.values()) {
        const body = unlinkTarget(concept.body, concept.path, target.path, "concept");
        if (body === concept.body) continue;
        const next = { ...concept, body, metadata: { ...concept.metadata, generated: { by: actor, at } } };
        plan.changes.set(concept.path, { relative: concept.path, before: concept.raw_content, after: serialized(next) });
        remaining.set(concept.id, next); updated.push(concept.id);
      }
      for (const [path, before] of documents.indexes) {
        const after = unlinkTarget(before, path, target.path, "index");
        if (after !== before) plan.changes.set(path, { relative: path, before, after });
      }
      for (const [path, before] of documents.logs) {
        const after = unlinkTarget(before, path, target.path, "log");
        if (after !== before) plan.changes.set(path, { relative: path, before, after });
      }
      await plan.log("Deletion", at, actor, undefined, `${escapeText(id)} (${escapeText(String(target.metadata.title ?? id))}); unlinked concepts: ${updated.map(escapeText).join(", ") || "none"}`);
      const log = plan.changes.get("log.md");
      if (!log) throw new Error("Missing deletion log plan.");
      plan.changes.delete("log.md");
      const changes: FileChange[] = [...plan.changes.values(), { relative: target.path, before: target.raw_content, after: null }, log];
      const removed_relations = [...beforeGraph.outbound].flatMap(([source, targets]) => targets.filter(destination => source === id || destination === id).map(target => ({ source, target })));
      const afterGraph = buildGraph(remaining, new Map());
      const result: DeleteResult = { content_hash: contentHash(target.raw_content), status: options.dryRun ? "preview" : "success", concept_id: id, path: target.path, changed_paths: changes.map(change => change.relative), updated_concepts: updated.sort(), removed_relations, new_orphans: afterGraph.orphans.filter(id => !beforeGraph.orphans.includes(id)) };
      return { changes, result };
    }
    if (options.dryRun) return (await planDeletion()).result;
    return await files.withWriteLock(async apply => { const plan = await planDeletion(); await apply(plan.changes); return plan.result; });
  } catch (error) { if (error instanceof WriteError) throw error; throw new WriteError(error, []); }
}
