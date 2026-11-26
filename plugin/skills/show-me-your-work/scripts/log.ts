#!/usr/bin/env bun
// Append a well-formed row to a show-me-your-work decision log (TSV).
import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

const USAGE = "Usage: log.ts <logfile> <phase> <decision> <why> <evidence> <result>";
const HEADER = "ts\tphase\tdecision\twhy\tevidence\tresult\n";

// Strip tabs/newlines/CR so cells stay on one line, and prefix any cell
// whose first char a spreadsheet would parse as a formula (=, +, -, @)
// with a single quote. Reviewers open this log in spreadsheets, so
// attacker-controlled evidence (PR titles, filenames, generated text)
// must not become formula execution.
export function clean(value: string): string {
  const flat = value.replace(/[\t\n\r]/g, " ");
  return /^[=+\-@]/.test(flat) ? `'${flat}` : flat;
}

const timestamp = (now: Date) => now.toISOString().replace(/\.\d{3}Z$/, "Z");

export function appendRow(logfile: string, cells: [string, string, string, string, string], now: Date = new Date()): string {
  mkdirSync(dirname(logfile), { recursive: true });
  let empty = true;
  try {
    empty = statSync(logfile).size === 0;
  } catch {
    empty = true;
  }
  // Append, never truncate. If the size check is wrong, the cost is one
  // stray header line, not the rows already written.
  if (empty) appendFileSync(logfile, HEADER);
  const row = [timestamp(now), ...cells.map(clean)].join("\t") + "\n";
  appendFileSync(logfile, row);
  return row;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 6) {
    console.error(USAGE);
    process.exit(1);
  }
  const [logfile, ...cells] = args as [string, string, string, string, string, string];
  appendRow(logfile, cells);
}
