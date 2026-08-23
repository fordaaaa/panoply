#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const profileDir = process.env.PANOPLY_BROWSER_DIR ?? join(homedir(), ".panoply", "browser");
mkdirSync(profileDir, { recursive: true });

const child = spawn("npx", ["-y", "@playwright/mcp@latest", "--user-data-dir", profileDir], {
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
