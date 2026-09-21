#!/usr/bin/env node
// panoply-opencode-bridge — run your local `opencode` CLI as MCP tools.
// Lets any MCP host delegate prompts to your opencode login (agents, local
// context, session cost tracking) without extracting tokens.
//
// Zero dependencies. Stdio JSON-RPC 2.0 (mirrors servers/gh-cli).
// Ported from the standalone opencode-bridge-mcp TypeScript server; the
// long-lived Anthropic-proxy launcher (proxy.ts) is intentionally not here.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const SERVER_NAME = "panoply-opencode-bridge";
const SERVER_VERSION = pkg.version;

const DEFAULT_MODEL = process.env.OPENCODE_DEFAULT_MODEL ?? "opencode/muse-spark-1.3-contributor-free";
const DEFAULT_VARIANT = process.env.OPENCODE_DEFAULT_VARIANT ?? "xhigh";

// Free Zen models at time of writing — keep in sync with https://opencode.ai/docs/zen/
const FREE_ZEN_MODELS = [
  "opencode/big-pickle",
  "opencode/mimo-v2.5-free",
  "opencode/ling-3.0-flash-fin-free",
  "opencode/nemotron-3-ultra-free",
  "opencode/nemotron-3.5-lightning-free",
  "opencode/muse-spark-1.2-contributor-free",
  "opencode/muse-spark-1.3-contributor-free",
];

// --- opencode binary resolution (Windows shim-safe, shell-free) --------------

const WINDOWS_SHIM_EXTENSIONS = new Set([".cmd", ".ps1"]);

function executableName(raw) {
  const base = path.basename(raw);
  const extension = path.extname(base).toLowerCase();
  return WINDOWS_SHIM_EXTENSIONS.has(extension) ? base.slice(0, -extension.length) : path.parse(base).name;
}

function shimTarget(shimPath) {
  const name = executableName(shimPath);
  const shimDir = path.dirname(shimPath);
  const candidates = [
    path.join(shimDir, "node_modules", "opencode-ai", "bin", `${name}.exe`),
    path.join(shimDir, "node_modules", name, "bin", `${name}.exe`),
  ];
  return candidates.find((c) => existsSync(c));
}

function resolveOpencodeBin(configured = process.env.OPENCODE_BIN, platform = process.platform, pathValue = process.env.PATH) {
  const raw = (configured ?? "").trim() || "opencode";
  if (platform !== "win32") return raw;
  const hasPath = path.isAbsolute(raw) || raw.includes("/") || raw.includes("\\");
  const extension = path.extname(raw).toLowerCase();
  if (hasPath) {
    if (WINDOWS_SHIM_EXTENSIONS.has(extension)) {
      const target = shimTarget(raw);
      if (target) return target;
      throw new Error(`OPENCODE_BIN points to a Windows ${extension} shim without a matching opencode.exe: ${raw}`);
    }
    if (existsSync(raw)) return raw;
    if (existsSync(`${raw}.exe`)) return `${raw}.exe`;
    return raw;
  }
  const name = executableName(raw);
  for (const dir of String(pathValue ?? "").split(path.delimiter).map((e) => e.trim()).filter(Boolean)) {
    const direct = path.join(dir, `${name}.exe`);
    if (existsSync(direct)) return direct;
    const packageTarget = path.join(dir, "node_modules", "opencode-ai", "bin", `${name}.exe`);
    if (existsSync(packageTarget)) return packageTarget;
    const shim = path.join(dir, `${name}.cmd`);
    if (existsSync(shim)) {
      const target = shimTarget(shim);
      if (target) return target;
    }
  }
  return raw;
}

// --- process tree cleanup ----------------------------------------------------

function killUnixTree(child) {
  if (child.pid == null) return;
  try {
    process.kill(-child.pid, "SIGKILL");
    return;
  } catch { /* not a process group — fall through */ }
  try { child.kill("SIGKILL"); } catch { /* already exited */ }
}

