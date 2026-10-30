import { expect, test } from "bun:test";
import { resolve } from "node:path";

const scripts = resolve(import.meta.dir, "../../skills/natural-japanese/scripts");

// Expected counts come from upstream dev/check-fixtures.sh at 9a78a42964096da509b8f3e011f0085a5f080151.
for (const [fixture, experimental, expected] of [
  ["ai-smelly.md", false, 25],
  ["ai-smelly.md", true, 33],
  ["natural.md", false, 0],
  ["natural.md", true, 0],
] as const) {
  test(`upstream natural-japanese: ${fixture}, experimental=${experimental}`, async () => {
    const source = resolve(scripts, "fixtures", fixture);
    const before = await Bun.file(source).text();
    const child = Bun.spawn(["uv", "run", resolve(scripts, "lint.py"), source, "--json", ...(experimental ? ["--experimental"] : [])], { stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, error: code === 0 ? "" : err }).toEqual({ code: 0, error: "" });
    expect(JSON.parse(out).findings).toHaveLength(expected);
    expect(await Bun.file(source).text()).toBe(before);
  }, 60000);
}
