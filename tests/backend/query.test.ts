import { describe, expect, it } from "vitest";
import {
  guessLevel,
  levelPasses,
  lineMatcher,
  parseSearch,
  priorityLevel,
} from "../../src/backend/query";

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);

describe("parseSearch", () => {
  it("fills defaults", () => {
    const req = parseSearch({}, NOW);
    expect(req.sources).toEqual(["journal", "files", "docker"]);
    expect(req.to).toBe(NOW);
    expect(req.from).toBe(NOW - 3_600_000);
    expect(req.limit).toBe(500);
    expect(req.level).toBe("all");
  });

  it("caps the range at 7 days and the limit at 2000", () => {
    const req = parseSearch({ from: 1, limit: 99999 }, NOW);
    expect(req.from).toBe(NOW - 7 * 24 * 3_600_000);
    expect(req.limit).toBe(2000);
  });

  it("keeps only known sources", () => {
    expect(parseSearch({ sources: ["docker", "nope"] }, NOW).sources).toEqual([
      "docker",
    ]);
  });

  it("drops bad host ids and repeats", () => {
    expect(parseSearch({ hostIds: [1, 1, "x", -2, 3] }, NOW).hostIds).toEqual([
      1, 3,
    ]);
  });

  it("refuses too many hosts", () => {
    const hostIds = Array.from({ length: 51 }, (_, i) => i + 1);
    expect(() => parseSearch({ hostIds }, NOW)).toThrow(/at most 50/);
  });

  it("refuses long text and line breaks", () => {
    expect(() => parseSearch({ query: "a".repeat(201) }, NOW)).toThrow();
    expect(() => parseSearch({ query: "a\nb" }, NOW)).toThrow();
  });

  it("refuses a broken or risky pattern", () => {
    expect(() => parseSearch({ query: "(", regex: true }, NOW)).toThrow(
      /not a valid pattern/,
    );
    expect(() => parseSearch({ query: "(a+)+$", regex: true }, NOW)).toThrow(
      /too complex/,
    );
  });

  it("accepts a normal pattern", () => {
    expect(parseSearch({ query: "error [0-9]+", regex: true }, NOW).regex).toBe(
      true,
    );
  });

  it("refuses an empty range", () => {
    expect(() => parseSearch({ from: NOW, to: NOW }, NOW)).toThrow(/range/);
  });
});

describe("lineMatcher", () => {
  const base = parseSearch({}, NOW);

  it("matches everything for an empty search", () => {
    expect(lineMatcher(base)("anything")).toBe(true);
  });

  it("is case insensitive by default", () => {
    const match = lineMatcher({ ...base, query: "Failed" });
    expect(match("auth FAILED for root")).toBe(true);
    expect(match("all good")).toBe(false);
  });

  it("can match case", () => {
    const match = lineMatcher({
      ...base,
      query: "Failed",
      caseSensitive: true,
    });
    expect(match("auth FAILED")).toBe(false);
    expect(match("Failed")).toBe(true);
  });

  it("treats plain text literally", () => {
    const match = lineMatcher({ ...base, query: "a.b" });
    expect(match("a.b")).toBe(true);
    expect(match("axb")).toBe(false);
  });

  it("runs a regex", () => {
    const match = lineMatcher({ ...base, query: "code=\\d+", regex: true });
    expect(match("exit code=137")).toBe(true);
    expect(match("exit code=x")).toBe(false);
  });
});

describe("levels", () => {
  it("guesses from the text", () => {
    expect(guessLevel("FATAL: out of memory")).toBe("error");
    expect(guessLevel("Warning: disk 90%")).toBe("warn");
    expect(guessLevel("debug: tick")).toBe("debug");
    expect(guessLevel("started")).toBe("info");
  });

  it("maps journal priorities", () => {
    expect(priorityLevel(3)).toBe("error");
    expect(priorityLevel(4)).toBe("warn");
    expect(priorityLevel(6)).toBe("info");
    expect(priorityLevel(7)).toBe("debug");
  });

  it("filters", () => {
    expect(levelPasses("warn", "error")).toBe(false);
    expect(levelPasses("warn", "warn")).toBe(true);
    expect(levelPasses("error", "warn")).toBe(true);
    expect(levelPasses("info", "warn")).toBe(false);
    expect(levelPasses("info", "all")).toBe(true);
  });
});
