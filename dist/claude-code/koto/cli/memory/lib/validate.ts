import { join, posix, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { openProjectFiles } from "./files.ts";
import { collectDocuments } from "./documents.ts";
import { parseDocument, searchDocument, timestamp } from "./frontmatter.ts";
import { buildGraph, links, resolveReference, unsupportedLinks, visibleLines, type BrokenLink } from "./references.ts";
import { codeRefExists } from "./code-refs.ts";

export interface ValidateOptions { strict?: boolean; drift?: boolean; stale?: boolean; staleWithinDays?: number; now?: Date }
export interface ValidationResult {
  bundle_path: string; declared_version?: string; concept_count: number; errors: string[]; warnings: string[];
  gate_findings: string[]; broken_links: BrokenLink[]; orphans: string[]; stale_count: number; near_expiry: string[];
  is_conformant: boolean; gate_passed: boolean;
}
const normalize = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/[\\"'`*_]/g, "").replace(/\s+/g, " ").trim().replace(/\.$/, "").toLowerCase();

export async function validateMemory(root: string, project = "default", options: ValidateOptions = {}): Promise<ValidationResult> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid validation time.");
  if (options.staleWithinDays !== undefined && (!Number.isSafeInteger(options.staleWithinDays) || options.staleWithinDays <= 0 || options.staleWithinDays > 36500)) throw new Error("--stale-within must be a whole number of days from 1d to 36500d.");
  const files = await openProjectFiles(root, project);
  await files.assertReady();
  const documents = await collectDocuments(files, true);
  const graph = buildGraph(documents.concepts, documents.indexes, new Set([...documents.indexes.keys(), ...documents.logs.keys()]));
  const result: ValidationResult = { bundle_path: join(await realpath(resolve(root)), ".space", project, "memory"), concept_count: documents.concepts.size + [...documents.errors.keys()].filter(path => path.endsWith(".md") && !/\/(index|log)\.md$/i.test(path) && !/^(index|log)\.md$/i.test(path)).length, errors: [...documents.errors].map(([path, message]) => `${path}: ${message}`), warnings: [], gate_findings: [], broken_links: graph.brokenLinks, orphans: graph.orphans, stale_count: 0, near_expiry: [], is_conformant: false, gate_passed: false };
  try {
    const raw = documents.indexes.get("index.md");
    if (raw === undefined) throw new Error("bundle index is missing");
    const version = parseDocument(raw).metadata.okf_version;
    if (typeof version === "string") result.declared_version = version;
    if (version !== "0.2") throw new Error('expected okf_version: "0.2"');
  } catch (error) { result.errors.push(`index.md: ${error instanceof Error ? error.message : String(error)}`); }
  for (const [path, raw] of [...documents.indexes, ...documents.logs]) {
    if (path !== "index.md" && /^\uFEFF?---[\t ]*\r?\n/.test(raw)) result.warnings.push(`${path}: navigation documents must not carry frontmatter.`);
    if (posix.basename(path).toLowerCase() === "log.md") for (const line of visibleLines(raw).lines) {
      if (line.startsWith("## ") && !timestamp(`${line.slice(3).trim()}T00:00:00Z`)) result.warnings.push(`${path}: log heading must be YYYY-MM-DD.`);
    }
  }
  const existence = new Map<string, boolean>();
  for (const concept of documents.concepts.values()) {
    const { metadata: m, path } = concept;
    let valid = true;
    try { searchDocument(concept); } catch (error) { valid = false; result.errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
    if (timestamp(m.stale_after)) {
      const due = Date.parse(String(m.stale_after)), difference = due - now.getTime();
      if (difference <= 0) { result.stale_count++; result.warnings.push(`${path}: stale_after is expired; review is due.`); }
      else if (options.staleWithinDays !== undefined && difference <= options.staleWithinDays * 86_400_000) result.near_expiry.push(`${path}: stale_after is within ${options.staleWithinDays} days.`);
    }
    const generated = m.generated;
    if (generated && !Array.isArray(generated) && typeof generated === "object" && timestamp(generated.at) && Array.isArray(m.verified)) {
      for (const [i, event] of m.verified.entries()) if (event && !Array.isArray(event) && typeof event === "object" && timestamp(event.at) && Date.parse(String(event.at)) < Date.parse(String(generated.at))) result.warnings.push(`${path}: verified[${i}] predates generated.at (superseded verification).`);
    }
    const visible = visibleLines(concept.body).lines.join("\n");
    if (Object.hasOwn(m, "timestamp")) result.gate_findings.push(`${path}: legacy timestamp; use generated: {by, at}.`);
    if (/^#\s+Citations\s*$/m.test(visible)) result.gate_findings.push(`${path}: legacy Citations section; use sources frontmatter.`);
    const sourceIds = new Set(Array.isArray(m.sources) ? m.sources.flatMap(source => source && !Array.isArray(source) && typeof source === "object" && typeof source.id === "string" ? [source.id] : []) : []);
    if (sourceIds.size) for (const key of new Set([...visible.matchAll(/\[\^([^\]]+)\]/g)].map(match => match[1]))) if (!sourceIds.has(key ?? "")) result.warnings.push(`${path}: footnote [^${key}] matches no sources entry id.`);
    if (options.drift) {
      const indexPath = posix.join(posix.dirname(path), "index.md"), index = documents.indexes.get(indexPath);
      const listings = links(index ?? "", true).filter(link => { const target = resolveReference(indexPath, link.href); return "path" in target && target.path === path; });
      if (index === undefined) result.warnings.push(`${path}: parent index ${indexPath} does not exist.`);
      else if (!listings.length) result.warnings.push(`${path}: concept is not listed in parent index ${indexPath}.`);
      else if (typeof m.description === "string" && listings.some(link => {
        const description = /\)\s*[-–:]\s*(.+)$/.exec(link.line)?.[1];
        return description === undefined || normalize(description) !== normalize(String(m.description));
      })) result.warnings.push(`${indexPath}: listing for ${path} differs from concept description.`);
      if (valid && Array.isArray(m.code_refs)) for (const ref of m.code_refs as string[]) {
        try {
          if (!existence.has(ref)) existence.set(ref, await codeRefExists(root, ref, project));
          if (!existence.get(ref)) result.warnings.push(`${path}: code_refs '${ref}' matches no accessible path under --root.`);
        } catch (error) { result.errors.push(`${path}: could not inspect code_refs '${ref}': ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
  }
  for (const [path, text] of [...[...documents.concepts.values()].map(c => [c.path, c.body] as const), ...documents.indexes]) {
    if (!visibleLines(text, documents.indexes.has(path)).complete) result.warnings.push(`${path}: unclosed code fence or HTML comment prevents complete link inspection.`);
    for (const href of unsupportedLinks(text, documents.indexes.has(path))) result.warnings.push(`${path}: unsupported reference-style or HTML link '${href}'; use inline Markdown links for managed relationships.`);
  }
  if (options.drift) for (const [path, text] of documents.indexes) for (const link of links(text, true)) {
    const target = resolveReference(path, link.href);
    if (!("path" in target)) continue;
    const concept = documents.concepts.get(target.path.slice(0, -3));
    if (!concept || posix.join(posix.dirname(concept.path), "index.md") === path || typeof concept.metadata.description !== "string") continue;
    const description = /\)\s*[-–:]\s*(.+)$/.exec(link.line)?.[1];
    if (description && normalize(description) !== normalize(concept.metadata.description)) result.warnings.push(`${path}: listing for ${concept.path} differs from concept description.`);
  }
  result.is_conformant = result.errors.length === 0;
  result.gate_passed = result.is_conformant && !(options.strict && (result.warnings.length || result.gate_findings.length || result.broken_links.length || result.orphans.length)) && !(options.stale && result.stale_count);
  result.warnings.push(...result.near_expiry);
  for (const values of [result.errors, result.warnings, result.gate_findings, result.orphans, result.near_expiry]) values.sort();
  result.broken_links.sort((a, b) => a.source_concept < b.source_concept ? -1 : a.source_concept > b.source_concept ? 1 : a.target_href < b.target_href ? -1 : a.target_href > b.target_href ? 1 : 0);
  await files.assertReady();
  return result;
}
