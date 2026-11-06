import { describe, expect, it } from "vitest";
import { highlight, rangeMs, toPlainText } from "../../src/frontend/format";

describe("highlight", () => {
  it("marks plain text matches without regex rules", () => {
    expect(highlight("a.b axb a.b", "a.b", false, false)).toEqual([
      { text: "a.b", hit: true },
      { text: " axb ", hit: false },
      { text: "a.b", hit: true },
    ]);
  });

  it("marks regex matches", () => {
    expect(highlight("code=12 x", "\\d+", true, false)).toEqual([
      { text: "code=", hit: false },
      { text: "12", hit: true },
      { text: " x", hit: false },
    ]);
  });

  it("returns the text when there is no query or the pattern is bad", () => {
    expect(highlight("hello", "", false, false)).toEqual([
      { text: "hello", hit: false },
    ]);
    expect(highlight("hello", "(", true, false)).toEqual([
      { text: "hello", hit: false },
    ]);
  });
});

describe("helpers", () => {
  it("maps a range id to ms", () => {
    expect(rangeMs("15m")).toBe(900_000);
    expect(rangeMs("7d")).toBe(7 * 24 * 3_600_000);
  });

  it("writes entries as plain text", () => {
    const text = toPlainText([
      {
        time: Date.UTC(2026, 10, 5, 10, 0, 0),
        hostId: 1,
        host: "alpha",
        source: "journal",
        origin: "nginx.service",
        level: "error",
        message: "boom",
      },
    ]);
    expect(text).toBe(
      "2026-11-05T10:00:00.000Z alpha journal:nginx.service boom",
    );
  });
});
