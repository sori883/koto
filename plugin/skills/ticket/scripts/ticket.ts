#!/usr/bin/env bun
// Manage koto tickets under <project-root>/.space/tickets/.
// ticket.md is the source of truth. This script only creates the file,
// reads its frontmatter, and rewrites the status and updated fields.
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const USAGE = `Usage:
  ticket.ts new    <project-root> <id> <title> [--parent <id>] [--depends-on <id,id>]
  ticket.ts list   <project-root> [--status <status>] [--ready]
  ticket.ts graph  <project-root> [--mermaid]
  ticket.ts status <project-root> <id> <status>`;

export const STATUSES = ["pending", "running", "paused", "done", "cancelled"] as const;
export type Status = (typeof STATUSES)[number];

const TRANSITIONS: Record<Status, readonly Status[]> = {
  pending: ["running", "cancelled"],
  running: ["paused", "done", "cancelled"],
  paused: ["running", "cancelled"],
  done: ["pending"],
  cancelled: ["pending"],
};

const FIELDS = ["id", "title", "status", "parent", "depends_on", "created", "updated"] as const;

export type Ticket = {
  id: string;
  title: string;
  status: Status;
  parent: string | null;
  dependsOn: string[];
  created: string;
  updated: string;
  /** Everything after the closing `---` line, kept byte for byte. */
  body: string;
};

export type ListRow = Ticket & { ready: boolean | null };

export class TicketError extends Error {}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function requireId(value: string, label: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new TicketError(
      `invalid ${label} '${value}'. Use 1-64 lowercase letters, digits or hyphens, starting with a letter or digit.`,
    );
  }
}

function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}

function requireStatus(value: string): Status {
  if (!isStatus(value)) throw new TicketError(`unknown status '${value}'. Use one of: ${STATUSES.join(", ")}`);
  return value;
}

function oneLine(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

export function parseTicket(text: string, file: string): Ticket {
  const fail = (why: string): never => {
    throw new TicketError(`${file}: ${why}`);
  };
  if (!text.startsWith("---\n")) fail("frontmatter must start with a '---' line");
  const end = text.indexOf("\n---\n", 3);
  const endAtEof = text.endsWith("\n---") ? text.length - 4 : -1;
  const close = end >= 0 ? end : endAtEof;
  if (close < 0) fail("frontmatter has no closing '---' line");
  const values = new Map<string, string>();
  for (const line of text.slice(4, close).split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) fail(`frontmatter line is not 'key: value': ${line}`);
    const key = line.slice(0, colon);
    if (!(FIELDS as readonly string[]).includes(key)) fail(`unknown frontmatter key '${key}'`);
    if (values.has(key)) fail(`duplicate frontmatter key '${key}'`);
    values.set(key, line.slice(colon + 1).trim());
  }
  for (const key of FIELDS) if (!values.has(key)) fail(`missing frontmatter key '${key}'`);
  const get = (key: (typeof FIELDS)[number]) => values.get(key)!;

  const id = get("id");
  if (!ID_PATTERN.test(id)) fail(`invalid id '${id}'`);
  const status = get("status");
  if (!isStatus(status)) fail(`unknown status '${status}'`);
  const parent = get("parent") || null;
  if (parent !== null && !ID_PATTERN.test(parent)) fail(`invalid parent '${parent}'`);
  const list = /^\[(.*)\]$/.exec(get("depends_on"));
  if (!list) fail("depends_on must look like [a, b]");
  const dependsOn = list![1]!
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  for (const dep of dependsOn) if (!ID_PATTERN.test(dep)) fail(`invalid dependency '${dep}'`);

  return {
    id,
    title: get("title"),
    status: status as Status,
    parent,
    dependsOn,
    created: get("created"),
    updated: get("updated"),
    body: end >= 0 ? text.slice(end + 5) : "",
  };
}

