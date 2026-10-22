// Harness orchestration: preview -> gates -> blast.
//
// Imports getPreview (lib/harness/preview.mjs) and applyGates
// (lib/harness/gates.mjs); this file only wires them together.
// Zero dependencies, by design.

import { getPreview } from "./preview.mjs";
import { applyGates, loadRuleJson } from "./gates.mjs";
import { assignLenses, orderBlast } from "./blast.mjs";

const DEFAULT_BUDGET = 100;

/** Normalize a skipped entry to { path, reason }; reason is required. */
function normalizeSkip(s) {
  if (typeof s === "string") return { path: s, reason: "unspecified" };
  return {
    path: s?.path ?? s?.file ?? String(s),
    reason: (s?.reason ?? s?.skipReason ?? "unspecified").trim() || "unspecified",
  };
}

/**
 * Run the deterministic harness end to end.
 *
 * @param {{ cwd?: string, from?: string, to?: string, mode?: string,
 *   lensCount?: number, budget?: number }} opts
 * @returns {{ preview: Array<object>, reviewed: Array<object>,
 *   skipped: Array<{ path: string, reason: string }>,
 *   ordered: Array<{ path: string, risk: string, callers: string[] }>,
 *   assignments: Array<object>, coverage: string }}
 */
export async function runHarness({
  cwd = process.cwd(),
  from,
  to,
  mode,
  lensCount = 1,
  budget = DEFAULT_BUDGET,
} = {}) {
  const preview = await getPreview({ cwd, from, to, mode });

  // Canonical gates call: preview rows + repo rule.json (silent skip if absent).
  const ruleJson = loadRuleJson(cwd);
  const gates = await applyGates(preview, { ruleJson });
  const reviewed = Array.isArray(gates) ? gates : (gates?.reviewed ?? []);
  const skipped = (Array.isArray(gates) ? [] : (gates?.skipped ?? [])).map(normalizeSkip);

  const { ordered, assignments: budgetShares } = orderBlast(reviewed, { cwd, budget });
  const nLenses = Math.max(1, Math.floor(Number(lensCount) || 1));
  const assignments = nLenses > 1 ? assignLenses(ordered, nLenses) : budgetShares;

  const total = preview?.length ?? 0;
  const tally = new Map();
  for (const s of skipped) tally.set(s.reason, (tally.get(s.reason) ?? 0) + 1);
  const detail = skipped.length
    ? [...tally.entries()].map(([r, n]) => `${r}: ${n}`).join(", ")
    : "no skips";
  const coverage = `total ${total} / reviewed ${reviewed.length} / skipped ${skipped.length} (${detail})`;

  return { preview, reviewed, skipped, ordered, assignments, coverage };
}
