import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTicket, graphTickets, listTickets, parseTicket, serializeTicket, setStatus, TicketError } from "../plugin/skills/ticket/scripts/ticket.ts";

let root: string;
const tickets = () => join(root, ".space", "tickets");
const read = (id: string) => readFileSync(join(tickets(), id, "ticket.md"), "utf8");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ticket-test-"));
  mkdirSync(tickets(), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("new", () => {
  test("writes a pending ticket with the template", () => {
    createTicket(root, "api", "APIを作る", { now: new Date("2026-05-24T09:00:00.123Z") });
    expect(read("api")).toBe(
      [
        "---",
        "id: api",
        "title: APIを作る",
        "status: pending",
        "parent:",
        "depends_on: []",
        "created: 2026-05-24T09:00:00Z",
        "updated: 2026-05-24T09:00:00Z",
        "---",
        "",
        "# APIを作る",
        "",
        "## 目的",
        "",
        "## 終了条件",
        "",
        "## 成果物",
        "",
        "## checkpoint",
        "",
        "## 結果",
        "",
      ].join("\n"),
    );
  });

  test("records parent and dependencies", () => {
    createTicket(root, "api", "API");
    createTicket(root, "schema", "Schema");
    createTicket(root, "validation", "Validation", { parent: "api", dependsOn: ["schema"] });
    const ticket = parseTicket(read("validation"), "validation");
    expect(ticket.parent).toBe("api");
    expect(ticket.dependsOn).toEqual(["schema"]);
  });

  test("rejects bad input without writing", () => {
    createTicket(root, "api", "API");
    expect(() => createTicket(root, "api", "again")).toThrow("already exists");
    expect(() => createTicket(root, "Bad", "x")).toThrow("invalid id");
    expect(() => createTicket(root, "x", "   ")).toThrow("title is empty");
    expect(() => createTicket(root, "x", "x", { parent: "nope" })).toThrow("parent ticket not found");
    expect(() => createTicket(root, "x", "x", { dependsOn: ["nope"] })).toThrow("dependency ticket not found");
    expect(() => createTicket(root, "x", "x", { dependsOn: ["x"] })).toThrow("depend on itself");
    expect(listTickets(root).map((t) => t.id)).toEqual(["api"]);
  });

  test("flattens a multi-line title", () => {
    createTicket(root, "api", "line one\nline\ttwo");
    expect(parseTicket(read("api"), "api").title).toBe("line one line two");
  });

  test("requires setup", () => {
    rmSync(join(root, ".space"), { recursive: true });
    expect(() => createTicket(root, "api", "API")).toThrow("Run the setup skill first");
  });

  test("refuses a symlinked tickets directory", () => {
    rmSync(tickets(), { recursive: true });
    const elsewhere = mkdtempSync(join(tmpdir(), "ticket-elsewhere-"));
    symlinkSync(elsewhere, tickets());
    expect(() => createTicket(root, "api", "API")).toThrow("not a plain directory");
    rmSync(elsewhere, { recursive: true, force: true });
  });
});

describe("list", () => {
  test("marks pending tickets ready only when every dependency is done", () => {
    createTicket(root, "a", "A");
    createTicket(root, "b", "B", { dependsOn: ["a"] });
    expect(listTickets(root, { ready: true }).map((t) => t.id)).toEqual(["a"]);
    setStatus(root, "a", "running");
    setStatus(root, "a", "done");
    expect(listTickets(root, { ready: true }).map((t) => t.id)).toEqual(["b"]);
    expect(listTickets(root, { status: "done" }).map((t) => t.id)).toEqual(["a"]);
    expect(listTickets(root).find((t) => t.id === "a")!.ready).toBeNull();
  });

  test("stops on a broken ticket instead of skipping it", () => {
    createTicket(root, "a", "A");
    writeFileSync(join(tickets(), "a", "ticket.md"), "no frontmatter\n");
    expect(() => listTickets(root)).toThrow(TicketError);
  });

  test("stops when the id does not match the folder", () => {
    createTicket(root, "a", "A");
    writeFileSync(join(tickets(), "a", "ticket.md"), read("a").replace("id: a", "id: b"));
    expect(() => listTickets(root)).toThrow("does not match its folder");
  });
});

describe("status", () => {
  test("follows the allowed transitions", () => {
    createTicket(root, "a", "A");
    expect(() => setStatus(root, "a", "done")).toThrow("cannot change a from pending to done");
    for (const to of ["running", "paused", "running", "done", "pending", "cancelled", "pending"] as const) {
      setStatus(root, "a", to);
      expect(parseTicket(read("a"), "a").status).toBe(to);
    }
  });

  test("blocks running until dependencies are done", () => {
    createTicket(root, "a", "A");
    createTicket(root, "b", "B", { dependsOn: ["a"] });
    expect(() => setStatus(root, "b", "running")).toThrow("dependency a is pending, not done");
  });

  test("blocks done until children are done or cancelled", () => {
    createTicket(root, "parent", "P");
    createTicket(root, "child", "C", { parent: "parent" });
    setStatus(root, "parent", "running");
    expect(() => setStatus(root, "parent", "done")).toThrow("child child is pending");
    setStatus(root, "child", "cancelled");
    setStatus(root, "parent", "done");
  });

  test("rewrites only status and updated, keeping the body and file mode", () => {
    createTicket(root, "a", "A", { now: new Date("2026-05-24T09:00:00Z") });
    const file = join(tickets(), "a", "ticket.md");
    const edited = read("a").replace("## 目的\n", "## 目的\nなぜ: 理由 --- を含む\n");
    writeFileSync(file, edited);
    chmodSync(file, 0o600);
    setStatus(root, "a", "running", new Date("2026-05-24T10:00:00Z"));
    expect(read("a")).toBe(
      edited.replace("status: pending", "status: running").replace("updated: 2026-05-24T09:00:00Z", "updated: 2026-05-24T10:00:00Z"),
    );
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe("graph", () => {
  const build = () => {
    createTicket(root, "api", "API");
    createTicket(root, "schema", "Schema", { parent: "api" });
    createTicket(root, "validation", "Validation", { parent: "api", dependsOn: ["schema"] });
    createTicket(root, "deep", "Deep", { parent: "validation" });
    createTicket(root, "docs", 'Say "hi" <b>', { dependsOn: ["validation"] });
    setStatus(root, "schema", "running");
    setStatus(root, "schema", "done");
  };

  test("draws a parent/child tree with status and dependencies", () => {
    build();
    expect(graphTickets(root)).toBe(
      [
        "api [pending, ready] API",
        "├─ schema [done] Schema",
        "└─ validation [pending, ready] Validation  ← depends: schema(done)",
        "   └─ deep [pending, ready] Deep",
        'docs [pending, blocked] Say "hi" <b>  ← depends: validation(pending)',
        "",
      ].join("\n"),
    );
  });

  test("shows tickets caught in a hand-edited parent cycle", () => {
    createTicket(root, "a", "A");
    createTicket(root, "b", "B", { parent: "a" });
    const file = join(tickets(), "a", "ticket.md");
    writeFileSync(file, read("a").replace("parent:\n", "parent: b\n"));
    expect(graphTickets(root)).toBe("a [pending, ready] A\n└─ b [pending, ready] B\n");
  });

  test("says so when there are no tickets", () => {
    expect(graphTickets(root)).toBe("(no tickets)\n");
  });

  test("emits Mermaid with escaped labels, parent lines and dependency arrows", () => {
    build();
    const mermaid = graphTickets(root, "mermaid");
    expect(mermaid).toStartWith("flowchart TD\n");
    expect(mermaid).toContain('  t_schema["schema<br/>done<br/>Schema"]:::done\n');
    expect(mermaid).toContain('  t_docs["docs<br/>pending, blocked<br/>Say #quot;hi#quot; #lt;b#gt;"]:::pending\n');
    expect(mermaid).toContain("  t_api -.- t_validation\n");
    expect(mermaid).toContain("  t_validation -.- t_deep\n");
    expect(mermaid).toContain("  t_schema --> t_validation\n");
    expect(mermaid).toContain("  t_validation --> t_docs\n");
    for (const status of ["pending", "running", "paused", "done", "cancelled", "missing"]) {
      expect(mermaid).toContain(`  classDef ${status} `);
    }
  });

  test("marks a dependency whose ticket folder is gone", () => {
    createTicket(root, "a", "A");
    createTicket(root, "b", "B", { dependsOn: ["a"] });
    createTicket(root, "c", "C", { dependsOn: ["a"] });
    rmSync(join(tickets(), "a"), { recursive: true });
    const mermaid = graphTickets(root, "mermaid");
    expect(mermaid.split('t_a["a<br/>missing"]:::missing').length).toBe(2);
    expect(graphTickets(root)).toContain("← depends: a(missing)");
  });
});

describe("parse", () => {
  test("round-trips through serialize", () => {
    createTicket(root, "a", "A");
    const text = read("a");
    expect(serializeTicket(parseTicket(text, "a"))).toBe(text);
  });

  test("rejects unknown, duplicate and missing keys", () => {
    createTicket(root, "a", "A");
    const text = read("a");
    expect(() => parseTicket(text.replace("parent:", "owner: me\nparent:"), "f")).toThrow("unknown frontmatter key");
    expect(() => parseTicket(text.replace("parent:", "id: a\nparent:"), "f")).toThrow("duplicate frontmatter key");
    expect(() => parseTicket(text.replace("parent:\n", ""), "f")).toThrow("missing frontmatter key 'parent'");
    expect(() => parseTicket(text.replace("depends_on: []", "depends_on: a"), "f")).toThrow("depends_on must look like");
  });
});

describe("cli", () => {
  const run = (...args: string[]) =>
    Bun.spawnSync(["bun", join(import.meta.dir, "../plugin/skills/ticket/scripts/ticket.ts"), ...args], { stdout: "pipe", stderr: "pipe" });

  test("prints tab-separated rows and exits 2 on errors", () => {
    expect(run("new", root, "a", "A").exitCode).toBe(0);
    const list = run("list", root);
    expect(list.stdout.toString()).toBe("id\tstatus\tready\tparent\tdepends_on\ttitle\na\tpending\tyes\t-\t\tA\n");
    const bad = run("status", root, "a", "done");
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr.toString()).toContain("error: cannot change a from pending to done");
  });

  test("exits 1 with usage on unknown options", () => {
    const result = run("list", root, "--bogus");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Usage:");
  });
});