export function serializeTicket(ticket: Ticket): string {
  return [
    "---",
    `id: ${ticket.id}`,
    `title: ${ticket.title}`,
    `status: ${ticket.status}`,
    ticket.parent ? `parent: ${ticket.parent}` : "parent:",
    `depends_on: [${ticket.dependsOn.join(", ")}]`,
    `created: ${ticket.created}`,
    `updated: ${ticket.updated}`,
    "---",
    "",
  ].join("\n") + ticket.body;
}

function template(title: string): string {
  return `\n# ${title}\n\n## 目的\n\n## 終了条件\n\n## 成果物\n\n## checkpoint\n\n## 結果\n`;
}

export function ticketsDir(root: string): string {
  let rootStat;
  try {
    rootStat = lstatSync(root);
  } catch {
    throw new TicketError(`not a directory: ${root}`);
  }
  if (!rootStat.isDirectory()) throw new TicketError(`not a directory: ${root}`);
  const dir = join(root, ".space", "tickets");
  let stat;
  try {
    stat = lstatSync(dir);
  } catch {
    throw new TicketError(`missing ${dir}. Run the setup skill first.`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TicketError(`not a plain directory: ${dir}`);
  return dir;
}

function ticketFile(dir: string, id: string): string {
  return join(dir, id, "ticket.md");
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Read every ticket. A broken ticket.md stops the command instead of being skipped. */
export function loadTickets(dir: string): Map<string, Ticket> {
  const tickets = new Map<string, Ticket>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const file = ticketFile(dir, entry.name);
    if (!exists(file)) continue;
    const ticket = parseTicket(readFileSync(file, "utf8"), file);
    if (ticket.id !== entry.name) throw new TicketError(`${file}: id '${ticket.id}' does not match its folder '${entry.name}'`);
    tickets.set(ticket.id, ticket);
  }
  return tickets;
}

function writeAtomically(file: string, text: string): void {
  const mode = exists(file) ? lstatSync(file).mode & 0o777 : 0o644;
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode });
  renameSync(tmp, file);
}

const timestamp = (now: Date) => now.toISOString().replace(/\.\d{3}Z$/, "Z");

export function createTicket(
  root: string,
  id: string,
  title: string,
  options: { parent?: string; dependsOn?: string[]; now?: Date } = {},
): string {
  const dir = ticketsDir(root);
  requireId(id, "id");
  const cleanTitle = oneLine(title);
  if (!cleanTitle) throw new TicketError("title is empty");
  if (exists(join(dir, id))) throw new TicketError(`ticket already exists: ${join(dir, id)}`);
  const tickets = loadTickets(dir);
  const parent = options.parent || null;
  if (parent !== null) {
    requireId(parent, "parent id");
    if (parent === id) throw new TicketError("a ticket cannot be its own parent");
    if (!tickets.has(parent)) throw new TicketError(`parent ticket not found: ${parent}`);
  }
  const dependsOn = [...new Set(options.dependsOn ?? [])];
  for (const dep of dependsOn) {
    requireId(dep, "dependency id");
    if (dep === id) throw new TicketError("a ticket cannot depend on itself");
    if (!tickets.has(dep)) throw new TicketError(`dependency ticket not found: ${dep}`);
  }
  const ts = timestamp(options.now ?? new Date());
  const ticket: Ticket = {
    id,
    title: cleanTitle,
    status: "pending",
    parent,
    dependsOn,
    created: ts,
    updated: ts,
    body: template(cleanTitle),
  };
  mkdirSync(join(dir, id));
  const file = ticketFile(dir, id);
  writeAtomically(file, serializeTicket(ticket));
  return file;
}

function isReady(ticket: Ticket, tickets: Map<string, Ticket>): boolean {
  return ticket.dependsOn.every((dep) => tickets.get(dep)?.status === "done");
}

