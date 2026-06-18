// v1design-agent — stdio MCP ingress for Claude Code / Codex / Cursor.
import "dotenv/config";
import { login, logout, status } from "./auth.ts";
import { startStdio } from "../mcp/stdio.ts";

const cmd = process.argv[2];

if (cmd === "login" || cmd === "auth:login") {
  login().catch((e) => {
    console.error("[v1design-agent] login failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
} else if (cmd === "status" || cmd === "auth:status") {
  status().catch((e) => {
    console.error("[v1design-agent] status failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
} else if (cmd === "logout" || cmd === "auth:logout") {
  logout().catch((e) => {
    console.error("[v1design-agent] logout failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
} else if (["help", "--help", "-h", "connect", "setup", "create", "library", "designs", "pull", "screens", "skill"].includes(cmd || "")) {
  import("./main.mjs").catch((e) => {
    console.error("[v1design-agent] cli failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
} else {
  startStdio().catch((e) => {
    console.error("[v1design-mcp] fatal:", e);
    process.exit(1);
  });
}
