import type { ProjectFiles } from "./files.ts";
import { parseDocument, typeDirectories, type Concept } from "./frontmatter.ts";

export function validateConceptId(id: string): void {
  const parts = id.split("/"), first = parts[0], last = parts.at(-1);
  if (parts.length < 2 || !Object.values(typeDirectories).some(dir => dir === first)
    || parts.some(part => !part || part === "." || part === ".." || part.startsWith(".") || part === "node_modules")
    || /[\\:\u0000-\u001f\u007f]/.test(id) || id.endsWith(".md") || /^(index|log|agents)$/i.test(last ?? "")) {
    throw new Error("Invalid concept ID: use a type directory and a relative name without '.md'; navigation documents are reserved.");
  }
}

export async function readConcept(files: ProjectFiles, id: string): Promise<Concept> {
  validateConceptId(id);
  const path = `${id}.md`, raw_content = await files.read(path);
  return { id, path, raw_content, ...parseDocument(raw_content) };
}

export async function collectDocuments(files: ProjectFiles, navigation = false) {
  const concepts = new Map<string, Concept>(), indexes = new Map<string, string>(), logs = new Map<string, string>(), errors = new Map<string, string>();
  function failure(path: string, error: unknown) { errors.set(path, error instanceof Error ? error.message : String(error)); }
  async function walk(directory: string): Promise<void> {
    let entries;
    try { entries = await files.entries(directory); } catch (error) { failure(directory, error); return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || /^agents\.md$/i.test(entry.name)) continue;
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) { failure(path, "Symbolic links are not supported."); continue; }
      if (entry.isDirectory()) { await walk(path); continue; }
      if (!entry.name.endsWith(".md")) continue;
      try {
        if (/^(index|log)\.md$/i.test(entry.name)) {
          if (navigation) (entry.name.toLowerCase() === "index.md" ? indexes : logs).set(path, await files.read(path));
        } else { const id = path.slice(0, -3); concepts.set(id, await readConcept(files, id)); }
      } catch (error) { failure(path, error); }
    }
  }
  if (navigation) for (const [path, target] of [["index.md", indexes], ["log.md", logs]] as const) {
    try { const raw = await files.optionalRead(path); if (raw !== undefined) target.set(path, raw); }
    catch (error) { failure(path, error); }
  }
  for (const directory of Object.values(typeDirectories)) await walk(directory);
  return { concepts, indexes, logs, errors };
}

export function requireReadable(documents: Awaited<ReturnType<typeof collectDocuments>>): void {
  if (documents.errors.size) throw new Error([...documents.errors].map(([path, error]) => `${path}: ${error}`).join("\n"));
}