export function listTickets(root: string, filter: { status?: Status; ready?: boolean } = {}): ListRow[] {
  const tickets = loadTickets(ticketsDir(root));
  return [...tickets.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((ticket) => ({ ...ticket, ready: ticket.status === "pending" ? isReady(ticket, tickets) : null }))
    .filter((row) => (filter.status === undefined || row.status === filter.status) && (!filter.ready || row.ready === true));
}

export function setStatus(root: string, id: string, to: Status, now: Date = new Date()): { from: Status; file: string } {
  const dir = ticketsDir(root);
  requireId(id, "id");
  const tickets = loadTickets(dir);
  const ticket = tickets.get(id);
  if (!ticket) throw new TicketError(`ticket not found: ${id}`);
  const from = ticket.status;
  if (!TRANSITIONS[from].includes(to)) throw new TicketError(`cannot change ${id} from ${from} to ${to}`);
  if (to === "running") {
    for (const dep of ticket.dependsOn) {
      const status = tickets.get(dep)?.status ?? "missing";
      if (status !== "done") throw new TicketError(`dependency ${dep} is ${status}, not done`);
    }
  }
  if (to === "done") {
    for (const child of tickets.values()) {
      if (child.parent === id && child.status !== "done" && child.status !== "cancelled") {
        throw new TicketError(`child ${child.id} is ${child.status}, not done or cancelled`);
      }
    }
  }
  const file = ticketFile(dir, id);
  writeAtomically(file, serializeTicket({ ...ticket, status: to, updated: timestamp(now) }));
  return { from, file };
}

function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function stateLabel(ticket: Ticket, tickets: Map<string, Ticket>): string {
  if (ticket.status !== "pending") return ticket.status;
  return `pending, ${isReady(ticket, tickets) ? "ready" : "blocked"}`;
}

/** Children of each ticket. A ticket whose parent is missing counts as a root. */
function childrenOf(tickets: Map<string, Ticket>): { roots: string[]; children: Map<string, string[]> } {
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const id of sortedIds(tickets.keys())) {
    const parent = tickets.get(id)!.parent;
    if (parent !== null && tickets.has(parent) && parent !== id) {
      children.set(parent, [...(children.get(parent) ?? []), id]);
    } else {
      roots.push(id);
    }
  }
  return { roots, children };
}

/** Parent/child tree with status and dependencies, for reading in a terminal. */
export function renderTree(tickets: Map<string, Ticket>): string {
  const { roots, children } = childrenOf(tickets);
  const lines: string[] = [];
  const seen = new Set<string>();
  const line = (id: string) => {
    const ticket = tickets.get(id)!;
    const deps = ticket.dependsOn.map((dep) => `${dep}(${tickets.get(dep)?.status ?? "missing"})`);
    return `${id} [${stateLabel(ticket, tickets)}] ${ticket.title}${deps.length ? `  ← depends: ${deps.join(", ")}` : ""}`;
  };
  const walk = (id: string, prefix: string, branch: string) => {
    seen.add(id);
    lines.push(prefix + branch + line(id));
    const kids = (children.get(id) ?? []).filter((kid) => !seen.has(kid));
    const childPrefix = prefix + (branch === "├─ " ? "│  " : branch === "└─ " ? "   " : "");
    kids.forEach((kid, i) => walk(kid, childPrefix, i === kids.length - 1 ? "└─ " : "├─ "));
  };
  for (const id of roots) walk(id, "", "");
  // A hand-edited parent cycle leaves tickets unreached; show them rather than hide them.
  for (const id of sortedIds(tickets.keys())) if (!seen.has(id)) walk(id, "", "");
  return lines.length ? lines.join("\n") + "\n" : "(no tickets)\n";
}

