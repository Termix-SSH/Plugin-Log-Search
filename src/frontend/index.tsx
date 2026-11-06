import { ScrollText } from "lucide-react";
import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import { initApi } from "./api";
import { LogsTab } from "./LogsTab";

const TAB_ID = "log-search";

export function activate(app: TermixApp): void {
  initApi(app.api);

  app.registerRailItem({
    id: TAB_ID,
    icon: ScrollText,
    titleKey: "tab.title",
    kind: "tab",
    permission: "use",
    promotable: true,
  });
  app.registerTab(TAB_ID, LogsTab, {
    icon: ScrollText,
    titleKey: "tab.title",
    singleton: true,
    hostless: true,
  });
  app.registerPaletteEntry({
    id: "open",
    titleKey: "tab.title",
    icon: ScrollText,
    keywords: ["logs", "search", "journal", "grep", "docker"],
    scope: "global",
    run: (shell) => shell.openSingletonTab(TAB_ID),
  });
}
