import { lstat, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { instructionFiles, projectSkillRoots } from "../skills/setup/scripts/lib/model.ts";
import type { Entry } from "../skills/setup/scripts/lib/model.ts";

type Files = Map<string, Buffer>;
const products = ["codex", "claude-code"] as const;
const catalogs = [".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json"];
const ignored = new Set(["node_modules", "__pycache__", ".venv", ".DS_Store", ".gitkeep"]);
const skillParts = new Set(["SKILL.md", "LICENSE", "LICENSE.md", "UNICODE-LICENSE.txt", "references", "assets", "scripts", "agents"]);
const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");

async function filesAt(directory: string, optional = false): Promise<Files> {
  const files: Files = new Map();
  async function visit(path: string, prefix: string) {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Symlink is not a distribution source: ${path}`);
    if (info.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) {
        if (!ignored.has(entry)) await visit(join(path, entry), prefix ? `${prefix}/${entry}` : entry);
      }
    } else if (info.isFile()) files.set(prefix, await readFile(path));
    else throw new Error(`Unsupported distribution source: ${path}`);
  }
  try { await visit(directory, ""); }
  catch (error) { if (!(optional && (error as NodeJS.ErrnoException).code === "ENOENT")) throw error; }
  return files;
}

function checkLinks(files: Files) {
  for (const [path, value] of files) {
    if (!path.endsWith(".md")) continue;
    const text = value.toString().replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1]!.replace(/^<|>$/g, "");
      if (/^[a-z][\w+.-]*:/i.test(link) || link.includes("{{")) continue;
      const [file, fragment] = decodeURIComponent(link).split("#");
      const target = file ? posix.normalize(posix.join(posix.dirname(path), file)) : path;
      if (target.startsWith("../") || posix.isAbsolute(target) || !files.has(target) && ![...files.keys()].some(key => key.startsWith(`${target}/`))) throw new Error(`Broken distribution link: ${path} -> ${link}`);
      if (fragment && files.has(target) && target.endsWith(".md")) {
        const headings = [...files.get(target)!.toString().matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => m[1]!.toLowerCase().replace(/[`*_]/g, "").replace(/[^\p{L}\p{N}_ -]/gu, "").replaceAll(" ", "-"));
        if (!headings.includes(fragment)) throw new Error(`Broken distribution link anchor: ${path} -> ${link}`);
      }
    }
  }
}

