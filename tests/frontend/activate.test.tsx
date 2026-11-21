import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

const result = {
  entries: [
    {
      time: Date.UTC(2026, 10, 5, 10, 0, 0),
      hostId: 1,
      host: "alpha",
      source: "journal",
      origin: "nginx.service",
      level: "error",
      message: "upstream timed out",
    },
  ],
  hosts: [
    {
      hostId: 1,
      host: "alpha",
      status: "ok",
      count: 1,
      sources: { journal: { count: 1 } },
    },
    {
      hostId: 2,
      host: "beta",
      status: "error",
      count: 0,
      error: "connection refused",
      sources: {},
    },
  ],
  truncated: false,
  tookMs: 42,
};

const post = vi.fn(async () => ({ data: result }));
const api = {
  get: vi.fn(async (path: string) =>
    path === "/saved"
      ? {
          data: {
            saved: [
              {
                id: 7,
                name: "Timeouts",
                search: {
                  query: "timed out",
                  regex: false,
                  caseSensitive: false,
                  hostIds: [1],
                  sources: ["journal"],
                  range: "6h",
                  level: "error",
                  origin: "",
                },
                alert: {
                  enabled: true,
                  everyMinutes: 5,
                  minMatches: 1,
                  channelIds: [],
                },
                alertActive: false,
                lastRunAt: null,
                lastMatchAt: null,
                lastCount: null,
                lastError: null,
              },
            ],
          },
        }
      : {
          data: {
            hosts: [
              { id: 1, name: "alpha", folder: null },
              { id: 2, name: "beta", folder: null },
            ],
          },
        },
  ),
  post,
  put: vi.fn(async () => ({ data: {} })),
  delete: vi.fn(async () => ({ data: {} })),
} as never;

describe(`${manifest.id} frontend`, () => {
  it("registers the tab and rail item", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).toEqual(["log-search"]);
    expect(rendered.registered.railItems().map((item) => item.id)).toEqual([
      "log-search",
    ]);
  });

  it("searches and shows lines plus failed hosts", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales, api });
    rendered.renderTab("log-search", { isVisible: true });
    fireEvent.change(await screen.findByPlaceholderText("Search logs"), {
      target: { value: "timed" },
    });
    fireEvent.click(screen.getByText("Search"));
    expect(await screen.findByText("nginx.service")).toBeTruthy();
    expect(screen.getByText(/connection refused/)).toBeTruthy();
    expect(post).toHaveBeenCalledWith(
      "/search",
      expect.objectContaining({ query: "timed", sources: expect.any(Array) }),
      expect.objectContaining({ signal: expect.anything() }),
    );
  });
});

describe("sandboxed frame", () => {
  // A frame without allow-forms never fires submit, so search must not use a form.
  it("searches on Enter and renders no form", async () => {
    post.mockClear();
    rendered = await renderWithApp(plugin, { manifest, locales, api });
    rendered.renderTab("log-search", { isVisible: true });
    const input = await screen.findByPlaceholderText("Search logs");
    expect(document.querySelector("form")).toBeNull();
    fireEvent.change(input, { target: { value: "session" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("nginx.service")).toBeTruthy();
    expect(post).toHaveBeenCalledWith(
      "/search",
      expect.objectContaining({ query: "session" }),
      expect.objectContaining({ signal: expect.anything() }),
    );
  });
});

describe("stopping a search", () => {
  it("shows Stop while searching and cancels it on the server", async () => {
    let finish: (value: { data: unknown }) => void = () => {};
    const slowPost = vi.fn((path: string) =>
      path === "/search"
        ? new Promise<{ data: unknown }>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ data: { cancelled: true } }),
    );
    const slowApi = { ...(api as object), post: slowPost } as never;
    rendered = await renderWithApp(plugin, { manifest, locales, api: slowApi });
    rendered.renderTab("log-search", { isVisible: true });
    fireEvent.change(await screen.findByPlaceholderText("Search logs"), {
      target: { value: "slow" },
    });
    fireEvent.click(screen.getByText("Search"));
    fireEvent.click(await screen.findByRole("button", { name: /Stop/ }));
    const [, body, config] = slowPost.mock.calls[0] as unknown as [
      string,
      { runId: string },
      { signal: AbortSignal },
    ];
    expect(config.signal.aborted).toBe(true);
    expect(slowPost).toHaveBeenCalledWith("/search/cancel", {
      runId: body.runId,
    });
    finish({ data: result });
    expect(await screen.findByRole("button", { name: /Search/ })).toBeTruthy();
    expect(screen.queryByText("nginx.service")).toBeNull();
  });
});

describe("saved searches", () => {
  it("fills the search from a saved one", async () => {
    Object.assign(window.HTMLElement.prototype, {
      hasPointerCapture: () => false,
      releasePointerCapture: () => {},
      scrollIntoView: () => {},
    });
    rendered = await renderWithApp(plugin, { manifest, locales, api });
    rendered.renderTab("log-search", { isVisible: true });
    const picker = await screen.findByRole("combobox", { name: "Saved" });
    fireEvent.pointerDown(picker, { button: 0, pointerType: "mouse" });
    fireEvent.click(
      await screen.findByRole("option", { name: "Timeouts (alert on)" }),
    );
    expect(
      (screen.getByPlaceholderText("Search logs") as HTMLInputElement).value,
    ).toBe("timed out");
    expect(screen.getByText("Edit saved")).toBeTruthy();
  });
});

describe("terminal companion", () => {
  it("has a showPanel host setting and companion user settings", () => {
    const settings = manifest.contributes.settings as {
      host: { fields: Array<{ key: string }> };
      user: Array<{ key: string }>;
    };
    expect(settings.host.fields.map((f) => f.key)).toContain("showPanel");
    expect(settings.user.map((f) => f.key)).toContain("companionSide");
    expect(locales.companion.toggle).toBeTruthy();
  });
});
