#!/usr/bin/env node
import { spawn, execFile } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, renameSync, readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import * as lab from "./lab.mjs";

const CONFIG_FILE = join(homedir(), ".panoply", "showcase", "config.json");
const SERVER_NAME = "panoply-showcase";
const SERVER_VERSION = "0.1.0";

let notified = false;

function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  const tmp = `${CONFIG_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
  renameSync(tmp, CONFIG_FILE);
}

function exportsDir() {
  const config = readConfig();
  if (config?.exports_dir) {
    const dir = resolve(config.exports_dir.replace(/^~(?=\/|$)/, homedir()));
    if (existsSync(dir)) return { dir, source: "config" };
  }
  const videos = join(homedir(), "Videos", "panoply");
  if (existsSync(join(homedir(), "Videos"))) return { dir: videos, source: "default ~/Videos/panoply" };
  return { dir: resolve("exports"), source: "fallback ./exports" };
}

function ensureExportsDir() {
  const { dir, source } = exportsDir();
  mkdirSync(dir, { recursive: true });
  return { dir, source };
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

let recording = null;

function whichFFmpeg() {
  return new Promise((res) => {
    execFile("which", ["ffmpeg"], (err, stdout) => res(err ? null : stdout.trim()));
  });
}

function whichTool(name) {
  return new Promise((res) => {
    execFile("which", [name], (err) => res(!err));
  });
}

async function waylandRecorder(fps, raw) {
  if (!process.env.WAYLAND_DISPLAY) return null;
  for (const [name, args] of [
    ["wf-recorder", ["-r", String(fps), "-c", "libx264", "-o", raw]],
    ["gpu-screen-recorder", ["-w", "screen", "-f", String(fps), "-c", "mp4", "-o", raw]],
  ]) {
    if (!(await whichTool(name))) continue;
    const child = spawn(name, name === "wf-recorder" ? ["-r", String(fps), "-c", "libx264", "-f", raw] : args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderrTail = "";
    child.stderr.on("data", (c) => { stderrTail = (stderrTail + c).slice(-2000); });
    recording = {
      child,
      rawFile: raw,
      fps,
      startedAt: new Date().toISOString(),
      stderrTail,
      get tail() { return stderrTail; },
    };
    return `Recording started with ${name} at ${fps} fps (Wayland).\nRaw capture: ${raw}\nIt will be saved to the exports folder when you call showcase_stop_recording.`;
  }
  return null;
}

async function startRecording(args = {}) {
  if (recording) return `Already recording since ${recording.startedAt} — call showcase_stop_recording first.`;
  const fps = Number(args.fps) > 0 ? Number(args.fps) : 30;
  return whichFFmpeg().then(async (ffmpegPath) => {
    if (!ffmpegPath) {
      return "ffmpeg not found on PATH. Install it first — e.g. `sudo apt install ffmpeg` (Debian/Ubuntu), `brew install ffmpeg` (macOS), or see https://ffmpeg.org/download.html — then retry showcase_start_recording.";
    }
    const { dir } = ensureExportsDir();
    const raw = join(tmpdir(), `panoply-showcase-${randomUUID()}.mp4`);
    let cmdArgs;
    if (process.platform === "darwin") {
      cmdArgs = ["-f", "avfoundation", "-i", "1", "-framerate", String(fps), "-pix_fmt", "yuv420p", "-y", raw];
    } else if (process.env.DISPLAY) {
      // Works under X11 and XWayland sessions alike; a pure-Wayland session
      // without XWayland will fail at startup and surface the ffmpeg tail.
      cmdArgs = [
        "-f", "x11grab", "-i", process.env.DISPLAY,
        "-framerate", String(fps), "-pix_fmt", "yuv420p", "-y", raw,
      ];
    } else {
      const wl = await waylandRecorder(fps, raw);
      if (wl) return wl;
      return `No display found (DISPLAY is unset${process.env.WAYLAND_DISPLAY ? " and no wf-recorder/gpu-screen-recorder installed for Wayland" : ""}) — cannot start screen capture in this session. For a desktop-independent option that records a containerized browser instead of your screen, call showcase_lab_start.`;
    }
    const child = spawn(ffmpegPath, cmdArgs, { stdio: ["ignore", "ignore", "pipe"] });
    let stderrTail = "";
    child.stderr.on("data", (c) => {
      stderrTail = (stderrTail + c).slice(-2000);
    });
    recording = {
      child,
      rawFile: raw,
      fps,
      startedAt: new Date().toISOString(),
      stderrTail,
      get tail() { return stderrTail; },
    };
    return new Promise((res) => {
      setTimeout(() => {
        if (!recording || recording.child !== child) return;
        if (child.exitCode !== null) {
          recording = null;
          try { unlinkSync(raw); } catch {}
          res(`ffmpeg exited immediately (code ${child.exitCode}). Screen capture may be unavailable in this session (Wayland/X11 permissions).\nffmpeg output tail:\n${stderrTail}`);
        } else {
          res(`Recording started at ${fps} fps.\nRaw capture: ${raw}\nIt will be saved to the exports folder (${dir}) when you call showcase_stop_recording.`);
        }
      }, 1200);
    });
  });
}

function stopRecording() {
  return new Promise((res) => {
    if (!recording) {
      res("Not currently recording. Call showcase_start_recording first.");
      return;
    }
    const rec = recording;
    recording = null;
    const { dir } = ensureExportsDir();
    const out = join(dir, `showcase-${timestamp(rec.startedAt)}.mp4`);
    rec.child.once("exit", () => {
      try {
        if (existsSync(rec.rawFile) && statSync(rec.rawFile).size > 0) {
          try {
            renameSync(rec.rawFile, out);
          } catch {
            copyFileSync(rec.rawFile, out);
            unlinkSync(rec.rawFile);
          }
          res(`Recording saved to ${out} (${statSync(out).size} bytes, ${rec.fps} fps).`);
        } else {
          res(`ffmpeg produced no usable video — nothing saved. ffmpeg output tail:\n${rec.tail}`);
        }
      } catch (e) {
        res(`Failed to move recording into place: ${e.message}\nRaw file may still exist at ${rec.rawFile}.`);
      }
    });
    rec.child.kill("SIGINT");
    setTimeout(() => {
      try { rec.child.kill("SIGKILL"); } catch {}
    }, 3000);
  });
}

function exportVideo(args = {}) {
  const src = args.path ? resolve(args.path.replace(/^~(?=\/|$)/, homedir())) : null;
  if (!src || !existsSync(src)) {
    return args.path
      ? `No such file: ${src}`
      : "Missing required argument: path (the video file to export).";
  }
  const { dir } = ensureExportsDir();
  const dest = join(dir, args.name ? basename(args.name) : `${basename(src, ".mp4")}-${timestamp()}.mp4`);
  copyFileSync(src, dest);
  const moved = args.move === true;
  if (moved) {
    try { unlinkSync(src); } catch {}
  }
  return `Exported ${moved ? "(moved)" : "(copied)"} to ${dest}`;
}

function statusText() {
  const config = readConfig();
  const { dir, source } = exportsDir();
  const lines = [
    `Recording: ${recording ? `in progress (started ${recording.startedAt}, ${recording.fps} fps)` : "idle"}`,
    `Exports folder: ${dir}`,
    `Resolved from: ${source}`,
  ];
  if (config?.exports_dir) lines.push(`Configured exports_dir: ${config.exports_dir} (${CONFIG_FILE})`);
  else lines.push(`No config yet at ${CONFIG_FILE} — using fallbacks. Run showcase_setup with your preferred exports_dir to pin one.`);
  return lines.join("\n");
}

// --- MCP plumbing ------------------------------------------------------------

const TOOLS = [
  {
    name: "showcase_status",
    description: "Show whether a screen recording is in progress and where exported videos are saved.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "showcase_start_recording",
    description: "Start an ffmpeg screen capture of the current display. Requires ffmpeg installed and available on PATH.",
    inputSchema: {
      type: "object",
      properties: {
        fps: { type: "number", description: "Capture frame rate (default 30)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "showcase_stop_recording",
    description: "Stop the active screen capture and save it into the configured exports folder with a timestamped name.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "showcase_export",
    description: "Copy (or move) an existing video file into the exports folder.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path of the video file to export." },
        name: { type: "string", description: "Optional destination filename." },
        move: { type: "boolean", description: "Move instead of copy (default copy)." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "showcase_setup",
    description: "Save the showcase configuration, choosing where recordings are exported.",
    inputSchema: {
      type: "object",
      properties: {
        exports_dir: { type: "string", description: "Absolute (or ~-relative) directory where recorded videos should be saved." },
      },
      required: ["exports_dir"],
      additionalProperties: false,
    },
  },
  {
    name: "showcase_lab_start",
    description: "Start lab mode: a containerized virtual display with chromium (CDP on http://localhost:9222) recorded by ffmpeg. Works regardless of host desktop.",
    inputSchema: {
      type: "object",
      properties: {
        fps: { type: "number", description: "Recording frame rate (default 30)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "showcase_lab_stop",
    description: "Stop lab mode: finalize the mp4 recording, stop and remove the container. Returns the absolute saved video path.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "showcase_lab_status",
    description: "Show lab mode state: container runtime, whether the lab container runs, its CDP endpoint and output file.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function setupTool(args = {}) {
  if (!args.exports_dir) return "Missing required argument: exports_dir.";
  const abs = resolve(args.exports_dir.replace(/^~(?=\/|$)/, homedir()));
  mkdirSync(abs, { recursive: true });
  saveConfig({ exports_dir: abs, saved_at: new Date().toISOString() });
  return `Saved. Showcase recordings will be exported to ${abs} (config written to ${CONFIG_FILE}).`;
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function notifySetupNeeded() {
  if (notified || readConfig()) return;
  notified = true;
  send({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: {
      level: "info",
      data: `[${SERVER_NAME}] No config found at ${CONFIG_FILE}. Please ask the user where showcase recordings should be saved, then call the showcase_setup tool with { exports_dir } to store it. Until then exports fall back to ~/Videos/panoply or ./exports.`,
    },
  });
}

function handleRequest(id, method, params) {
  if (method === "initialize") {
    notifySetupNeeded();
    return {
      protocolVersion: params.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {}, logging: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    };
  }
  if (method === "notifications/initialized") return undefined;
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: TOOLS };
  if (method === "tools/call") {
    const name = params.name ?? "";
    const args = params.arguments ?? {};
    const wrap = (text, isError = false) => ({
      content: [{ type: "text", text }],
      isError,
    });
    switch (name) {
      case "showcase_status":
        return wrap(statusText());
      case "showcase_start_recording":
        return startRecording(args).then(wrap);
      case "showcase_stop_recording":
        return stopRecording().then(wrap);
      case "showcase_export":
        return wrap(exportVideo(args));
      case "showcase_setup":
        return wrap(setupTool(args));
      case "showcase_lab_start":
        return lab.start({ exportsDir: ensureExportsDir().dir, fps: args.fps }).then(wrap).catch((e) => wrap(e.message, true));
      case "showcase_lab_stop":
        return lab.stop().then(wrap).catch((e) => wrap(e.message, true));
      case "showcase_lab_status":
        return lab.status().then(wrap).catch((e) => wrap(e.message, true));
      default:
        return wrap(`Unknown tool: ${name}`, true);
    }
  }
  return Promise.reject(new Error(`Method not found: ${method}`));
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let chain = Promise.resolve();
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
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

process.on("SIGTERM", () => {
  if (recording) stopRecording().finally(() => process.exit(0));
  else process.exit(0);
});
