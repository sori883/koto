import { posix } from "node:path";
import type { Concept } from "./frontmatter.ts";

export const escapeText = (text: string) => text.replace(/[\r\n]+/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\[\]*`]/g, "\\$&");
export const encodePath = (path: string) => path.split("/").map(part => encodeURIComponent(part).replace(/[()]/g, char => `%${char.charCodeAt(0).toString(16)}`)).join("/");

function inlineCodeEnd(line: string, start: number): number | undefined {
  let openingEnd = start;
  while (line[openingEnd] === "`") openingEnd++;
  let closing = openingEnd;
  while ((closing = line.indexOf("`", closing)) >= 0) {
    let end = closing;
    while (line[end] === "`") end++;
    if (end - closing === openingEnd - start) return end;
    closing = end;
  }
}

export function visibleLines(text: string, skipFrontmatter = false): { lines: string[]; complete: boolean } {
  let fence = "", fenceLength = 0, comment = false, inlineWidth = 0;
  let frontmatter = skipFrontmatter && /^\uFEFF?---[\t ]*\r?\n/.test(text);
  const originals = text.split("\n");
  const lines = originals.map((original, index) => {
    const line = original.replace(/\r$/, "");
    if (frontmatter) {
      if (index > 0 && /^---[\t ]*$/.test(line)) frontmatter = false;
      return "";
    }
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!comment && !inlineWidth && marker?.[1] && marker[2] !== undefined) {
      if (!fence) { fence = marker[1][0] ?? ""; fenceLength = marker[1].length; }
      else if (marker[1][0] === fence && marker[1].length >= fenceLength && !marker[2].trim()) fence = "";
      return "";
    }
    if (fence || (!comment && !inlineWidth && /^( {4}|\t)/.test(line))) return "";
    let visible = "", cursor = 0;
    while (cursor < line.length) {
      if (inlineWidth) {
        const run = /`+/.exec(line.slice(cursor));
        if (!run) { visible += " ".repeat(line.length - cursor); break; }
        const end = cursor + run.index + run[0].length;
        visible += " ".repeat(end - cursor); cursor = end;
        if (run[0].length === inlineWidth) inlineWidth = 0;
      } else if (comment) {
        const end = line.indexOf("-->", cursor);
        if (end < 0) { visible += " ".repeat(line.length - cursor); break; }
        visible += " ".repeat(end + 3 - cursor); cursor = end + 3; comment = false;
      } else if (line[cursor] === "\\") {
        visible += line.slice(cursor, cursor + 2); cursor += 2;
      } else if (line[cursor] === "`") {
        const end = inlineCodeEnd(line, cursor);
        if (end !== undefined) { visible += " ".repeat(end - cursor); cursor = end; }
        else {
          const width = /^`+/.exec(line.slice(cursor))?.[0].length ?? 1;
          let closesLater = false;
          for (let next = index + 1; next < originals.length; next++) {
            const following = originals[next] ?? "";
            if (!following.trim() || /^ {0,3}(?:`{3,}|~{3,}|#{1,6}\s|[-*+]\s)/.test(following)) break;
            if ([...following.matchAll(/`+/g)].some(run => run[0].length === width)) { closesLater = true; break; }
          }
          if (closesLater) { inlineWidth = width; visible += " ".repeat(width); cursor += width; }
          else { visible += line.slice(cursor, cursor + width); cursor += width; }
        }
      } else if (line.startsWith("<!--", cursor)) {
        visible += "    "; cursor += 4; comment = true;
      } else { visible += line[cursor]; cursor++; }
    }
    return visible;
  });
  return { lines, complete: !fence && !comment && !frontmatter };
}

export interface LinkSpan { href: string; label: string; start: number; end: number; lineNumber: number; line: string }
export function links(text: string, skipFrontmatter = false): LinkSpan[] {
  const original = text.split("\n"), result: LinkSpan[] = [];
  let offset = 0;
  for (const [lineNumber, line] of visibleLines(text, skipFrontmatter).lines.entries()) {
    for (const match of line.matchAll(/(?<!!)\[((?:\\.|[^\]\\])*)\]\(<?([^\s>]+?\.md(?:[?#][^\s>)]*)?)>?(?:\s+"[^"]*")?\)/g)) {
      if ((line.slice(0, match.index).match(/\\+$/)?.[0].length ?? 0) % 2) continue;
      const href = match[2];
      if (!href || /^[a-z][\w+.-]*:/i.test(href) || href.startsWith("//")) continue;
      const raw = original[lineNumber] ?? "";
      result.push({ href, label: raw.slice(match.index + 1, match.index + 1 + (match[1]?.length ?? 0)), start: offset + match.index, end: offset + match.index + match[0].length, lineNumber, line: raw });
    }
    offset += (original[lineNumber]?.length ?? 0) + 1;
  }
  return result;
}

export function resolveReference(source: string, href: string): { path: string } | { error: string } {
  let clean = href.split(/[?#]/)[0] ?? "";
  try { clean = decodeURIComponent(clean); } catch { return { error: "invalid URL encoding" }; }
  if (/[\\:\u0000-\u001f\u007f]/.test(clean)) return { error: "invalid local path" };
  const path = posix.normalize(clean.startsWith("/") ? clean.slice(1) : posix.join(posix.dirname(source), clean));
  if (path === ".." || path.startsWith("../") || path.startsWith("/")) return { error: "link leaves the selected memory" };
  return { path };
}

export function linkedPaths(text: string, source: string): string[] {
  return links(text).flatMap(link => { const target = resolveReference(source, link.href); return "path" in target ? [target.path] : []; });
}

export function unsupportedLinks(text: string, skipFrontmatter = false): string[] {
  const visible = visibleLines(text, skipFrontmatter).lines.join("\n"), result: string[] = [];
  for (const match of visible.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*<?([^\s>]+\.md(?:[?#][^\s>]*)?)>?/gm)) if (match[1]) result.push(match[1]);
  for (const match of visible.matchAll(/<a\s[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi)) {
    const href = match[1] ?? match[2] ?? match[3];
    if (href && /\.md(?:[?#]|$)/.test(href)) result.push(href.replace(/&amp;/g, "&"));
  }
  return result.filter(href => !/^[a-z][\w+.-]*:/i.test(href) && !href.startsWith("//"));
}

export function unlinkTarget(text: string, source: string, targetPath: string, mode: "concept" | "index" | "log"): string {
  const visible = visibleLines(text, mode !== "concept");
  if (!visible.complete) throw new Error(`Cannot safely inspect unclosed Markdown in ${source}.`);
  if (unsupportedLinks(text, mode !== "concept").some(href => { const target = resolveReference(source, href); return "path" in target && target.path === targetPath; })) {
    throw new Error(`Cannot safely remove a reference-style or HTML link to ${targetPath} in ${source}; convert it to an inline Markdown link first.`);
  }
  const all = links(text, mode !== "concept"), matches = all.filter(link => { const target = resolveReference(source, link.href); return "path" in target && target.path === targetPath; });
  const edits: { start: number; end: number; text: string }[] = [];
  const parts = text.split(/(?<=\n)/);
  let offset = 0, related = false;
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i] ?? "", shown = visible.lines[i] ?? "";
    if (/^# /.test(shown)) related = /^# Related(?: Concepts)?\s*$/.test(shown);
    const found = matches.filter(link => link.lineNumber === i), first = found[0];
    if (first) {
      const before = line.slice(0, first.start - offset), after = line.slice(first.end - offset).replace(/\r?\n$/, "");
      const managed = /^ {0,3}[-*] +$/.test(before) && /^(?:\s*|\s*:\s+.*|\s+-\s+.*)$/.test(after) && all.filter(link => link.lineNumber === i).length === 1 && !/[<\[]/.test(after);
      if ((mode === "index" || mode === "concept" && related) && managed) edits.push({ start: offset, end: offset + line.length, text: "" });
      else for (const link of found) edits.push({ start: link.start, end: link.end, text: link.label + (mode === "log" ? ` (${escapeText(targetPath.slice(0, -3))})` : "") });
    }
    offset += line.length;
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return text;
}

export interface BrokenLink { source_concept: string; target_href: string; reason: string }
export function buildGraph(concepts: ReadonlyMap<string, Concept>, indexes: ReadonlyMap<string, string>, navigationTargets: ReadonlySet<string> = new Set(indexes.keys())) {
  const outbound = new Map([...concepts.keys()].map(id => [id, new Set<string>()]));
  const inbound = new Map([...concepts.keys()].map(id => [id, new Set<string>()]));
  const brokenLinks: BrokenLink[] = [];
  const documents: [string, string, boolean][] = [...[...concepts.values()].map(c => [c.path, c.body, false] as [string, string, boolean]), ...[...indexes].map(([path, raw]) => [path, raw, true] as [string, string, boolean])];
  for (const [source, text, navigation] of documents) for (const link of links(text, navigation)) {
    const target = resolveReference(source, link.href);
    let reason: string | undefined;
    if ("error" in target) reason = target.error;
    else if (navigationTargets.has(target.path)) { if (!navigation) reason = "navigation documents are not concepts"; }
    else {
      const id = target.path.slice(0, -3), sourceId = source.slice(0, -3);
      if (!concepts.has(id)) reason = "target concept does not exist";
      else if (!navigation && id !== sourceId) { outbound.get(sourceId)?.add(id); inbound.get(id)?.add(sourceId); }
    }
    if (reason) brokenLinks.push({ source_concept: source, target_href: link.href, reason });
  }
  const orphans = concepts.size > 1 ? [...concepts.keys()].filter(id => !outbound.get(id)?.size && !inbound.get(id)?.size).sort() : [];
  return { outbound: new Map([...outbound].map(([id, set]) => [id, [...set].sort()])), inbound: new Map([...inbound].map(([id, set]) => [id, [...set].sort()])), brokenLinks, orphans };
}
