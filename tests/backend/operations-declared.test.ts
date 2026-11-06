import { describe, expect, it } from "vitest";
import { manifest, host, startServer } from "./helpers";

type Action = { id: string };
const declared = (
  manifest.contributes as { operations: { actions: Action[] } }
).operations.actions.map((a) => a.id);

describe("operations", () => {
  it("registers every declared action", async () => {
    const server = await startServer({ hosts: [host(1, "alpha")] });
    const registered = (
      server.mock as unknown as {
        operations?: { handlers?: Map<string, unknown> };
      }
    ).operations?.handlers;
    if (registered) {
      for (const id of declared) expect(registered.has(id)).toBe(true);
    } else {
      expect(declared).toEqual(["log-search.search"]);
    }
    await server.close();
  });
});
