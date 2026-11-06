import { afterEach, describe, expect, it } from "vitest";
import { host, startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

/** Answers by what the script reads. */
function exec(
  perHost: Record<
    number,
    { journal?: string; files?: string; docker?: string; fail?: string }
  >,
) {
  return async (hostId: number, _command: string, stdin: string) => {
    const h = perHost[hostId] ?? {};
    if (h.fail) return { code: 1, stderr: h.fail };
    if (stdin.includes("journalctl")) return { stdout: h.journal ?? "" };
    if (stdin.includes("@@NODOCKER")) return { stdout: h.docker ?? "" };
    return { stdout: h.files ?? "" };
  };
}

const journalLine = (ms: number, unit: string, message: string, p = 6) =>
  JSON.stringify({
    __REALTIME_TIMESTAMP: String(ms * 1000),
    PRIORITY: String(p),
    _SYSTEMD_UNIT: unit,
    MESSAGE: message,
  });

describe("GET /hosts", () => {
  it("lists hosts that are on and reachable", async () => {
    server = await startServer({
      hosts: [host(1, "alpha"), host(2, "beta"), host(3, "gamma")],
      hostSettings: { 2: { enableLogSearch: false } },
      denied: [3],
    });
    const res = await server.request("GET", "/hosts");
    expect(res.status).toBe(200);
    expect(res.body.hosts.map((h: { name: string }) => h.name)).toEqual([
      "alpha",
    ]);
  });

  it("needs the use permission", async () => {
    server = await startServer({ permissions: [] });
    expect((await server.request("GET", "/hosts")).status).toBe(403);
  });
});

describe("POST /search", () => {
  it("merges hosts and sources, newest first", async () => {
    server = await startServer({
      exec: exec({
        1: {
          journal: journalLine(NOW - 60_000, "nginx.service", "old timeout"),
          docker: `@@C web\n${iso(NOW - 10_000)} timeout again`,
        },
        2: {
          files: `@@FILE ${Math.floor(NOW / 1000)} /var/log/app.log\n${iso(NOW - 30_000)} timeout in app`,
        },
      }),
    });
    const res = await server.request("POST", "/search", {
      query: "timeout",
      from: NOW - 3_600_000,
    });
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e: { message: string }) => e.message)).toEqual(
      [
        "timeout again",
        expect.stringContaining("timeout in app"),
        "old timeout",
      ],
    );
    expect(res.body.entries[0]).toMatchObject({
      host: "alpha",
      source: "docker",
      origin: "web",
    });
    expect(res.body.hosts).toHaveLength(2);
    expect(res.body.truncated).toBe(false);
  });

  it("filters by text, level and name on our side", async () => {
    server = await startServer({
      exec: exec({
        1: {
          journal: [
            journalLine(NOW - 5000, "a.service", "boom", 3),
            journalLine(NOW - 4000, "a.service", "boom quiet", 6),
            journalLine(NOW - 3000, "b.service", "boom", 3),
          ].join("\n"),
        },
      }),
      hosts: [host(1, "alpha")],
    });
    const res = await server.request("POST", "/search", {
      query: "boom",
      level: "error",
      origin: "b.serv",
      sources: ["journal"],
    });
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].origin).toBe("b.service");
  });

  it("drops lines outside the time range", async () => {
    server = await startServer({
      exec: exec({
        1: {
          journal: journalLine(NOW - 5 * 3_600_000, "a.service", "ancient"),
        },
      }),
      hosts: [host(1, "alpha")],
    });
    const res = await server.request("POST", "/search", {
      from: NOW - 3_600_000,
      sources: ["journal"],
    });
    expect(res.body.entries).toHaveLength(0);
  });

  it("applies the limit and says it truncated", async () => {
    const lines = Array.from({ length: 5 }, (_, i) =>
      journalLine(NOW - (i + 1) * 1000, "a.service", `line ${i}`),
    ).join("\n");
    server = await startServer({
      exec: exec({ 1: { journal: lines } }),
      hosts: [host(1, "alpha")],
    });
    const res = await server.request("POST", "/search", {
      sources: ["journal"],
      limit: 2,
    });
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.truncated).toBe(true);
  });

  it("keeps going when one host fails", async () => {
    server = await startServer({
      exec: exec({
        1: { fail: "connection refused" },
        2: { journal: journalLine(NOW - 1000, "a.service", "fine") },
      }),
    });
    const res = await server.request("POST", "/search", {
      sources: ["journal"],
    });
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    const alpha = res.body.hosts.find(
      (h: { host: string }) => h.host === "alpha",
    );
    expect(alpha.status).toBe("error");
    expect(alpha.error).toBeTruthy();
  });

  it("only searches the chosen hosts and reports ones it can't", async () => {
    server = await startServer({
      hosts: [host(1, "alpha"), host(2, "beta")],
      denied: [2],
      exec: exec({ 1: { journal: journalLine(NOW - 1000, "a", "x") } }),
    });
    const res = await server.request("POST", "/search", {
      hostIds: [2, 9],
      sources: ["journal"],
    });
    expect(server.calls).toHaveLength(0);
    expect(
      res.body.hosts.every((h: { status: string }) => h.status === "error"),
    ).toBe(true);
  });

  it("skips hosts that turned Log Search off", async () => {
    server = await startServer({
      hostSettings: { 1: { enableLogSearch: false } },
      exec: exec({ 2: { journal: journalLine(NOW - 1000, "a", "x") } }),
    });
    await server.request("POST", "/search", { sources: ["journal"] });
    expect(new Set(server.calls.map((c) => c.hostId))).toEqual(new Set([2]));
  });

  it("refuses a bad search", async () => {
    server = await startServer();
    const res = await server.request("POST", "/search", {
      query: "(",
      regex: true,
    });
    expect(res.status).toBe(400);
  });

  it("never puts the search text on the command line", async () => {
    server = await startServer({ hosts: [host(1, "alpha")] });
    await server.request("POST", "/search", { query: "secret-token" });
    for (const call of server.calls) {
      expect(call.command).not.toContain("secret-token");
    }
  });
});
