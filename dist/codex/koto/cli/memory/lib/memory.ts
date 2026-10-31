import { MissingPath, openProjectFiles, type ProjectFiles } from "./files.ts";
import { parseDocument, searchDocument, type Concept } from "./frontmatter.ts";
import { collectDocuments, requireReadable, readConcept, validateConceptId } from "./documents.ts";
export { validateConceptId } from "./documents.ts";
import { createSearchIndex, resultLimit, type SearchOptions, type SearchResult } from "./search.ts";
import { buildGraph, unsupportedLinks, visibleLines } from "./references.ts";
import { codePath, searchForPath, type PathSearchResult } from "./code-refs.ts";
import { matchesFilters, type MetadataFilter } from "./filter.ts";

export class MemoryReadError extends Error {}
export class ConceptNotFoundError extends Error {}
export interface MemorySearchOptions extends SearchOptions { forPath?: string; filters?: readonly MetadataFilter[] }
export interface ProjectMemory {
  show(id: string, options?: { relations?: boolean }): Promise<Concept & { inbound?: string[]; outbound?: string[] }>;
  search(query: string, options?: MemorySearchOptions): Promise<(SearchResult | PathSearchResult)[]>;
}

export async function requireInitialized(files: ProjectFiles): Promise<void> {
  await files.assertReady();
  const header = parseDocument(await files.read("index.md"));
  if (header.metadata.okf_version !== "0.2") throw new Error('memory/index.md must declare okf_version: "0.2".');
}

export async function openProjectMemory(root: string, project = "default"): Promise<ProjectMemory> {
  try {
    const files = await openProjectFiles(root, project);
    const memory = `.space/${project}/memory`;
    await requireInitialized(files);

    async function concept(id: string): Promise<Concept> {
      const relative = `${id}.md`;
      try {
        const result = await readConcept(files, id);
        searchDocument(result);
        return result;
      } catch (error) {
        if (error instanceof MissingPath) throw error;
        throw new Error(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    async function loadAll(): Promise<Concept[]> {
      const documents = await collectDocuments(files);
      requireReadable(documents);
      await requireInitialized(files);
      return [...documents.concepts.values()];
    }

    return Object.freeze({
      async show(id: string, options?: { relations?: boolean }) {
        validateConceptId(id);
        try {
          const result = await concept(id);
          if (!options?.relations) { await requireInitialized(files); return result; }
          const documents = await collectDocuments(files); requireReadable(documents);
          for (const c of documents.concepts.values()) if (!visibleLines(c.body).complete || unsupportedLinks(c.body).length) throw new Error(`${c.path}: cannot completely inspect relationships; use closed Markdown and inline links.`);
          const graph = buildGraph(documents.concepts, new Map());
          await requireInitialized(files);
          return { ...result, inbound: graph.inbound.get(id) ?? [], outbound: graph.outbound.get(id) ?? [] };
        }
        catch (error) {
          if (error instanceof MissingPath && error.relative.startsWith(`${memory}/`)) throw new ConceptNotFoundError(`Concept not found: ${id}`);
          throw new MemoryReadError(error instanceof Error ? error.message : String(error), { cause: error });
        }
      },
      async search(query: string, input: MemorySearchOptions = {}) {
        try {
          const { filters = [], forPath, ...options } = input;
          const limit = resultLimit(options);
          const documents = await loadAll();
          const selection: SearchOptions = filters.length ? { ...(options.type === undefined ? {} : { type: options.type }), all: true } : options;
          let results: (SearchResult | PathSearchResult)[];
          if (forPath !== undefined) results = searchForPath(documents, await codePath(root, forPath, project), query, selection);
          else {
            const searchable = documents.map(concept => {
              try { return searchDocument(concept); } catch (error) { throw new Error(`${concept.path}: ${error instanceof Error ? error.message : String(error)}`); }
            });
            if (filters.length && !query.trim() && options.type === undefined) {
              const rank = { hold: 0, constraint: 1, context: 2 };
              results = searchable.map(document => ({ concept_id: document.id, type: document.type, title: document.title, description: document.description, governance: document.governance ?? "context", score: 0, matched_on: [], ...(document.tags ? { tags: [...document.tags] } : {}) }))
                .sort((a, b) => rank[a.governance] - rank[b.governance] || (a.concept_id < b.concept_id ? -1 : a.concept_id > b.concept_id ? 1 : 0));
            } else results = createSearchIndex(searchable).search(query, selection);
          }
          if (!filters.length) return results;
          const matching = new Set(documents.filter(concept => matchesFilters(concept.metadata, filters)).map(concept => concept.id));
          return results.filter(result => matching.has(result.concept_id)).slice(0, limit)
            .map((result): SearchResult | PathSearchResult => "code_refs" in result
              ? { ...result, matched_on: [...result.matched_on, "filter"] }
              : { ...result, matched_on: [...result.matched_on, "filter"] });
        }
        catch (error) { throw new MemoryReadError(error instanceof Error ? error.message : String(error), { cause: error }); }
      },
    });
  } catch (error) {
    throw new MemoryReadError(error instanceof Error ? error.message : String(error), { cause: error });
  }
}
