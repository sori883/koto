import { maxFileBytes } from "./files.ts";

const fields: Record<string, [string, "string" | "boolean" | "array" | "number" | "metadata"]> = {
  root: ["root", "string"], project: ["project", "string"], actor: ["actor", "string"],
  type: ["type", "string"], title: ["title", "string"], description: ["desc", "string"],
  status: ["status", "string"], tags: ["tags", "string"], body: ["body", "string"],
  metadataFile: ["metadata-file", "string"], bodyFile: ["body-file", "string"],
  metadata: ["metadata-json", "metadata"], ifHash: ["if-hash", "string"],
  limit: ["limit", "number"], all: ["all", "boolean"], relations: ["relations", "boolean"],
  forPath: ["for-path", "string"], filter: ["filter", "array"], unset: ["unset", "array"],
  sync: ["sync", "boolean"], noIndex: ["no-index", "boolean"], noLog: ["no-log", "boolean"],
  dryRun: ["dry-run", "boolean"], strict: ["strict", "boolean"], drift: ["drift", "boolean"],
  stale: ["stale", "boolean"], staleWithin: ["stale-within", "string"],
  recordUsage: ["record-usage", "boolean"], usageSource: ["usage-source", "string"], taskId: ["task-id", "string"],
  since: ["since", "string"], until: ["until", "string"],
};

export async function inputArguments(argv: string[]): Promise<string[]> {
  const end = argv.indexOf("--");
  if (!argv.slice(0, end < 0 ? undefined : end).some(arg => arg === "--input-json" || arg.startsWith("--input-json="))) return argv;
  let raw: string;
  if (argv.length === 2 && argv[0] === "--input-json") raw = argv[1]!;
  else if (argv.length === 1 && argv[0]!.startsWith("--input-json=")) raw = argv[0]!.slice(13);
  else throw new Error("Use --input-json alone, with a JSON object or '-' for stdin.");
  if (raw === "-") {
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of Bun.stdin.stream()) {
      size += chunk.length;
      if (size > maxFileBytes) throw new Error("JSON input exceeds 16 MiB.");
      chunks.push(chunk);
    }
    raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  }
  if (Buffer.byteLength(raw) > maxFileBytes) throw new Error("JSON input exceeds 16 MiB.");
  const request = JSON.parse(raw);
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("JSON input must be an object.");
  if (!Array.isArray(request.command) || !request.command.length || !request.command.every((part: unknown) => typeof part === "string" && part.length)) throw new Error("command must be a nonempty string array.");
  const result = ["--json"];
  for (const [key, value] of Object.entries(request)) {
    if (key === "command") continue;
    const definition = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (!definition) throw new Error(`Unknown JSON input field: ${key}`);
    const [flag, type] = definition;
    if (type === "metadata") {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("metadata must be an object.");
      result.push(`--${flag}`, JSON.stringify(value));
    } else if (type === "array") {
      if (!Array.isArray(value) || !value.every(item => typeof item === "string")) throw new Error(`${key} must be a string array.`);
      for (const item of value) result.push(`--${flag}`, item);
    } else {
      if (typeof value !== type || type === "number" && !Number.isSafeInteger(value)) throw new Error(`${key} must be ${type}.`);
      if (type === "boolean") { if (value) result.push(`--${flag}`); }
      else result.push(`--${flag}`, String(value));
    }
  }
  return [...result, "--", ...request.command];
}
