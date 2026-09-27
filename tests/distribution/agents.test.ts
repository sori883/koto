import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { distribution } from "../../scripts/build.ts";

test("both agent formats keep the same instructions and leave runtime policy to the host", async () => {
  const files = await distribution(resolve(import.meta.dir, "../.."));
  for (const name of ["devlow-worker", "comment-curator"]) {
    const codex = Bun.TOML.parse(files.get(`dist/codex/koto/templates/agents/${name}.toml`)!.toString()) as Record<string, unknown>;
    const claude = files.get(`dist/claude-code/koto/agents/${name}.md`)!.toString();
    const match = /^---\n([\s\S]+?)\n---\n([\s\S]+)$/.exec(claude)!;
    const metadata = Bun.YAML.parse(match[1]!) as Record<string, unknown>;
    expect(codex.name).toBe(name); expect(metadata.name).toBe(name);
    expect(codex.description).toBe(metadata.description);
    expect((codex.developer_instructions as string).trim()).toBe(match[2]!.trim());
    expect(Object.keys(codex).sort()).toEqual(["description", "developer_instructions", "name"]);
    expect(Object.keys(metadata).sort()).toEqual(["description", "name"]);
  }
});
