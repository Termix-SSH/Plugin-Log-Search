import { describe, expect, it } from "vitest";
import {
  lineTime,
  offsetMinutes,
  parseDockerOutput,
  parseFilesOutput,
  parseJournalOutput,
} from "../../src/backend/parse";
import { parseSearch } from "../../src/backend/query";

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);

describe("lineTime", () => {
  it("reads an ISO time with a zone", () => {
    expect(lineTime("2026-11-05T10:00:00Z hello", 0, NOW)).toBe(
      Date.UTC(2026, 10, 5, 10, 0, 0),
    );
    expect(lineTime("2026-11-05T10:00:00+02:00 hello", 0, NOW)).toBe(
      Date.UTC(2026, 10, 5, 8, 0, 0),
    );
  });

  it("uses the host zone when the line has none", () => {
    expect(lineTime("2026-11-05 10:00:00 hello", 60, NOW)).toBe(
      Date.UTC(2026, 10, 5, 9, 0, 0),
    );
    expect(lineTime("2026/11/05 10:00:00 [error]", 0, NOW)).toBe(
      Date.UTC(2026, 10, 5, 10, 0, 0),
    );
  });

  it("reads syslog times", () => {
    expect(lineTime("Nov  5 11:30:00 host sshd[1]: x", 0, NOW)).toBe(
      Date.UTC(2026, 10, 5, 11, 30, 0),
    );
  });

  it("puts a December line read in January in the year before", () => {
    const january = Date.UTC(2027, 0, 2, 0, 0, 0);
    expect(lineTime("Dec 31 23:00:00 host x", 0, january)).toBe(
      Date.UTC(2026, 11, 31, 23, 0, 0),
    );
  });

  it("reads a web server access time", () => {
    const line =
      '1.2.3.4 - - [05/Nov/2026:10:00:00 +0100] "GET / HTTP/1.1" 200';
    expect(lineTime(line, 0, NOW)).toBe(Date.UTC(2026, 10, 5, 9, 0, 0));
  });

  it("returns 0 for a line with no time", () => {
    expect(lineTime("just some text", 0, NOW)).toBe(0);
  });
});

describe("offsetMinutes", () => {
  it("reads +0100 and -05:30", () => {
    expect(offsetMinutes("+0100")).toBe(60);
    expect(offsetMinutes("-05:30")).toBe(-330);
    expect(offsetMinutes("junk")).toBe(0);
  });
});

describe("parseFilesOutput", () => {
  it("keeps the file as origin and falls back to the file time", () => {
    const out = [
      "@@TZ +0000",
      "@@FILE 1793000000 /var/log/app.log",
      "2026-11-05T10:00:00Z boot ok",
      "no time here",
      "@@FILE 1793000100 /var/log/other.log",
      "[error] broke",
    ].join("\n");
    const { entries } = parseFilesOutput(out, NOW);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      origin: "/var/log/app.log",
      time: Date.UTC(2026, 10, 5, 10, 0, 0),
    });
    expect(entries[1].time).toBe(1793000000 * 1000);
    expect(entries[2]).toMatchObject({
      origin: "/var/log/other.log",
      level: "error",
    });
  });

  it("drops lines that hold a NUL", () => {
    const out = "@@FILE 1 /var/log/x\nbad\0line\ngood";
    expect(parseFilesOutput(out, NOW).entries.map((e) => e.message)).toEqual([
      "good",
    ]);
  });
});

describe("parseDockerOutput", () => {
  it("reads the timestamp and container", () => {
    const out = [
      "@@C web",
      "2026-11-05T10:00:00.123456789Z GET / 200",
      "2026-11-05T10:00:01Z ERROR upstream down",
    ].join("\n");
    const { entries } = parseDockerOutput(out);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      origin: "web",
      message: "GET / 200",
      time: Date.UTC(2026, 10, 5, 10, 0, 0, 123),
    });
    expect(entries[1].level).toBe("error");
  });

  it("reports a missing runtime and a failed list", () => {
    expect(parseDockerOutput("@@NODOCKER").error).toMatch(/not installed/);
    expect(parseDockerOutput("@@ERR permission denied").error).toBe(
      "permission denied",
    );
  });
});

describe("parseJournalOutput", () => {
  it("maps the entry", () => {
    const line = JSON.stringify({
      __REALTIME_TIMESTAMP: String(Date.UTC(2026, 10, 5, 10, 0, 0) * 1000),
      PRIORITY: "3",
      _SYSTEMD_UNIT: "nginx.service",
      MESSAGE: "upstream timed out",
    });
    const { entries } = parseJournalOutput(line, parseSearch({}, NOW), NOW);
    expect(entries).toEqual([
      {
        time: Date.UTC(2026, 10, 5, 10, 0, 0),
        origin: "nginx.service",
        level: "error",
        message: "upstream timed out",
      },
    ]);
  });
});
