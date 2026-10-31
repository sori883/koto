import { openProjectFiles, validateProject } from "./files.ts";
import { MemoryError } from "./errors.ts";
import { timestamp, validActor } from "./frontmatter.ts";
import { validateConceptId } from "./documents.ts";
import { MemoryReadError, requireInitialized } from "./memory.ts";

export interface UsageContext { actor?: string; source?: string; taskId?: string }
export interface UsageFilters extends UsageContext { since?: string; until?: string }
export interface UsageEvent {
  schema_version: 1;
  id: string;
  at: string;
  project: string;
  operation: "search" | "show";
  actor: string;
  source: string;
  task_id?: string;
  concept_ids: string[];
  content_hash?: string;
}
const eventDirectory = "usage/events";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function validateUsageContext(context: UsageContext): void {
  if (context.actor !== undefined && (context.actor.length > 200 || !validActor(context.actor))) throw new Error("actor: provide a valid actor identifier of at most 200 characters.");
  if (context.source !== undefined) validateProject(context.source);
  if (context.taskId !== undefined) validateProject(context.taskId);
}

function validateEvent(value: unknown, project: string, expectedId?: string): UsageEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a usage event object.");
  const event = value as Record<string, unknown>;
  const allowed = new Set(["schema_version", "id", "at", "project", "operation", "actor", "source", "task_id", "concept_ids", "content_hash"]);
  if (Object.keys(event).some(key => !allowed.has(key)) || event.schema_version !== 1 || event.project !== project
    || typeof event.id !== "string" || !uuid.test(event.id) || expectedId !== undefined && event.id !== expectedId
    || !timestamp(event.at) || event.operation !== "search" && event.operation !== "show"
    || typeof event.actor !== "string" || typeof event.source !== "string"
    || event.task_id !== undefined && typeof event.task_id !== "string"
    || !Array.isArray(event.concept_ids) || event.concept_ids.some(id => typeof id !== "string")
    || new Set(event.concept_ids).size !== event.concept_ids.length) throw new Error("Invalid, unknown or mismatched usage event.");
  validateUsageContext({ actor: event.actor, source: event.source, ...(typeof event.task_id === "string" ? { taskId: event.task_id } : {}) });
  for (const id of event.concept_ids as string[]) validateConceptId(id);
  if (event.operation === "show") {
    if (event.concept_ids.length !== 1 || typeof event.content_hash !== "string" || !/^[a-f0-9]{64}$/.test(event.content_hash)) throw new Error("A show event requires one concept and its content hash.");
  } else if (event.content_hash !== undefined) throw new Error("Search events cannot declare a content hash.");
  return value as UsageEvent;
}

export async function recordUsage(root: string, project: string, operation: "search" | "show", conceptIds: string[], context: UsageContext = {}, hash?: string) {
  validateUsageContext(context);
  const event = validateEvent({ schema_version: 1, id: crypto.randomUUID(), at: new Date().toISOString(), project, operation,
    actor: context.actor ?? "agent/cli", source: context.source ?? "cli", concept_ids: conceptIds,
    ...(context.taskId === undefined ? {} : { task_id: context.taskId }), ...(hash === undefined ? {} : { content_hash: hash }),
  }, project);
  const files = await openProjectFiles(root, project);
  const relative = `${eventDirectory}/${event.id}.json`;
  await requireInitialized(files);
  await files.withWriteLock(async apply => {
    await requireInitialized(files);
    await apply([{ relative, before: undefined, after: `${JSON.stringify(event)}\n` }]);
  });
  return { event_id: event.id, path: `.space/${project}/memory/${relative}` };
}

function validateFilters(filters: UsageFilters) {
  validateUsageContext(filters);
  for (const [name, value] of [["since", filters.since], ["until", filters.until]] as const) {
    if (value !== undefined && !timestamp(value)) throw new Error(`${name}: use an ISO timestamp with a timezone.`);
  }
  if (filters.since !== undefined && filters.until !== undefined && Date.parse(filters.since) >= Date.parse(filters.until)) throw new Error("since must be earlier than until.");
}

async function readUsage(root: string, project: string, filters: UsageFilters): Promise<UsageEvent[]> {
  validateFilters(filters);
  try {
    const files = await openProjectFiles(root, project);
    await requireInitialized(files);
    const parent = await files.entries("usage");
    const events: UsageEvent[] = [];
    if (parent.some(entry => entry.name === "events")) {
      for (const entry of await files.entries(eventDirectory)) {
        if (!entry.name.endsWith(".json")) continue;
        const id = entry.name.slice(0, -5), path = `${eventDirectory}/${entry.name}`;
        try {
          if (!entry.isFile() || !uuid.test(id)) throw new Error("Expected a regular UUID-named event file.");
          const event = validateEvent(JSON.parse(await files.read(path)), project, id);
          const at = Date.parse(event.at);
          if (filters.since !== undefined && at < Date.parse(filters.since)
            || filters.until !== undefined && at >= Date.parse(filters.until)
            || filters.actor !== undefined && event.actor !== filters.actor
            || filters.source !== undefined && event.source !== filters.source
            || filters.taskId !== undefined && event.task_id !== filters.taskId) continue;
          events.push(event);
        } catch (error) { throw new MemoryError("INVALID_USAGE_LOG", `${path}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
    await requireInitialized(files);
    return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || compare(b.id, a.id));
  } catch (error) { throw new MemoryReadError(error instanceof Error ? error.message : String(error), { cause: error }); }
}

export async function listUsage(root: string, project: string, filters: UsageFilters = {}, options: { limit?: number; all?: boolean } = {}) {
  if (options.all && options.limit !== undefined) throw new Error("--all cannot be combined with --limit.");
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1)) throw new Error("--limit must be a positive safe integer.");
  const events = await readUsage(root, project, filters);
  return { total: events.length, events: options.all ? events : events.slice(0, Math.min(options.limit ?? 20, 100)) };
}

export async function usageStats(root: string, project: string, filters: UsageFilters = {}) {
  const events = await readUsage(root, project, filters);
  const concepts = new Map<string, { concept_id: string; search_results: number; shows: number }>();
  let searches = 0, shows = 0, emptySearches = 0;
  for (const event of events) {
    if (event.operation === "show") shows++;
    else { searches++; if (!event.concept_ids.length) emptySearches++; }
    for (const id of event.concept_ids) {
      const counts = concepts.get(id) ?? { concept_id: id, search_results: 0, shows: 0 };
      if (event.operation === "show") counts.shows++; else counts.search_results++;
      concepts.set(id, counts);
    }
  }
  return { events: events.length, searches, shows, empty_searches: emptySearches,
    first_at: events.at(-1)?.at ?? null, last_at: events[0]?.at ?? null,
    concepts: [...concepts.values()].sort((a, b) => b.shows - a.shows || b.search_results - a.search_results || compare(a.concept_id, b.concept_id)),
  };
}
