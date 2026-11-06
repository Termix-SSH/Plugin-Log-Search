import http from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Router } from "express";
import {
  createMockCtx,
  type MockPluginContext,
} from "@termix-ssh/plugin-sdk/testing";
import type {
  PluginHostAccess,
  PluginHostSummary,
  PluginSshExecResult,
} from "@termix-ssh/plugin-sdk/backend";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";

export const manifest = manifestJson as unknown as PluginManifest;

export interface Call {
  hostId: number;
  command: string;
  stdin: string;
}

export interface TestServer {
  mock: MockPluginContext;
  calls: Call[];
  request: (
    method: string,
    path: string,
    body?: unknown,
    // Route bodies vary per test; asserting on them is the point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

export const host = (id: number, name: string): PluginHostSummary => ({
  id,
  userId: "user-1",
  name,
  ip: `10.0.0.${id}`,
  port: 22,
  username: "root",
  tags: null,
  folder: null,
  authType: "password",
});

/** The plugin on a real express app, with ctx.ssh.exec played by a fake. */
export async function startServer(
  options: {
    permissions?: string[];
    hosts?: PluginHostSummary[];
    /** Per host settings. Hosts not listed use the defaults. */
    hostSettings?: Record<number, Record<string, unknown>>;
    /** Hosts the user can't connect to. */
    denied?: number[];
    exec?: (
      hostId: number,
      command: string,
      stdin: string,
    ) => Promise<Partial<PluginSshExecResult>>;
  } = {},
): Promise<TestServer> {
  let router: Router | null = null;
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    router: () => (router = express.Router()),
    actor: "user-1",
    permissions: options.permissions ?? [`${manifest.id}.use`],
  });

  Object.assign(mock.ctx.settings, {
    getAll: async (scope: string, id?: number) =>
      scope === "host" && id ? (options.hostSettings?.[id] ?? {}) : {},
  });

  const hosts = options.hosts ?? [host(1, "alpha"), host(2, "beta")];
  Object.assign(mock.ctx.hosts, {
    list: async () => hosts,
    checkAccess: async (id: number): Promise<PluginHostAccess> => ({
      hasAccess: !options.denied?.includes(id),
      isOwner: true,
      isShared: false,
      permissionLevel: "manage",
    }),
  });

  const calls: Call[] = [];
  Object.assign(mock.ctx.ssh, {
    exec: async (
      hostId: number,
      command: string,
      opts?: { stdin?: string },
    ) => {
      const stdin = opts?.stdin ?? "";
      calls.push({ hostId, command, stdin });
      const reply = (await options.exec?.(hostId, command, stdin)) ?? {};
      return {
        stdout: "",
        stderr: "",
        code: 0,
        truncated: false,
        timedOut: false,
        ...reply,
      };
    },
  });

  const { activate } = await import("../../src/backend/index.js");
  await activate(mock.ctx);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => router!(req, res, next));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    mock,
    calls,
    async request(method, path, body) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
