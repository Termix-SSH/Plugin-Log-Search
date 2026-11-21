import { afterEach, describe, expect, it } from "vitest";
import { createSavedStore } from "../../src/backend/saved.js";
import { createSearch } from "../../src/backend/search.js";
import { createRemote } from "../../src/backend/remote.js";
import { saved } from "../../src/backend/tables.js";
import { createWatch } from "../../src/backend/watch.js";
import { host, startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const lines = (count: number) =>
  `@@TZ +0000\n@@FILE ${Math.floor(Date.now() / 1000)} /var/log/app.log\n${Array.from(
    { length: count },
    (_, i) => `ERROR payment failed ${i}`,
  ).join("\n")}\n`;

async function setup(counts: number[]) {
  const actors: Array<string | undefined> = [];
  let call = 0;
  server = await startServer({
    hosts: [host(1, "alpha")],
    exec: async () => {
      actors.push(server!.mock.ctx.currentActor() ?? undefined);
      return { stdout: lines(counts[Math.min(call++, counts.length - 1)]) };
    },
  });
  const ctx = server.mock.ctx;
  const store = createSavedStore(ctx, await ctx.db.define(saved));
  const watch = createWatch(ctx, store, createSearch(ctx, createRemote(ctx)));
  const row = await store.create("user-1", {
    name: "Payments",
    search: {
      query: "payment failed",
      regex: false,
      caseSensitive: false,
      hostIds: [],
      sources: ["files"],
      range: "1h",
      level: "all",
      origin: "",
    },
    alert: { enabled: true, everyMinutes: 5, minMatches: 2, channelIds: [9] },
  });
  // The watch runs with nobody signed in.
  server.mock.setActor(undefined);
  return { store, watch, row, actors };
}

const MIN = 60_000;

describe("saved search alerts", () => {
  it("alert once on a match and once when it goes quiet, as the owner", async () => {
    const { store, watch, row, actors } = await setup([3, 5, 0]);
    const t0 = Date.now();
    await watch.tick(t0);
    await watch.tick(t0 + 6 * MIN);
    await watch.tick(t0 + 12 * MIN);

    const sent = server!.mock.notifications.map((n) => n.notification);
    expect(sent).toEqual([
      expect.objectContaining({
        audience: { userId: "user-1" },
        category: "log-search.match",
        title: "Payments: 3 matching log lines",
        channelIds: [9],
      }),
      expect.objectContaining({
        category: "log-search.quiet",
        title: "Payments: quiet again",
      }),
    ]);
    expect(actors.every((a) => a === "user-1")).toBe(true);
    const after = await store.find("user-1", row.id);
    expect(after).toMatchObject({ lastCount: 0 });
    expect(!!after?.alertActive).toBe(false);
  });

  it("waits for its interval and stays quiet below the threshold", async () => {
    const { watch, actors } = await setup([1]);
    const t0 = Date.now();
    await watch.tick(t0);
    await watch.tick(t0 + 2 * MIN);
    expect(actors).toHaveLength(1);
    expect(server!.mock.notifications).toEqual([]);
  });
});