const nodeId = (id: string) => `t_${id.replace(/-/g, "_")}`;
const mermaidText = (text: string) => text.replace(/"/g, "#quot;").replace(/[<>]/g, (c) => (c === "<" ? "#lt;" : "#gt;"));

/** Mermaid flowchart: dotted lines join parent and child, arrows run from a dependency to the ticket that waits for it. */
export function renderMermaid(tickets: Map<string, Ticket>): string {
  const lines = [
    "flowchart TD",
    "  %% 点線：親子。矢印：矢印の先のチケットは、元のチケットがdoneになるまで始められない。",
  ];
  const ids = sortedIds(tickets.keys());
  for (const id of ids) {
    const ticket = tickets.get(id)!;
    lines.push(`  ${nodeId(id)}["${mermaidText(id)}<br/>${mermaidText(stateLabel(ticket, tickets))}<br/>${mermaidText(ticket.title)}"]:::${ticket.status}`);
  }
  for (const id of ids) {
    const ticket = tickets.get(id)!;
    if (ticket.parent !== null && tickets.has(ticket.parent)) lines.push(`  ${nodeId(ticket.parent)} -.- ${nodeId(id)}`);
  }
  const missing = new Set<string>();
  for (const id of ids) {
    for (const dep of tickets.get(id)!.dependsOn) {
      if (!tickets.has(dep) && !missing.has(dep)) {
        missing.add(dep);
        lines.push(`  ${nodeId(dep)}["${mermaidText(dep)}<br/>missing"]:::missing`);
      }
      lines.push(`  ${nodeId(dep)} --> ${nodeId(id)}`);
    }
  }
  lines.push(
    "  classDef pending fill:#f1f3f5,stroke:#868e96,color:#212529",
    "  classDef running fill:#d0ebff,stroke:#1c7ed6,color:#212529",
    "  classDef paused fill:#fff3bf,stroke:#f08c00,color:#212529",
    "  classDef done fill:#d3f9d8,stroke:#2f9e44,color:#212529",
    "  classDef cancelled fill:#f8f9fa,stroke:#adb5bd,color:#868e96,stroke-dasharray:4 3",
    "  classDef missing fill:#ffe3e3,stroke:#e03131,color:#212529,stroke-dasharray:4 3",
  );
  return lines.join("\n") + "\n";
}

export function graphTickets(root: string, format: "tree" | "mermaid" = "tree"): string {
  const tickets = loadTickets(ticketsDir(root));
  return format === "mermaid" ? renderMermaid(tickets) : renderTree(tickets);
}

function usage(): never {
  console.error(USAGE);
  process.exit(1);
}

export function main(argv: string[]): void {
  const [command, ...rest] = argv;
  const { values, positionals } = (() => {
    try {
      return parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          parent: { type: "string" },
          "depends-on": { type: "string" },
          status: { type: "string" },
          ready: { type: "boolean" },
          mermaid: { type: "boolean" },
        },
      });
    } catch {
      return usage();
    }
  })();
  const allowOnly = (...names: string[]) => {
    for (const key of Object.keys(values)) if (!names.includes(key)) usage();
  };
  switch (command) {
    case "new": {
      if (positionals.length !== 3) usage();
      allowOnly("parent", "depends-on");
      const [root, id, title] = positionals as [string, string, string];
      const dependsOn = (values["depends-on"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      console.log(`created\t${createTicket(root, id, title, { parent: values.parent, dependsOn })}`);
      return;
    }
    case "list": {
      if (positionals.length !== 1) usage();
      allowOnly("status", "ready");
      const status = values.status === undefined ? undefined : requireStatus(values.status);
      console.log(["id", "status", "ready", "parent", "depends_on", "title"].join("\t"));
      for (const row of listTickets(positionals[0]!, { status, ready: values.ready })) {
        const ready = row.ready === null ? "-" : row.ready ? "yes" : "no";
        console.log([row.id, row.status, ready, row.parent ?? "-", row.dependsOn.join(" "), row.title].join("\t"));
      }
      return;
    }
    case "graph": {
      if (positionals.length !== 1) usage();
      allowOnly("mermaid");
      process.stdout.write(graphTickets(positionals[0]!, values.mermaid ? "mermaid" : "tree"));
      return;
    }
    case "status": {
      if (positionals.length !== 3) usage();
      allowOnly();
      const [root, id, to] = positionals as [string, string, string];
      const { from, file } = setStatus(root, id, requireStatus(to));
      console.log(`${id}\t${from} -> ${to}\t${file}`);
      return;
    }
    default:
      usage();
  }
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof TicketError)) throw error;
    console.error(`error: ${error.message}`);
    process.exit(2);
  }
}
