import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { hasCode } from "./files.ts";
import { searchDocument, type Concept } from "./frontmatter.ts";
import { createSearchIndex, type SearchOptions, type SearchResult } from "./search.ts";

const magic = /[*?[{]/;
function clean(value: string): string {
  if (!value.trim() || value.startsWith("/") || /[\\:\u0000-\u001f\u007f]/.test(value) || value.split("/").includes("..")) throw new Error("Code paths must be relative to --root, without '..' or backslashes.");
  return posix.normalize(value.replace(/^\.\//, "")).replace(/\/$/, "");
}
export function projectPath(value: string, project: string): string {
  const [area, selected] = value.split("/");
  if (![".space", "workspaces", "repositories"].includes(area ?? "") || selected !== project) throw new Error(`Code reference must be inside .space/${project}, workspaces/${project} or repositories/${project}; project segments cannot contain globs.`);
  return value;
}
export async function codePath(root: string, input: string, project = "default"): Promise<string> {
  if (!isAbsolute(input)) return projectPath(clean(input), project);
  const bases = [resolve(root), await realpath(resolve(root))];
  for (const base of bases) {
    const candidate = relative(base, input);
    if (candidate && candidate !== ".." && !candidate.startsWith(`..${sep}`) && !isAbsolute(candidate)) return projectPath(clean(candidate.split(sep).join("/")), project);
  }
  throw new Error("--for-path must be inside the monorepo specified by --root.");
}
export function matchCodeRef(ref: string, target: string): boolean {
  ref = clean(ref); target = clean(target);
  if (magic.test(ref)) return new Bun.Glob(ref).match(target);
  return ref === target || target.startsWith(`${ref}/`);
}

export async function codeRefExists(root: string, ref: string, project = "default"): Promise<boolean> {
  const normalized = projectPath(clean(ref), project), base = await realpath(resolve(root));
  async function inspect(path: string) {
    let current = base;
    for (const part of path.split("/")) {
      if (!part || part === ".") continue;
      if (!(await readdir(current)).includes(part)) return undefined;
      current = join(current, part);
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) return undefined;
    }
    return await lstat(current);
  }
  try {
    if (!magic.test(normalized)) { const stat = await inspect(normalized); return !!stat && (stat.isFile() || stat.isDirectory()); }
    const pattern = new Bun.Glob(normalized), prefix = normalized.split("/").slice(0, normalized.split("/").findIndex(part => magic.test(part))).join("/");
    const start = await inspect(prefix);
    if (!start?.isDirectory()) return false;
    let visited = 0;
    async function walk(directory: string, depth: number): Promise<boolean> {
      if (++visited > 100_000 || depth > 128) throw new Error("Code reference scan exceeds 100,000 paths or 128 directories in depth.");
      const stat = await inspect(directory);
      if (!stat) return false;
      if (directory && (stat.isFile() || stat.isDirectory()) && pattern.match(directory)) return true;
      if (!stat.isDirectory()) return false;
      for (const name of (await readdir(join(base, directory))).sort()) if (await walk(directory ? `${directory}/${name}` : name, depth + 1)) return true;
      return false;
    }
    return await walk(prefix, 0);
  } catch (error) { if (hasCode(error, "ENOENT") || hasCode(error, "ENOTDIR")) return false; throw error; }
}

export interface PathSearchResult extends Omit<SearchResult, "matched_on"> { matched_on: string[]; code_refs: string[] }
export function searchForPath(concepts: Concept[], target: string, query: string, options: SearchOptions = {}): PathSearchResult[] {
  const documents = concepts.map(concept => { try { return searchDocument(concept); } catch (error) { throw new Error(`${concept.path}: ${error instanceof Error ? error.message : String(error)}`); } });
  const index = createSearchIndex(documents);
  index.search("", options);
  const scores = new Map(index.search(query, { all: true }).map(result => [result.concept_id, result]));
  const rank = { hold: 0, constraint: 1, context: 2 }, result: PathSearchResult[] = [];
  for (const [i, concept] of concepts.entries()) {
    const refs = concept.metadata.code_refs as string[] | undefined, document = documents[i];
    if (!document || options.type !== undefined && document.type !== options.type || !refs?.some(ref => matchCodeRef(ref, target))) continue;
    const text = scores.get(concept.id);
    result.push({ concept_id: concept.id, title: document.title, description: document.description, type: document.type, governance: document.governance ?? "context", score: (text?.score ?? 0) + (refs.some(ref => clean(ref) === target) ? 2 : 0), matched_on: ["code_refs", ...(text?.matched_on ?? [])], code_refs: [...refs], ...(document.tags ? { tags: [...document.tags] } : {}) });
  }
  result.sort((a, b) => rank[a.governance] - rank[b.governance] || b.score - a.score || (a.concept_id < b.concept_id ? -1 : a.concept_id > b.concept_id ? 1 : 0));
  return options.all ? result : result.slice(0, Math.min(options.limit ?? 10, 100));
}