export async function distribution(root: string): Promise<Files> {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const version = packageJson.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)) throw new Error("Root version must be semver");
  const common: Files = new Map();
  for (const name of (await readdir(join(root, "skills"))).sort()) {
    const directory = join(root, "skills", name);
    if ((await lstat(directory)).isSymbolicLink()) throw new Error(`Symlink skill: ${name}`);
    if (!(await lstat(directory)).isDirectory()) continue;
    if (!await Bun.file(join(directory, "SKILL.md")).exists()) continue;
    for (const part of (await readdir(directory)).sort()) {
      if (!skillParts.has(part)) continue;
      for (const [path, body] of await filesAt(join(directory, part))) common.set(`skills/${name}/${part}${path ? `/${path}` : ""}`, body);
    }
  }
  for (const [path, body] of await filesAt(join(root, "space/babel"))) common.set(`space/babel/${path}`, body);
  const result: Files = new Map();
  for (const product of products) {
    const source = join(root, "packaging", product);
    const manifest = JSON.parse(await readFile(join(source, "plugin.json"), "utf8"));
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(manifest.name)) throw new Error("Invalid plugin name");
    const name: string = manifest.name, prefix = `dist/${product}/${name}`;
    const files = new Map(common);
    manifest.version = version;
    files.set(product === "codex" ? ".codex-plugin/plugin.json" : ".claude-plugin/plugin.json", json(manifest));
    for (const part of ["templates", "agents", "assets"]) for (const [path, body] of await filesAt(join(source, part), true)) files.set(`${part}/${path}`, body);
    if (product === "claude-code") {
      for (const [, body] of await filesAt(join(root, "packaging/copilot/templates/copilot-instructions.md"))) files.set("templates/copilot-instructions.md", body);
    }
    const setupFiles: Entry[] = [];
    for (const path of [...files.keys()].sort()) {
      if (path.startsWith("space/babel/")) setupFiles.push({ source: path, destination: `.${path}`, mode: posix.basename(path) === "index.md" ? "merge-index" : ["space/babel/log.md", "space/babel/LICENSE"].includes(path) ? "seed" : "copy" });
      if (product === "codex" && path.startsWith("templates/agents/")) setupFiles.push({ source: path, destination: `.codex/agents/${path.slice("templates/agents/".length)}`, mode: "copy" });
    }
    for (const target of product === "claude-code" ? ["claude-code", "copilot"] as const : ["codex"] as const) {
      const instruction = instructionFiles[target], template = `templates/${posix.basename(instruction)}`;
      const targetFiles = [...setupFiles];
      if (files.has(template)) targetFiles.push({ source: template, destination: instruction, mode: "managed-block" });
      files.set(target === product ? "setup-manifest.json" : `setup-manifest.${target}.json`, json({ schemaVersion: 1, plugin: name, product: target, version, files: targetFiles }));
      if (target === product) {
        const projectFiles = [...targetFiles];
        for (const path of [...files.keys()].sort()) {
          if (path.startsWith("skills/")) projectFiles.push({ source: path, destination: `${projectSkillRoots[product]}/${path.slice("skills/".length)}`, mode: "copy" });
          if (product === "claude-code" && path.startsWith("agents/")) projectFiles.push({ source: path, destination: `.claude/${path}`, mode: "copy" });
        }
        files.set("setup-manifest.project.json", json({ schemaVersion: 1, plugin: name, product, version, scope: "project", files: projectFiles }));
      }
    }
    checkLinks(files);
    for (const [path, body] of files) result.set(`${prefix}/${path}`, body);
    const marketplace = JSON.parse(await readFile(join(source, "marketplace.json"), "utf8"));
    if (!/^[A-Za-z0-9_-]+$/.test(marketplace.name)) throw new Error("Invalid marketplace name");
    marketplace.plugins = [product === "codex" ? {
      name, source: { source: "local", path: `./${prefix}` },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Productivity",
    } : { name, source: `./${prefix}`, version, description: manifest.description }];
    result.set(product === "codex" ? catalogs[0]! : catalogs[1]!, json(marketplace));
  }
  return new Map([...result].sort(([a], [b]) => a.localeCompare(b)));
}

export async function checkBuild(root: string): Promise<string[]> {
  const expected = await distribution(root), actual: Files = new Map();
  for (const [path, body] of await filesAt(join(root, "dist"), true)) actual.set(`dist/${path}`, body);
  for (const path of catalogs) { try { actual.set(path, await readFile(join(root, path))); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  const differences: string[] = [];
  for (const [path, content] of expected) {
    if (!actual.has(path)) differences.push(`missing: ${path}`);
    else if (!actual.get(path)!.equals(content)) differences.push(`changed: ${path}`);
  }
  for (const path of actual.keys()) if (!expected.has(path)) differences.push(`extra: ${path}`);
  return differences.sort();
}

export async function build(root: string): Promise<number> {
  const files = await distribution(root);
  const lockPath = join(root, ".build.lock");
  const lock = await open(lockPath, "wx");
  const stage = join(root, `.build-${crypto.randomUUID()}`), backup = `${stage}-previous`;
  let moved = false;
  try {
    for (const [path, body] of files) { await mkdir(dirname(join(stage, path)), { recursive: true }); await writeFile(join(stage, path), body); }
    try { await rename(join(root, "dist"), backup); moved = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    try { await rename(join(stage, "dist"), join(root, "dist")); }
    catch (error) { if (moved) await rename(backup, join(root, "dist")); throw error; }
    for (const path of catalogs) { await mkdir(dirname(join(root, path)), { recursive: true }); await rename(join(stage, path), join(root, path)); }
    await rm(backup, { recursive: true, force: true });
    return files.size;
  } finally { await rm(stage, { recursive: true, force: true }); await lock.close(); await rm(lockPath, { force: true }); }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--check")) throw new Error("Usage: bun scripts/build.ts [--check]");
    const root = resolve(import.meta.dir, "..");
    if (args.includes("--check")) {
      const differences = await checkBuild(root);
      if (differences.length) { process.stderr.write(differences.join("\n") + "\n"); process.exitCode = 1; }
      else process.stdout.write("Distribution matches its sources.\n");
    } else process.stdout.write(`Generated ${await build(root)} files.\n`);
  } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; }
}
