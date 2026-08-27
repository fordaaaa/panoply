#!/usr/bin/env node
// Zero-dep hand-rolled JSON-RPC 2.0 stdio server (pattern: servers/showcase/index.mjs).
// Tracks the bytes of JSON-RPC traffic this process itself has seen since launch
// as an approximate usage signal for the caveman-compression hook to check. This
// is NOT the host agent's real context-window accounting — a stdio subprocess
// has no API into that — it's a rough, honestly-labeled proxy.

const SERVER_NAME = "panoply-caveman";
const SERVER_VERSION = "0.1.0";

let bytesSeen = 0;
let messagesSeen = 0;
const startedAt = Date.now();

const TOOLS = [
  {
    name: "usage_snapshot",
    description:
      "Approximate usage signal for this session (bytes/messages seen by this server since launch, not the host's real context accounting). Use it to decide whether caveman-style compression is warranted.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function usageSnapshot() {
  return {
    approx_bytes_seen: bytesSeen,
    approx_messages_seen: messagesSeen,
    uptime_s: Math.round((Date.now() - startedAt) / 1000),
    note: "Estimate only — this server cannot see the host's real context window. Rising bytes/messages across a session is the signal to act on, not the absolute numbers.",
  };
}

function handleRequest(id, method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      capabilities: { tools: {} },
    };
  }
  if (method === "tools/list") {
    return { tools: TOOLS };
  }
  if (method === "tools/call") {
    if (params?.name === "usage_snapshot") {
      return { content: [{ type: "text", text: JSON.stringify(usageSnapshot(), null, 2) }] };
    }
    throw new Error(`unknown tool: ${params?.name}`);
  }
  if (method === "notifications/initialized") {
    return null; // no response expected for notifications
  }
  throw new Error(`unknown method: ${method}`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  bytesSeen += Buffer.byteLength(chunk);
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    messagesSeen++;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // never write non-JSON-RPC to stdout — log to stderr instead
    }
    try {
      const result = handleRequest(msg.id, msg.method, msg.params);
      if (result === null || msg.id === undefined) continue;
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
    } catch (e) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32603, message: e.message } }) + "\n");
    }
  }
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
