import manifest from "../package.json";
import { inputArguments } from "./input.ts";
import { MemoryError, contentHash } from "./errors.ts";
import { parseArgs } from "node:util";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { openProjectMemory, MemoryReadError, ConceptNotFoundError, validateConceptId, type MemorySearchOptions } from "./memory.ts";
import { maxFileBytes, validateProject, WriteError, openProjectFiles } from "./files.ts";
import { conceptTypes } from "./search.ts";
import { parseDocument, parseMetadata, type Metadata } from "./frontmatter.ts";
import { initMemory, saveConcept, relateConcepts, deleteConcept } from "./mutate.ts";
import { validateMemory } from "./validate.ts";
import { parseFilters } from "./filter.ts";
import { listUsage, recordUsage, usageStats, validateUsageContext, type UsageContext } from "./usage.ts";

const version = manifest.version;
const json = (data: unknown, ok = true, usage?: unknown) => JSON.stringify({ ok, data, ...(usage === undefined ? {} : { usage }) }, null, 2);
const help = `koto-memory ${version} — OKF memory

Usage:
  koto-memory init --root <monorepo> [--project <name>] [--actor <id>] [--json]
  koto-memory create <id> --root <monorepo> --type <type> --title <title> --desc <description> [options]
  koto-memory update <id> --root <monorepo> [options]
  koto-memory delete <id> --root <monorepo> [--dry-run] [--json]
  koto-memory relate <source-id> <target-id> --root <monorepo> [--desc <relationship>] [--json]
  koto-memory validate --root <monorepo> [--strict] [--drift] [--stale] [--stale-within <days>d] [--json]
  koto-memory show <id> --root <monorepo> [--project <name>] [--json | --raw]
  koto-memory search [query] --root <monorepo> [--project <name>] [--type <type>] [--limit <n> | --all] [--json]
  koto-memory recover --root <monorepo> [--project <name>] [--dry-run] [--json]
  koto-memory usage list --root <monorepo> [--since <timestamp>] [--until <timestamp>] [--limit <n> | --all] [--json]
  koto-memory usage stats --root <monorepo> [--since <timestamp>] [--until <timestamp>] [--json]
  koto-memory --input-json <object | ->
  koto-memory --help
  koto-memory --version

--root     Required for all memory commands; no automatic discovery.
--project  Defaults to default. Operations are scoped to .space/<project>/memory.
--type     rule | principle | knowledge | procedure | decision
--limit    Positive integer, default 10, capped at 100.
--all      Return every match; cannot be combined with --limit.
--json     JSON on stdout, including failures. Exit: 0 success, 1 input/write/validation failure, 2 read failure.
--raw      show only: original Markdown, cannot be combined with --json.
--relations  show only: collect inbound/outbound references; requires readable concepts.
--record-usage  show/search: save a usage event after a successful read. Omit for read-only calls.
--usage-source <id> / --task-id <id> / --actor <id>  Recorded read attribution, or usage list/stats filters.
--since / --until  usage only: timezone-qualified ISO timestamps, inclusive start and exclusive end.
usage list defaults to 20 events, capped at 100; --all returns every matching event.
--for-path <path>  search only: match code_refs relative to --root, with hold/constraint first.
--filter <condition>  search only, repeatable; all conditions must match.
                     field=value | field!=value | field? | !field
                     Example: --filter tags=auth --filter status=stable
                     Dot paths support nested attributes and arrays, e.g. verified.by=human:alice.
--dry-run  delete or recover: preview changed paths, removed relationships and new orphans.
--strict   validate only: fail on warnings, broken links and orphans, excluding near-expiry warnings.
--drift    validate only: check indexes and code_refs existence under --root.
--stale    validate only: fail on expired stale_after.
--stale-within <days>d  validate only: warn on upcoming expiry; no default period.

create/update options:
--metadata-file <path>  JSON, YAML mapping or Markdown frontmatter; flags override fields.
--metadata-json <object>  Inline JSON metadata; mutually exclusive with --metadata-file.
--if-hash <sha256>  update, delete or relate: reject if the current source differs from show.content_hash.
--type / --title / --desc / --tags / --status  Metadata fields; tags are comma-separated.
--body <text> | --body-file <path>  Body text; update preserves it when omitted.
--actor <id>  generated.by and log actor; default agent/cli. generated.at is automatic.
--no-index / --no-log  Skip index or log updates.
update only:
--unset <key>  Remove an optional metadata key; repeatable.
--sync         Repair index/log references even for unchanged content.
               Cannot be combined with --no-index or --no-log.

Quote multiword queries and filter expressions. Without query, search requires --type, --for-path or --filter.
JSON input: {"command":["search","query"],"root":"/workspace","project":"default"}.
Use --input-json - for stdin. JSON output is {ok,data} or {ok:false,error:{code,message,details}}.
Interrupted writes require recover; failures can include already saved/deleted written_paths.
Code paths must stay inside .space/<project>, repositories/<project> or workspaces/<project>.
setup is an alias for init.
`;