function killProcessTree(child, platform = process.platform) {
  if (child.pid == null) return Promise.resolve();
  if (platform !== "win32") {
    killUnixTree(child);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill("SIGKILL"); } catch { /* already exited */ }
      }
      resolve();
    };
    let killer;
    try {
      killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      finish();
      return;
    }
    killer.once("error", finish);
    killer.once("close", finish);
    setTimeout(finish, 2000).unref();
  });
}

// --- `opencode run --format json` parsing ------------------------------------
// Only human-readable text parts ever reach the caller. Tool inputs, raw event
// JSON, and token metadata never leak: no-text runs return a short summary.

const MAX_REPLY_CHARS = 100_000;
const MAX_TOOL_OUTPUTS = 3;
const MAX_TOOL_OUTPUT_CHARS = 2000;

function collectDeep(out, v, depth) {
  if (depth > 3 || v == null) return;
  if (typeof v === "string") {
    if (v) out.push(v);
    return;
  }
  if (Array.isArray(v)) {
    for (const item of v) collectDeep(out, item, depth + 1);
    return;
  }
  if (typeof v === "object") {
    const o = v;
    if (o.type === "tool_use") return;
    if (typeof o.text === "string" && o.type !== "tool_result") {
      if (o.text) out.push(o.text);
      return;
    }
    collectDeep(out, o.content, depth + 1);
    collectDeep(out, o.delta, depth + 1);
    collectDeep(out, o.message, depth + 1);
  }
}

function createCollector() {
  return {
    texts: [],
    sessionId: undefined,
    steps: 0,
    toolCalls: 0,
    lastError: "",
    toolOutputs: [],
    hadOutput: false,
    kinds: {},
    feedLine(line) {
      const t = String(line).trim();
      if (!t.startsWith("{")) return "";
      let ev;
      try { ev = JSON.parse(t); } catch { return ""; }
      this.hadOutput = true;
      if (typeof ev.sessionID === "string" && this.sessionId === undefined) this.sessionId = ev.sessionID;
      const kind = typeof ev.type === "string" ? ev.type : "";
      this.kinds[kind || "?"] = (this.kinds[kind || "?"] ?? 0) + 1;
      const partType = ev.part != null && typeof ev.part === "object" ? ev.part.type : undefined;
      if (kind === "step_finish") this.steps += 1;
      if (kind === "tool_use" || partType === "tool_use") {
        this.toolCalls += 1;
        const part = ev.part != null && typeof ev.part === "object" ? ev.part : undefined;
        const state = part?.state;
        const output = state != null && typeof state === "object" ? state.output : undefined;
        const status = state != null && typeof state === "object" ? state.status : undefined;
        if ((status === "completed" || status === "error") && typeof output === "string" && output.trim()) {
          const toolName = typeof part?.tool === "string" && part.tool ? part.tool : "tool";
          this.toolOutputs.push({ tool: toolName, output: output.trim().slice(0, MAX_TOOL_OUTPUT_CHARS) });
          while (this.toolOutputs.length > MAX_TOOL_OUTPUTS) this.toolOutputs.shift();
        }
      }
      if (kind === "error") {
        const candidates = [ev.message, ev.error?.message, ev.text];
        for (const c of candidates) {
          if (typeof c === "string" && c.trim()) { this.lastError = c.trim().slice(0, 300); break; }
        }
        return "";
      }
      if (kind === "text" || kind === "message" || kind === "assistant") {
        if (typeof ev.text === "string" && ev.text) {
          this.texts.push(ev.text);
          return ev.text;
        }
        const before = this.texts.length;
        collectDeep(this.texts, ev.part ?? ev.content ?? ev.message, 0);
        return this.texts.slice(before).join("");
      }
      return "";
    },
    finalize(prompt) {
      let text = this.texts.join("").trim();
      if (!text) {
        if (!this.hadOutput) {
          text = "(empty response)";
        } else if (this.toolOutputs.length > 0) {
          text = `The run finished ${this.toolCalls} tool call(s) with no summary text. Latest tool output(s):\n\n` +
            this.toolOutputs.map((t) => `[${t.tool}]\n${t.output}`).join("\n\n");
        } else {
          const histogram = Object.entries(this.kinds).map(([k, n]) => `${k}=${n}`).join(",");
          console.error(`[opencode-bridge] run produced no text; event kinds: ${histogram}`);
          text = `The model run produced no text reply (${this.steps} step(s), ${this.toolCalls} tool call(s)).` +
            (this.lastError ? ` Last error: ${this.lastError}` : "") +
            " Ask again or request a written summary of what was done.";
        }
      }
      if (text.length > MAX_REPLY_CHARS) text = text.slice(0, MAX_REPLY_CHARS);
      return { text, sessionId: this.sessionId };
    },
  };
}

