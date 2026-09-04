#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const profileDir = process.env.PANOPLY_BROWSER_DIR ?? join(homedir(), ".panoply", "browser");
mkdirSync(profileDir, { recursive: true });

// Hook into an already-running browser instead of launching our own. Point it
// at any Chromium-based browser (Chrome/Edge/Brave) started with
// `--remote-debugging-port=<port>`; the agent then drives your live session —
// tabs, logins and cookies included — and closing the client won't kill it.
// `@playwright/mcp` also honors PLAYWRIGHT_MCP_CDP_ENDPOINT directly, since the
// environment is passed through below.
const cdpEndpoint = process.env.PANOPLY_BROWSER_CDP;

const args = ["-y", "@playwright/mcp@latest"];
if (cdpEndpoint) {
  args.push("--cdp-endpoint", cdpEndpoint);
  console.error(`panoply-browser: connecting to existing browser at ${cdpEndpoint}`);
} else {
  args.push("--user-data-dir", profileDir);
}

const child = spawn("npx", args, {
  stdio: ["pipe", "pipe", "inherit"],
  env: process.env,
});

process.stdin.on("data", (chunk) => child.stdin.write(chunk));
child.stdout.on("data", (chunk) => process.stdout.write(chunk));

const shutdown = () => {
  if (!child.killed) child.kill("SIGTERM");
};
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, shutdown);
child.on("exit", (code) => process.exit(code ?? 0));
