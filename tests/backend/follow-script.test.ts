import { describe, expect, it } from "vitest";
import {
  createLineReader,
  followScript,
} from "../../src/backend/follow-script.js";

describe("followScript", () => {
  it("follows only the picked sources and stops when stdin closes", () => {
    const script = followScript(["journal", "docker"], ["/var/log"], "error");
    expect(script).toContain("journalctl -f -n 0 -q -o json --no-pager -p 3");
    expect(script).toContain("logs -f --tail 0 --timestamps");
    expect(script).not.toContain("tail -n 0 -F");
    expect(script).toContain("kill 0");
    expect(script.trim().endsWith("cat >/dev/null")).toBe(true);
  });

  it("quotes the log folders", () => {
    const script = followScript(
      ["files"],
      ["/var/log/my app'; rm -rf /"],
      "all",
    );
    expect(script).toContain(`'/var/log/my app'\\''; rm -rf /'`);
    expect(script).not.toContain("journalctl");
  });

  it("skips files when there are no log folders", () => {
    expect(followScript(["files"], [], "all")).not.toContain("tail -n 0 -F");
  });
});

describe("createLineReader", () => {
  const now = () => 1_700_000_000_000;

  it("reads journal JSON, with byte list messages", () => {
    const read = createLineReader(now);
    expect(
      read(
        `J\t${JSON.stringify({
          __REALTIME_TIMESTAMP: "1700000000123456",
          PRIORITY: "3",
          _SYSTEMD_UNIT: "nginx.service",
          MESSAGE: "upstream timed out",
        })}`,
      ),
    ).toEqual({
      time: 1_700_000_000_123,
      source: "journal",
      origin: "nginx.service",
      level: "error",
      message: "upstream timed out",
    });
    expect(
      read(
        `J\t${JSON.stringify({ SYSLOG_IDENTIFIER: "cron", MESSAGE: [104, 105] })}`,
      ),
    ).toMatchObject({ origin: "cron", message: "hi", level: "info" });
    expect(read("J\tnot json")).toBeNull();
  });

  it("names file lines after the last tail -F header", () => {
    const read = createLineReader(now);
    expect(read("F\tbefore any header")).toBeNull();
    expect(read("F\t==> /var/log/app.log <==")).toBeNull();
    expect(read("F\tWARNING disk almost full")).toMatchObject({
      source: "files",
      origin: "/var/log/app.log",
      level: "warn",
      time: now(),
    });
  });

  it("reads container lines with their timestamp", () => {
    const read = createLineReader(now);
    expect(read("Cweb\t2026-11-20T10:00:00.000000000Z panic: boom")).toEqual({
      time: Date.parse("2026-11-20T10:00:00Z"),
      source: "docker",
      origin: "web",
      level: "error",
      message: "panic: boom",
    });
    expect(read("garbage")).toBeNull();
  });
});