function formatTimeoutError(timeoutSecs, m) {
  return `opencode run timed out after ${timeoutSecs}s ` +
    `(session=${m.sessionId ?? "unknown"}, events=${m.events}, steps=${m.steps}, ` +
    `tool_calls=${m.toolCalls}, stdout_chars=${m.stdoutChars}, stderr_chars=${m.stderrChars})`;
}

function formatRunFailure(code, m, reason) {
  return `opencode failed: ${reason} (exit_code=${code ?? "unknown"}, ` +
    `session=${m.sessionId ?? "unknown"}, events=${m.events}, ` +
    `steps=${m.steps}, tool_calls=${m.toolCalls}, ` +
    `stdout_chars=${m.stdoutChars}, stderr_chars=${m.stderrChars})`;
}

const STALE_REASONING_FAILURE = /reasoning\s+[`'"]?encrypted_content[`'"]?\s+was\s+not\s+issued\s+to\s+this\s+caller/i;
const TRANSIENT_RETRY_ATTEMPTS = 2;

function isRetryableProviderError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out after/i.test(message)) return false;
  if (/401|403|unauthorized|invalid.{0,10}key|authenticat|model (not found|unknown)|not entitled/i.test(message)) return false;
  return /rate_limit_exceeded|rate limit|\b429\b|\b50[0234]\b|temporarily unavailable|overloaded|over capacity|capacity exceeded|server error|service unavailable|too many requests|try again later|socket hang up|ECONNRESET/i.test(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runBin(args, opts) {
  const bin = opts.bin ?? resolveOpencodeBin();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TERM: process.env.TERM ?? "dumb" },
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let stdoutChars = 0;
    let stderrChars = 0;
    let lineBuffer = "";
    let timedOut = false;
    let settled = false;
    let drainTimer;
    const collector = createCollector();
    const metadata = () => ({
      sessionId: collector.sessionId,
      events: Object.values(collector.kinds).reduce((s, n) => s + n, 0),
      steps: collector.steps,
      toolCalls: collector.toolCalls,
      stdoutChars,
      stderrChars,
    });
    const feed = (chunk) => {
      lineBuffer += chunk;
      let index;
      while ((index = lineBuffer.indexOf("\n")) >= 0) {
        collector.feedLine(lineBuffer.slice(0, index));
        lineBuffer = lineBuffer.slice(index + 1);
      }
    };
    const settle = (error, code) => {
      if (settled) return;
      settled = true;
      if (drainTimer) clearTimeout(drainTimer);
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      if ((code ?? null) !== 0) {
        reject(new Error(formatRunFailure(code, metadata(), "child process exited unsuccessfully")));
        return;
      }
      if (lineBuffer.trim()) collector.feedLine(lineBuffer);
      resolve({ stdout, stderr });
    };
    const timer = setTimeout(() => {
      if (settled || timedOut) return;
      timedOut = true;
      void killProcessTree(child).finally(() => {
        settle(new Error(formatTimeoutError(Math.ceil(opts.timeoutMs / 1000), metadata())));
      });
    }, opts.timeoutMs);
    child.stdout?.on("data", (d) => {
      const chunk = String(d);
      stdoutChars += chunk.length;
      stdout += chunk;
      feed(chunk);
      if (stdout.length > 16 * 1024 * 1024) void killProcessTree(child);
    });
    child.stderr?.on("data", (d) => {
      const chunk = String(d);
      stderrChars += chunk.length;
      stderr = (stderr + chunk).slice(-65536);
    });
    child.on("error", (e) => {
      if (settled || timedOut) return;
      settle(e);
    });
    child.once("exit", (code) => {
      if (settled || timedOut) return;
      clearTimeout(timer);
      drainTimer = setTimeout(() => settle(undefined, code ?? null), 250);
      if (typeof drainTimer.unref === "function") drainTimer.unref();
    });
    child.once("close", (code) => {
      if (settled || timedOut) return;
      settle(undefined, code);
    });
  });
}