async function inputFile(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile()) throw new Error(`Input must be a regular file: ${path}`);
    if (before.size > maxFileBytes) throw new Error(`Input exceeds 16 MiB: ${path}`);
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxFileBytes + 1 - total));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxFileBytes) throw new Error(`Input exceeds 16 MiB: ${path}`);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error(`Input changed during reading: ${path}`);
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, total));
  } finally { await file.close(); }
}

export async function run(argv: string[]): Promise<number> {
  const terminator = argv.indexOf("--");
  const jsonRequested = argv.slice(0, terminator < 0 ? undefined : terminator).some(arg => arg === "--json" || arg === "--input-json" || arg.startsWith("--input-json="));
  try {
    argv = await inputArguments(argv);
    const { values, positionals, tokens } = parseArgs({ args: argv, strict: true, allowPositionals: true, tokens: true, options: {
      root: { type: "string" }, project: { type: "string" }, json: { type: "boolean" },
      type: { type: "string" }, limit: { type: "string" }, all: { type: "boolean" }, raw: { type: "boolean" },
      help: { type: "boolean", short: "h" }, version: { type: "boolean" },
      "metadata-json": { type: "string" }, "if-hash": { type: "string" },
      "metadata-file": { type: "string" }, title: { type: "string" }, desc: { type: "string" },
      tags: { type: "string" }, status: { type: "string" }, body: { type: "string" }, "body-file": { type: "string" },
      actor: { type: "string" }, unset: { type: "string", multiple: true }, sync: { type: "boolean" },
      "no-index": { type: "boolean" }, "no-log": { type: "boolean" },
      relations: { type: "boolean" }, "for-path": { type: "string" }, "dry-run": { type: "boolean" },
      strict: { type: "boolean" }, drift: { type: "boolean" }, stale: { type: "boolean" }, "stale-within": { type: "string" },
      filter: { type: "string", multiple: true },
      "record-usage": { type: "boolean" }, "usage-source": { type: "string" }, "task-id": { type: "string" },
      since: { type: "string" }, until: { type: "string" },
    } });
    const seen = new Set<string>();
    for (const token of tokens) {
      if (token.kind !== "option") continue;
      if (seen.has(token.name) && token.name !== "unset" && token.name !== "filter") throw new Error(`Option specified more than once: --${token.name}`);
      seen.add(token.name);
    }
    const [requested, ...args] = positionals;
    const command = requested === "setup" ? "init" : requested;
    if (values.help || command === "help" || (command === undefined && argv.length === 0)) {
      process.stdout.write(values.json ? `${json({ help })}\n` : help);
      return 0;
    }
    if (values.version || command === "version") {
      if (args.length || (values.version && command !== undefined)) throw new Error("--version cannot be combined with a command.");
      process.stdout.write(values.json ? `${json({ version })}\n` : `${version}\n`);
      return 0;
    }
    if (!["init", "create", "update", "show", "search", "delete", "relate", "validate", "recover", "usage"].includes(command ?? "")) throw new Error(`Unknown command: ${command ?? "(missing)"}. Use --help.`);
    if (values.root === undefined || !values.root.trim()) throw new Error("--root is required; specify the monorepo directory.");
    const project = values.project ?? "default";
    validateProject(project);
    const common = ["root", "project", "json"];
    const writes = ["metadata-json", "metadata-file", "type", "title", "desc", "tags", "status", "body", "body-file", "actor", "no-index", "no-log"];
    const usageAttribution = ["usage-source", "task-id", "actor"];
    const allowed = new Set([...common, ...(command === "init" ? ["actor"] : command === "create" ? writes
      : command === "update" ? [...writes, "unset", "sync", "if-hash"] : command === "show" ? ["raw", "relations", "record-usage", ...usageAttribution] : command === "search" ? ["type", "limit", "all", "for-path", "filter", "record-usage", ...usageAttribution]
      : command === "usage" ? [...usageAttribution, "since", "until", ...(args[0] === "list" ? ["limit", "all"] : [])]
      : command === "delete" ? ["actor", "dry-run", "if-hash"] : command === "relate" ? ["desc", "actor", "no-index", "no-log", "if-hash"] : command === "recover" ? ["dry-run"] : ["strict", "drift", "stale", "stale-within"])]);
    for (const name of seen) if (!allowed.has(name)) throw new Error(`--${name} is not supported by ${command}.`);
    const usageContext: UsageContext = {
      ...(values.actor === undefined ? {} : { actor: values.actor }),
      ...(values["usage-source"] === undefined ? {} : { source: values["usage-source"] }),
      ...(values["task-id"] === undefined ? {} : { taskId: values["task-id"] }),
    };
    if (command === "show" || command === "search") {
      if (!values["record-usage"] && usageAttribution.some(name => seen.has(name))) throw new Error("Read attribution requires --record-usage.");
      if (values["record-usage"]) validateUsageContext(usageContext);
    }
    if (command === "usage") {
      if (args.length !== 1 || !["list", "stats"].includes(args[0]!)) throw new Error("usage requires list or stats.");
      if (values.limit !== undefined && !/^[1-9]\d*$/.test(values.limit)) throw new Error("--limit must be a positive integer.");
      const filters = { ...usageContext, ...(values.since === undefined ? {} : { since: values.since }), ...(values.until === undefined ? {} : { until: values.until }) };
      const result = args[0] === "stats" ? await usageStats(values.root, project, filters) : await listUsage(values.root, project, filters, {
        ...(values.limit === undefined ? {} : { limit: Number(values.limit) }), ...(values.all ? { all: true } : {}),
      });
      process.stdout.write(`${values.json ? json(result) : JSON.stringify(result, null, 2)}\n`);
    } else if (command === "recover") {
      if (args.length) throw new Error("recover accepts no positional arguments.");
      const result = await (await openProjectFiles(values.root, project)).recover(values["dry-run"] ?? false);
      process.stdout.write(`${values.json ? json(result) : JSON.stringify(result, null, 2)}\n`);
    } else if (command === "delete" || command === "relate") {
      if (args.length !== (command === "delete" ? 1 : 2)) throw new Error(`${command} requires ${command === "delete" ? "one concept ID" : "source and target IDs"}.`);
      const actor = { ...(values.actor === undefined ? {} : { actor: values.actor }), ...(values["if-hash"] === undefined ? {} : { ifHash: values["if-hash"] }) };
      const result = command === "delete" ? await deleteConcept(values.root, project, args[0]!, { ...actor, ...(values["dry-run"] ? { dryRun: true } : {}) })
        : await relateConcepts(values.root, project, args[0]!, args[1]!, values.desc, { ...actor, ...(values["no-index"] ? { noIndex: true } : {}), ...(values["no-log"] ? { noLog: true } : {}) });
      process.stdout.write(`${values.json ? json(result) : JSON.stringify(result, null, 2)}\n`);
    } else if (command === "validate") {
      if (args.length) throw new Error("validate accepts no positional arguments.");
      const duration = values["stale-within"];
      if (duration !== undefined && !/^[1-9]\d*d$/.test(duration)) throw new Error("--stale-within requires a period such as 7d.");
      const result = await validateMemory(values.root, project, { ...(values.strict ? { strict: true } : {}), ...(values.drift ? { drift: true } : {}), ...(values.stale ? { stale: true } : {}), ...(duration === undefined ? {} : { staleWithinDays: Number(duration.slice(0, -1)) }) });
      process.stdout.write(values.json ? `${json(result, result.gate_passed)}\n` : `${result.gate_passed ? "Passed" : "Failed"}: ${result.concept_count} concepts, ${result.errors.length} errors, ${result.warnings.length} warnings, ${result.broken_links.length} broken links, ${result.orphans.length} orphans.\n${[...result.errors, ...result.warnings, ...result.gate_findings, ...result.broken_links.map(link => `${link.source_concept}: ${link.target_href}: ${link.reason}`), ...result.orphans.map(id => `Orphan: ${id}`)].join("\n")}\n`);
      return result.gate_passed ? 0 : 1;
    } else if (command === "init" || command === "create" || command === "update") {
      if (command === "init" && args.length) throw new Error("init does not accept a concept ID.");
      if (command !== "init" && args.length !== 1) throw new Error(`${command} requires exactly one concept ID.`);
      if (values.body !== undefined && values["body-file"] !== undefined) throw new Error("--body and --body-file cannot be combined.");
      if (values["metadata-json"] !== undefined && values["metadata-file"] !== undefined) throw new Error("--metadata-json and --metadata-file cannot be combined.");
      let metadata: Metadata = values["metadata-json"] === undefined ? {} : parseMetadata(JSON.stringify(JSON.parse(values["metadata-json"])));
      if (values["metadata-file"] !== undefined) {
        const raw = await inputFile(values["metadata-file"]);
        metadata = /^\uFEFF?---[\t ]*\r?\n/.test(raw) ? parseDocument(raw).metadata : parseMetadata(raw);
      }
      for (const [flag, key] of [["type", "type"], ["title", "title"], ["desc", "description"], ["status", "status"]] as const) {
        if (values[flag] !== undefined) metadata[key] = values[flag];
      }
      if (values.tags !== undefined) metadata.tags = values.tags.split(",").map(tag => tag.trim()).filter(Boolean);
      const body = values["body-file"] === undefined ? values.body : await inputFile(values["body-file"]);
      const result = command === "init" ? await initMemory(values.root, project, values.actor) : await saveConcept(command, values.root, project, args[0]!, metadata, body, {
        ...(values.actor === undefined ? {} : { actor: values.actor }),
        ...(values["if-hash"] === undefined ? {} : { ifHash: values["if-hash"] }),
        ...(values.unset === undefined ? {} : { unset: values.unset }),
        ...(values.sync ? { sync: true } : {}),
        ...(values["no-index"] ? { noIndex: true } : {}),
        ...(values["no-log"] ? { noLog: true } : {}),
      });
      process.stdout.write(values.json ? `${json(result)}\n` : result.unchanged ? "Unchanged.\n" : `Saved:\n${result.changed_paths.map(path => `  ${path}`).join("\n")}\n`);
    } else if (command === "show") {
      const id = args[0];
      if (args.length !== 1 || id === undefined) throw new Error("show requires exactly one concept ID.");
      validateConceptId(id);
      if (values.type !== undefined || values.limit !== undefined || values.all) throw new Error("--type, --limit and --all are search options.");
      if (values.raw && values.json) throw new Error("--raw and --json cannot be combined.");
      if (values.raw && values.relations) throw new Error("--raw and --relations cannot be combined.");
      const concept = await (await openProjectMemory(values.root, project)).show(id, values.relations ? { relations: true } : {});
      const hash = contentHash(concept.raw_content);
      const usage = values["record-usage"] ? await recordUsage(values.root, project, "show", [id], usageContext, hash) : undefined;
      process.stdout.write(values.json ? `${json({ ...concept, content_hash: hash }, true, usage)}\n` : values.raw ? concept.raw_content
        : `${concept.metadata.title}\nID: ${concept.id}\n${concept.metadata.description}\n${values.relations ? `Inbound: ${concept.inbound?.join(", ") || "none"}\nOutbound: ${concept.outbound?.join(", ") || "none"}\n` : ""}\n${concept.body}`);
    } else {
      if (values.raw) throw new Error("--raw is a show option.");
      if (args.length > 1) throw new Error("search accepts one query; quote queries containing spaces.");
      const query = args[0] ?? "";
      const type = conceptTypes.find(value => value === values.type);
      if (values.type !== undefined && !type) throw new Error("Unknown --type. Use rule, principle, knowledge, procedure or decision.");
      const filters = parseFilters(values.filter ?? []);
      if (!query.trim() && type === undefined && values["for-path"] === undefined && !filters.length) throw new Error("search requires a query, --type, --for-path or --filter.");
      if (values.limit !== undefined) {
        if (!/^[1-9]\d*$/.test(values.limit) || !Number.isSafeInteger(Number(values.limit))) throw new Error("--limit must be a positive safe integer.");
      }
      if (values.all && values.limit !== undefined) throw new Error("--all and --limit cannot be combined.");
      const options: MemorySearchOptions = {
        ...(type === undefined ? {} : { type }),
        ...(values.limit === undefined ? {} : { limit: Number(values.limit) }),
        ...(values.all ? { all: true } : {}),
        ...(values["for-path"] === undefined ? {} : { forPath: values["for-path"] }),
        ...(filters.length ? { filters } : {}),
      };
      const results = await (await openProjectMemory(values.root, project)).search(query, options);
      const usage = values["record-usage"] ? await recordUsage(values.root, project, "search", results.map(result => result.concept_id), usageContext) : undefined;
      process.stdout.write(values.json ? `${json(results, true, usage)}\n` : results.length
        ? results.map(result => `${result.concept_id}\t${result.title}\n${result.description}\n`).join("\n") : "No matches.\n");
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let cause: unknown = error;
    while (cause instanceof Error && !(cause instanceof MemoryError) && cause.cause !== undefined) cause = cause.cause;
    const code = cause instanceof MemoryError ? cause.code : error instanceof ConceptNotFoundError ? "NOT_FOUND" : error instanceof WriteError ? "WRITE_FAILED" : error instanceof MemoryReadError ? "READ_FAILED" : "INVALID_INPUT";
    if (jsonRequested) process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message, ...(error instanceof WriteError ? { details: { written_paths: error.writtenPaths } } : {}) } })}\n`);
    else process.stderr.write(`Error: ${message}\n${error instanceof WriteError && error.writtenPaths.length ? `Already saved: ${error.writtenPaths.join(", ")}\n` : ""}`);
    return error instanceof MemoryReadError ? 2 : 1;
  }
}
