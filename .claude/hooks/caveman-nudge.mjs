#!/usr/bin/env node
// Nudges Claude to apply the `caveman` skill (see skills/caveman/SKILL.md) on
// subagent-boundary traffic by default, without asking the user and without a
// non-technical person ever seeing anything different. No new process stays
// running — this runs once per hook event and exits.
//
// Scope: PANOPLY_CAVEMAN_SCOPE env var wins over .claude/settings.json's
// "caveman.scope" field. Default is "subagent" (Task tool boundaries only);
// "everywhere" also fires on UserPromptSubmit.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function scope() {
  const env = process.env.PANOPLY_CAVEMAN_SCOPE;
  if (env === "everywhere" || env === "subagent") return env;
  try {
    const path = join(root, ".claude", "settings.json");
    if (existsSync(path)) {
      const cfg = JSON.parse(readFileSync(path, "utf8"));
      if (cfg.caveman?.scope === "everywhere") return "everywhere";
    }
  } catch {
    // malformed settings.json shouldn't break the hook — fall through to default
  }
  return "subagent";
}

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

const event = readStdin();
const currentScope = scope();

const NUDGE =
  "Apply the `caveman` skill's compression rules to this output " +
  "(see skills/caveman/SKILL.md) and end it with the required " +
  "`[caveman: ~N% token reduction est.]` self-check line.";

// UserPromptSubmit only matters when scope is "everywhere" — leave the final
// user-facing turn alone otherwise. PreToolUse/PostToolUse on Task fires
// regardless of scope, since that's always "internal" traffic.
const isSubagentBoundary = event.tool_name === "Task";
const shouldNudge = isSubagentBoundary || currentScope === "everywhere";

if (shouldNudge) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: event.hook_event_name ?? "PreToolUse",
        additionalContext: NUDGE,
      },
    }) + "\n",
  );
}
process.exit(0);
