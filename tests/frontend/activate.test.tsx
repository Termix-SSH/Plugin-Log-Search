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
  get: vi.fn(async () => ({
    data: {
      hosts: [
        { id: 1, name: "alpha", folder: null },
        { id: 2, name: "beta", folder: null },
      ],
    },
  })),
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
    );
  });
});