async function runBinWithStaleReasoningRecovery(args, opts) {
  try {
    return await runBin(args, opts);
  } catch (error) {
    if (!(error instanceof Error && STALE_REASONING_FAILURE.test(error.message))) throw error;
    console.error("[opencode-bridge] retrying after stale encrypted reasoning failure");
    return await runBin(args, opts);
  }
}

async function runAskOpencode(args, opts) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await runBinWithStaleReasoningRecovery(args, opts);
    } catch (error) {
      if (!isRetryableProviderError(error) || attempt >= TRANSIENT_RETRY_ATTEMPTS) throw error;
      const delayMs = 2000 * 2 ** attempt + Math.floor(Math.random() * 500);
      console.error(`[opencode-bridge] transient provider failure; retrying ${attempt + 1}/${TRANSIENT_RETRY_ATTEMPTS} in ${delayMs}ms: ${error.message.slice(0, 200)}`);
      await wait(delayMs);
    }
  }
}

function resolveDir(input) {
  const fallback = process.cwd();
  if (!input) return fallback;
  try {
    if (existsSync(input) && statSync(input).isDirectory()) return input;
  } catch { /* fall through */ }
  return fallback;
}

// --- tool handlers ----------------------------------------------------------

const HANDLERS = {
  ask_opencode: async (p) => {
    if (!p.prompt || !String(p.prompt).trim()) throw new Error("prompt is required for ask_opencode");
    const useModel = (p.model ?? "").trim() || DEFAULT_MODEL;
    const useVariant = (p.variant ?? "").trim() || DEFAULT_VARIANT || undefined;
    const cwd = resolveDir(p.directory);
    const timeoutSecs = p.timeoutSecs ?? 180;
    if (!Number.isInteger(timeoutSecs) || timeoutSecs < 10 || timeoutSecs > 600) {
      throw new Error("timeoutSecs must be an integer between 10 and 600");
    }
    const args = ["run", String(p.prompt), "-m", useModel, "--format", "json", "--dir", cwd];
    if (p.agent) args.push("--agent", String(p.agent));
    if (useVariant) args.push("--variant", useVariant);
    if (process.env.OPENCODE_AUTO !== "0") args.push("--auto");

    let out;
    try {
      out = await runAskOpencode(args, { timeoutMs: timeoutSecs * 1000, cwd });
    } catch (e) {
      // Timeout/failure metadata only — never prompt/output content.
      throw new Error(`opencode run failed: ${e.message}`);
    }
    const collector = createCollector();
    for (const line of out.stdout.split("\n")) collector.feedLine(line);
    const parsed = collector.finalize(String(p.prompt));
    const text = parsed.text.trim() || out.stdout.trim().slice(0, 12000) || "(empty response)";
    const meta = [`model=${useModel}`, useVariant ? `variant=${useVariant}` : null, `dir=${cwd}`, parsed.sessionId ? `session=${parsed.sessionId}` : null]
      .filter(Boolean)
      .join(" ");
    return `${text}\n\n[${meta}]`;
  },

  list_opencode_models: async (p) => {
    if (p.freeOnly) {
      const list = p.contains ? FREE_ZEN_MODELS.filter((m) => m.includes(p.contains)) : FREE_ZEN_MODELS;
      return list.join("\n");
    }
    try {
      const { stdout } = await runBin(["models"], { timeoutMs: 30000 });
      let lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
      if (p.contains) lines = lines.filter((l) => l.includes(p.contains));
      return lines.slice(0, 300).join("\n") || "(no models)";
    } catch (e) {
      throw new Error(`Could not list models: ${e.message}`);
    }
  },

  zen_chat: async (p) => {
    if (!p.message || !String(p.message).trim()) throw new Error("message is required for zen_chat");
    const key = process.env.OPENCODE_ZEN_API_KEY;
    if (!key) {
      throw new Error("OPENCODE_ZEN_API_KEY is not set. Get one at https://opencode.ai/auth and restart the MCP server with it in env.");
    }
    const useModel = (String(p.model ?? "").trim() || "big-pickle").replace(/^opencode\//, "");
    const messages = [];
    if (p.system) messages.push({ role: "system", content: String(p.system) });
    messages.push({ role: "user", content: String(p.message) });
    let res;
    try {
      res = await fetch("https://opencode.ai/zen/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: useModel, messages }),
      });
    } catch (e) {
      throw new Error(`Zen request failed: ${e.message}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zen error ${res.status}: ${body.slice(0, 2000)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || "(empty)";
  },
};

const TOOL_SCHEMAS = {
  ask_opencode: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Prompt to send to opencode" },
      model: { type: "string", description: "Model as provider/model. Defaults to env or opencode/muse-spark-1.3-contributor-free." },
      directory: { type: "string", description: "Working directory for opencode. Defaults to MCP server cwd." },
      agent: { type: "string", description: "opencode agent to use (e.g. build, plan). Omit for default." },
      variant: { type: "string", description: "Model variant / reasoning effort if supported by provider." },
      timeoutSecs: { type: "integer", minimum: 10, maximum: 600, description: "Timeout seconds, default 180. Use 600 for implementation tasks." },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  list_opencode_models: {
    type: "object",
    properties: {
      freeOnly: { type: "boolean", description: "If true, only return known-free Zen models." },
      contains: { type: "string", description: "Substring filter, e.g. 'opencode/' or 'anthropic'." },
    },
    additionalProperties: false,
  },
  zen_chat: {
    type: "object",
    properties: {
      message: { type: "string", description: "User message" },
      model: { type: "string", description: "Zen model id, e.g. big-pickle. Defaults to big-pickle." },
      system: { type: "string", description: "Optional system prompt" },
    },
    required: ["message"],
    additionalProperties: false,
  },
};

const TOOL_DOCS = {
  ask_opencode: "Run one prompt through your local opencode CLI (uses YOUR opencode login). Stateless: each call is a fresh `opencode run`. For implementation tasks set timeoutSecs: 600 and split implement vs. test into separate calls.",
  list_opencode_models: "Run `opencode models` and return model IDs. Set freeOnly to show known-free Zen models.",
  zen_chat: "Call the official OpenCode Zen endpoint directly. Needs OPENCODE_ZEN_API_KEY from https://opencode.ai/auth. Use when you want Zen without spawning the CLI.",
};

const TOOLS = Object.keys(HANDLERS).map((name) => ({
  name,
  description: TOOL_DOCS[name],
  inputSchema: TOOL_SCHEMAS[name],
}));

// --- MCP plumbing (mirrors servers/gh-cli) -----------------------------------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function handleRequest(id, method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    };
  }
  if (method === "notifications/initialized") return undefined;
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: TOOLS };
  if (method === "tools/call") {
    const name = params?.name ?? "";
    const args = params?.arguments ?? {};
    const wrap = (text, isError = false) => ({ content: [{ type: "text", text }], isError });
    const handler = HANDLERS[name];
    if (!handler) return wrap(`Unknown tool: ${name}`, true);
    return handler(args)
      .then((out) => wrap(out))
      .catch((e) => wrap(typeof e === "string" ? e : (e?.message ?? JSON.stringify(e)), true));
  }
  return Promise.reject(new Error(`Method not found: ${method}`));
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let chain = Promise.resolve();
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); }
  catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  chain = chain
    .then(() => handleRequest(msg.id, msg.method, msg.params))
    .then((result) => {
      if (msg.id !== undefined && result !== undefined) {
        send({ jsonrpc: "2.0", id: msg.id, result });
      }
    })
    .catch((e) => {
      if (msg.id !== undefined) {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: e.message?.startsWith("Method not found") ? -32601 : -32603, message: e.message },
        });
      }
    });
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
