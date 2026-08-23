import { spawn, execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const IMAGE_NAME = "panoply-showcase-lab";
const LAB_DIR = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(homedir(), ".panoply", "showcase", "lab.json");
const CDP_PORT = Number(process.env.PANOPLY_SHOWCASE_CDP_PORT) || 9222;

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  renameSync(tmp, STATE_FILE);
}

function clearState() {
  try { unlinkSync(STATE_FILE); } catch {}
}

function run(cmd, args) {
  return new Promise((res) => {
    execFile(cmd, args, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      res({ ok: !err, code: err?.code ?? 0, stdout, stderr });
    });
  });
}

async function detectRuntime() {
  const docker = await run("which", ["docker"]);
  if (docker.ok && docker.stdout.trim()) return { runtime: "docker", path: docker.stdout.trim() };
  const podman = await run("which", ["podman"]);
  if (podman.ok && podman.stdout.trim()) return { runtime: "podman", path: podman.stdout.trim() };
  return null;
}

async function ensureImage(runtime) {
  const probe = await run(runtime, ["image", "inspect", IMAGE_NAME]);
  if (probe.ok) return;
  const build = await run(runtime, ["build", "-t", IMAGE_NAME, LAB_DIR]);
  if (!build.ok) {
    throw new Error(`Failed to build lab image ${IMAGE_NAME}.\nBuild output tail:\n${(build.stderr || build.stdout).slice(-2000)}`);
  }
}

async function containerRunning(runtime, id) {
  const r = await run(runtime, ["inspect", "-f", "{{.State.Running}}", id]);
  return r.ok && r.stdout.trim() === "true";
}

export async function start({ exportsDir, fps }) {
  const existing = readState();
  if (existing?.container_id) {
    const found = await detectRuntime();
    if (found && (await containerRunning(found.path, existing.container_id))) {
      return `Lab is already running (container ${existing.container_id.slice(0, 12)}, started ${existing.started_at}). CDP endpoint: http://localhost:${CDP_PORT}. Recording to ${existing.output_file}.`;
    }
  }
  const detected = await detectRuntime();
  if (!detected) {
    throw new Error(
      "No container runtime found. Lab mode needs Docker or Podman — install one first, e.g. `sudo apt install podman` (Debian/Ubuntu) or see https://podman.io / https://docs.docker.com/get-docker/ — then retry showcase_lab_start."
    );
  }
  const rt = detected.path;
  await ensureImage(rt);
  mkdirSync(exportsDir, { recursive: true });
  const fpsNum = Number(fps) > 0 ? Number(fps) : 30;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
  const outName = `${stamp}-lab.mp4`;
  const result = await run(rt, [
    "run", "--detach",
    "--name", `panoply-showcase-lab-${stamp}`,
    "--network", "host",
    "-v", `${exportsDir}:/exports:Z`,
    "-e", `FPS=${fpsNum}`,
    "-e", `LAB_OUTPUT=${outName.replace(/\.mp4$/, "")}`,
    "-e", `CDP_PORT=${CDP_PORT}`,
    IMAGE_NAME,
  ]);
  if (!result.ok) {
    throw new Error(`Failed to start lab container.\nRuntime output tail:\n${(result.stderr || result.stdout).slice(-2000)}`);
  }
  const containerId = result.stdout.trim();
  const outputFile = join(exportsDir, outName);
  saveState({ runtime: detected.runtime, runtime_path: rt, container_id: containerId, output_file: outputFile, fps: fpsNum, started_at: new Date().toISOString() });
  return [
    `Lab recording started at ${fpsNum} fps in a ${detected.runtime} container (${containerId.slice(0, 12)}).`,
    `CDP endpoint: http://localhost:${CDP_PORT}`,
    `Video will be saved to ${outputFile} when you call showcase_lab_stop.`,
  ].join("\n");
}

export async function stop() {
  const state = readState();
  if (!state?.container_id) {
    throw new Error("No lab session on record — call showcase_lab_start first.");
  }
  const rt = state.runtime_path || state.runtime;
  if (!(await containerRunning(rt, state.container_id))) {
    await run(rt, ["rm", "-f", state.container_id]).catch(() => {});
    clearState();
    throw new Error(`Lab container ${state.container_id.slice(0, 12)} is not running anymore (it may have been stopped externally).${existsSync(state.output_file) ? ` Its video may exist at ${state.output_file}.` : ""}`);
  }
  await run(rt, ["exec", state.container_id, "sh", "-c", "pkill -INT -f x11grab"]);
  await new Promise((res) => setTimeout(res, 1500));
  await run(rt, ["stop", "-t", 5, state.container_id]);
  await run(rt, ["rm", state.container_id]);
  const file = state.output_file;
  clearState();
  let sizeNote = "";
  try {
    sizeNote = ` (${statSync(file).size} bytes)`;
  } catch {}
  return `Lab recording saved to ${file}${sizeNote}.`;
}

export async function status() {
  const state = readState();
  const lines = [];
  const detected = await detectRuntime();
  lines.push(`Container runtime: ${detected ? `${detected.runtime} (${detected.path})` : "not found"}`);
  if (!state?.container_id) {
    lines.push("Lab: idle (no session on record).");
    return lines.join("\n");
  }
  const running = detected && (await containerRunning(detected.path || state.runtime_path, state.container_id));
  lines.push(`Lab: ${running ? "running" : "stale"} (container ${state.container_id.slice(0, 12)}, started ${state.started_at}, ${state.fps} fps)`);
  if (running) lines.push(`CDP endpoint: http://localhost:${CDP_PORT}`);
  lines.push(`Output file: ${state.output_file}`);
  return lines.join("\n");
}
