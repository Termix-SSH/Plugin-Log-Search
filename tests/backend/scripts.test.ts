import { describe, expect, it } from "vitest";
import { logRoots } from "../../src/backend/host-settings";
import { parseSearch } from "../../src/backend/query";
import {
  dockerScript,
  filesScript,
  journalSearchScript,
  minutesBack,
} from "../../src/backend/scripts";

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const req = (over: Record<string, unknown> = {}) =>
  parseSearch({ from: NOW - 2 * 3_600_000, to: NOW, ...over }, NOW);

describe("minutesBack", () => {
  it("rounds up", () => {
    expect(minutesBack(req(), NOW)).toBe(120);
  });
});

describe("journalSearchScript", () => {
  it("uses a relative since and the level as a priority", () => {
    const script = journalSearchScript(req({ level: "error" }), NOW);
    expect(script).toContain("--since '-120min'");
    expect(script).toContain("-p 3");
    expect(script).not.toContain("--until");
  });

  it("sets until for a window that ended earlier", () => {
    const script = journalSearchScript(
      req({ from: NOW - 3 * 3_600_000, to: NOW - 3_600_000 }),
      NOW,
    );
    expect(script).toContain("--until '-60min'");
  });
});

describe("journal text filter", () => {
  it("asks journalctl to grep plain words", () => {
    expect(journalSearchScript(req({ query: "timed out" }), NOW)).toContain(
      "-g 'timed out'",
    );
  });

  it("filters on our side when the text has regex characters", () => {
    expect(journalSearchScript(req({ query: "a.b(" }), NOW)).not.toContain(
      " -g ",
    );
    expect(
      journalSearchScript(req({ query: "a|b", regex: true }), NOW),
    ).not.toContain(" -g ");
  });
});

describe("filesScript", () => {
  it("quotes the roots and filters in the shell for plain text", () => {
    const script = filesScript(
      req({ query: "it's bad" }),
      ["/var/log", "/opt/my logs"],
      NOW,
    );
    expect(script).toContain("'/opt/my logs'");
    expect(script).toContain("grep -a -i -F -e 'it'\\''s bad'");
    expect(script).toContain("-mmin -120");
  });

  it("leaves a regex to our side", () => {
    const script = filesScript(
      req({ query: "a|b", regex: true }),
      ["/var/log"],
      NOW,
    );
    expect(script).not.toContain("grep -a");
  });

  it("checks the real path stays inside the roots", () => {
    const script = filesScript(req(), ["/var/log"], NOW);
    expect(script).toContain("readlink -f");
    expect(script).toContain('case "$R" in "$D"/*) OK=1');
  });

  it("adds a name filter", () => {
    const script = filesScript(req({ origin: "nginx" }), ["/var/log"], NOW);
    expect(script).toContain("grep -q -i -F -e 'nginx'");
  });
});

describe("dockerScript", () => {
  it("passes the window and the text", () => {
    const script = dockerScript(req({ query: "boom" }), NOW);
    expect(script).toContain("--since 120m");
    expect(script).toContain("grep -a -i -F -e 'boom'");
    expect(script).toContain("@@NODOCKER");
  });

  it("matches case when asked", () => {
    const script = dockerScript(
      req({ query: "Boom", caseSensitive: true }),
      NOW,
    );
    expect(script).toContain("grep -a -F -e 'Boom'");
  });
});

describe("logRoots", () => {
  it("defaults to /var/log", () => {
    expect(logRoots("")).toEqual(["/var/log"]);
    expect(logRoots(undefined)).toEqual(["/var/log"]);
  });

  it("splits, trims and drops unsafe paths", () => {
    expect(
      logRoots("/var/log/, /opt/app\n../etc, relative, /srv/x/../y"),
    ).toEqual(["/var/log", "/opt/app"]);
  });
});
