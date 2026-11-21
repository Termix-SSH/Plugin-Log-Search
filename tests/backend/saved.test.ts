import { afterEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const filesOutput = `@@TZ +0000\n@@FILE ${Math.floor(Date.now() / 1000)} /var/log/app.log\nERROR payment failed\nall good\nERROR payment failed again\n`;

const body = (overrides: Record<string, unknown> = {}) => ({
  name: "Payment errors",
  search: {
    query: "payment failed",
    sources: ["files"],
    range: "6h",
    level: "all",
  },
  alert: { enabled: true, everyMinutes: 10, minMatches: 2, channelIds: [3] },
  ...overrides,
});

describe("saved searches", () => {
  it("are saved, listed, changed and deleted by their owner", async () => {
    server = await startServer();
    const created = await server.request("POST", "/saved", body());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Payment errors",
      search: { query: "payment failed", sources: ["files"], range: "6h" },
      alert: {
        enabled: true,
        everyMinutes: 10,
        minMatches: 2,
        channelIds: [3],
      },
      alertActive: false,
    });
    const id = created.body.id;

    const changed = await server.request(
      "PUT",
      `/saved/${id}`,
      body({ name: "Renamed", alert: { enabled: false } }),
    );
    expect(changed.body).toMatchObject({
      name: "Renamed",
      alert: { enabled: false, everyMinutes: 5, minMatches: 1 },
    });

    const list = await server.request("GET", "/saved");
    expect(list.body.saved.map((s: { id: number }) => s.id)).toEqual([id]);

    expect((await server.request("DELETE", `/saved/${id}`)).status).toBe(200);
    expect((await server.request("GET", "/saved")).body.saved).toEqual([]);
  });

  it("keep other people's saved searches out of reach", async () => {
    server = await startServer();
    const created = await server.request("POST", "/saved", body());
    server.mock.setActor("user-2");
    expect((await server.request("GET", "/saved")).body.saved).toEqual([]);
    for (const [method, path] of [
      ["PUT", `/saved/${created.body.id}`],
      ["DELETE", `/saved/${created.body.id}`],
      ["POST", `/saved/${created.body.id}/run`],
    ]) {
      expect((await server.request(method, path, body())).status).toBe(404);
    }
  });

  it("refuse a missing name or a bad pattern and clamp the alert", async () => {
    server = await startServer();
    expect(
      (await server.request("POST", "/saved", body({ name: "" }))).status,
    ).toBe(400);
    expect(
      (
        await server.request(
          "POST",
          "/saved",
          body({ search: { query: "(a+)+", regex: true } }),
        )
      ).status,
    ).toBe(400);
    const clamped = await server.request(
      "POST",
      "/saved",
      body({ alert: { enabled: true, everyMinutes: 99999, minMatches: -4 } }),
    );
    expect(clamped.body.alert).toMatchObject({
      everyMinutes: 1440,
      minMatches: 1,
    });
  });

  it("run now over their range", async () => {
    server = await startServer({
      hosts: [
        {
          id: 1,
          userId: "user-1",
          name: "alpha",
          ip: "10.0.0.1",
          port: 22,
          username: "root",
          tags: null,
          folder: null,
          authType: "password",
        },
      ],
      exec: async () => ({ stdout: filesOutput }),
    });
    const created = await server.request("POST", "/saved", body());
    const result = await server.request(
      "POST",
      `/saved/${created.body.id}/run`,
    );
    expect(result.status).toBe(200);
    expect(
      result.body.entries.map((e: { message: string }) => e.message),
    ).toEqual(["ERROR payment failed", "ERROR payment failed again"]);
  });
});
