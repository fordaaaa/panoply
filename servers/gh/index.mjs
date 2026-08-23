#!/usr/bin/env node
const ENDPOINT = process.env.PANOPLY_GH_ENDPOINT ?? "https://api.githubcopilot.com/mcp/";
const token = process.env.GITHUB_MCP_TOKEN;
if (!token) {
  console.error("panoply-gh: GITHUB_MCP_TOKEN is not set");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  "X-MCP-Toolsets": process.env.PANOPLY_GH_TOOLSETS ?? "issues,pull_requests,repos",
};

async function forward(message) {
  const res = await fetch(ENDPOINT, { method: "POST", headers, body: message });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (type.includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      const m = line.match(/^data:\s*(.*)$/);
      if (m && m[1] && m[1] !== "[DONE]") process.stdout.write(m[1].trim() + "\n");
    }
  } else if (text.trim()) {
    process.stdout.write(text.trim() + "\n");
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    forward(line).catch((e) => {
      const id = (() => { try { return JSON.parse(line).id; } catch { return null; } })();
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } }) + "\n");
    });
  }
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
