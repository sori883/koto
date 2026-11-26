#!/usr/bin/env bun
// Create koto's storage area (.space/) in a project root.
// Safe to run again: it never overwrites or deletes existing files.
import { lstatSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const USAGE = "Usage: setup.ts <project-root>";

export class SetupError extends Error {}

export type Outcome = { result: "created" | "kept"; path: string };

function kind(path: string): "missing" | "directory" | "file" | "other" {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return "other";
    if (stat.isDirectory()) return "directory";
    if (stat.isFile()) return "file";
    return "other";
  } catch {
    return "missing";
  }
}

export function setup(rootArg: string): Outcome[] {
  let root: string;
  try {
    // The project root itself may be reached through a symlink; resolve it once.
    root = realpathSync(resolve(rootArg));
    if (!statSync(root).isDirectory()) throw new Error();
  } catch {
    throw new SetupError(`not a directory: ${resolve(rootArg)}`);
  }

  const space = join(root, ".space");
  // Each area is committed. Git does not track empty directories, so each gets a .gitkeep.
  const areas = [join(space, "tickets"), join(space, "kb")];
  const keeps = areas.map((area) => join(area, ".gitkeep"));

  // Check everything first so a refusal changes nothing.
  for (const path of [space, ...areas]) {
    const found = kind(path);
    if (found !== "missing" && found !== "directory") throw new SetupError(`exists but is not a plain directory: ${path}`);
  }
  for (const keep of keeps) {
    const found = kind(keep);
    if (found !== "missing" && found !== "file") throw new SetupError(`exists but is not a regular file: ${keep}`);
  }

  const outcomes: Outcome[] = [];
  const ensureDirectory = (path: string) => {
    if (kind(path) === "directory") {
      outcomes.push({ result: "kept", path });
    } else {
      mkdirSync(path);
      outcomes.push({ result: "created", path });
    }
  };
  const ensureKeep = (path: string) => {
    if (kind(path) === "file") {
      outcomes.push({ result: "kept", path });
    } else {
      writeFileSync(path, "", { flag: "wx" });
      outcomes.push({ result: "created", path });
    }
  };
  ensureDirectory(space);
  areas.forEach((area, i) => {
    ensureDirectory(area);
    ensureKeep(keeps[i]!);
  });
  return outcomes;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error(USAGE);
    process.exit(1);
  }
  try {
    for (const { result, path } of setup(args[0]!)) console.log(`${result}\t${path}`);
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    console.error(`error: ${error.message}`);
    process.exit(2);
  }
}
