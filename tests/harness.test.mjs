// Deterministic harness part 3 — pure-logic tests (zero deps).
// Covers: gates first-match-wins + include-bypass, matchGlob *, coverage
// reason required, verify 0,0 dropped, dedupe ignores line drift.
//
// Every case runs against the inline reference implementation below (same
// 6-gate order as commands/cr-run.md: binary → secret → rule-exclude →
// rule-include bypass → unsupported → default-exclude), so the suite is
// green standalone. When lib/harness/{gates,verify,index}.mjs are present,
// the "live modules" block asserts the same behaviour against the real code.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// --- inline reference implementation (mirrors the 6-gate spec) -------------

/** Glob `*` crosses segments (`.*`); `?` matches one char. Trailing `/` = prefix. */
export function matchGlob(pattern, path) {
  if (pattern.endsWith("/")) return path === pattern.slice(0, -1) || path.startsWith(pattern);
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") { re += ".*"; i++; }
      else re += ".*";
    } else if (c === "?") {
      re += ".";
    } else if ("+()^$.{}|[]\\".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`${re}$`).test(path) || new RegExp(`${re}$`).test(path.slice(path.lastIndexOf("/") + 1));
}

const SECRET_GLOBS = [".ssh/id_*", ".env*", "*.pem", "*.key", "credentials*.json"];
const UNSUPPORTED_GLOBS = ["*.lock", "package-lock.json", "pnpm-lock.yaml", "*.min.js", "*.map"];
const DEFAULT_EXCLUDE_GLOBS = [
  "*_test.go", "*.test.ts", "__tests__/", "fixtures/", "snapshots/",
  "*.gen.*", "*.pb.go", "vendor/", "node_modules/", "dist/", "target/",
];

const matchesAny = (globs, path) => globs.some((g) => matchGlob(g, path) || matchGlob(`*/${g}`, path));

/**
 * 6-gate filter, first match wins:
 * 1 binary → 2 secret → 3 rule exclude → 4 rule include (bypass 5,6) → 5 unsupported → 6 default-exclude.
 */
export function classifyFile(path, { isBinary = false, rule = null } = {}) {
  if (isBinary) return { status: "skipped", reason: "binary" };
  if (matchesAny(SECRET_GLOBS, path)) return { status: "skipped", reason: "secret" };
  if (rule?.exclude && matchesAny(rule.exclude, path)) return { status: "skipped", reason: "rule-exclude" };
  if (rule?.include && matchesAny(rule.include, path)) return { status: "reviewed", via: "include" };
  if (matchesAny(UNSUPPORTED_GLOBS, path)) return { status: "skipped", reason: "unsupported" };
  if (matchesAny(DEFAULT_EXCLUDE_GLOBS, path)) return { status: "skipped", reason: "default-exclude" };
  return { status: "reviewed" };
}

/** Every skipped file must carry a non-empty reason. */
export function assertCoverage({ total, reviewed, skipped }) {
  assert.equal(total, reviewed + skipped.length, "total must equal reviewed + skipped.length");
  for (const s of skipped) {
    assert.ok(s.path, "skipped entry needs a path");
    assert.ok(typeof s.reason === "string" && s.reason.length > 0, `skipped ${s.path} needs a reason (coverage bug)`);
  }
}

/** Drop unverified findings; misposition (line 0 / 0,0) never survives. */
export function verifyFindings(findings) {
  return findings.filter((f) => Number.isInteger(f.line) && f.line > 0);
}

const normSnippet = (s) => String(s ?? "").trim().replace(/\s+/g, " ");

/** Dedupe on path + category + snippet, tolerant of line drift. */
export function dedupe(findings) {
  const seen = new Set();
  const out = [];
  for (const f of findings) {
    const key = `${f.path}::${f.category ?? ""}::${normSnippet(f.snippet)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

// --- try the real modules (absent until parts 1/2 land) --------------------

async function tryImport(rel) {
  const p = resolve(root, rel);
  if (!existsSync(p)) return null;
  try {
    return await import(pathToFileURL(p).href);
  } catch {
    return null;
  }
}
const gatesMod = await tryImport("lib/harness/gates.mjs");
const verifyMod = await tryImport("lib/harness/verify.mjs");
const indexMod = await tryImport("lib/harness/index.mjs");

// --- tests -----------------------------------------------------------------

describe("matchGlob *", () => {
  it("matches basenames across directories", () => {
    assert.equal(matchGlob("*.pem", "certs/server.pem"), true);
    assert.equal(matchGlob("*.pem", "server.pem"), true);
    assert.equal(matchGlob("*.ts", "src/timing.ts"), true);
  });
  it("rejects non-matches", () => {
    assert.equal(matchGlob("*.pem", "certs/server.key"), false);
    assert.equal(matchGlob("*.ts", "src/auth.py"), false);
  });
  it("directory prefix matches everything under it", () => {
    assert.equal(matchGlob("vendor/", "vendor/lodash/index.js"), true);
    assert.equal(matchGlob("vendor/", "src/index.js"), false);
  });
});

describe("gates: first-match-wins", () => {
  it("binary (gate 1) beats secret (gate 2)", () => {
    const r = classifyFile(".env", { isBinary: true });
    assert.equal(r.status, "skipped");
    assert.equal(r.reason, "binary");
  });
  it("secret beats default excludes", () => {
    // contrived: a .pem living under vendor/ is still a secret drop
    const r = classifyFile("vendor/secret.pem", {});
    assert.equal(r.reason, "secret");
  });
  it("rule exclude drops with reason", () => {
    const rule = { exclude: ["generated/*", "*.gen.*"] };
    const r = classifyFile("generated/foo.gen.ts", { rule });
    assert.equal(r.status, "skipped");
    assert.equal(r.reason, "rule-exclude");
  });
  it("rule exclude beats a later include", () => {
    const rule = { exclude: ["vendor/*"], include: ["vendor/*"] };
    const r = classifyFile("vendor/keep.js", { rule });
    assert.equal(r.reason, "rule-exclude");
  });
});

describe("gates: include-bypass", () => {
  it("include keeps a file a later gate would drop (default excludes)", () => {
    const rule = { include: ["vendor/keep.js"] };
    const r = classifyFile("vendor/keep.js", { rule });
    assert.equal(r.status, "reviewed");
  });
  it("include keeps a file unsupported gate would drop", () => {
    const rule = { include: ["bundle.min.js"] };
    const r = classifyFile("bundle.min.js", { rule });
    assert.equal(r.status, "reviewed");
  });
  it("include does not rescue binary or secret (earlier gates)", () => {
    const rule = { include: [".env"] };
    assert.equal(classifyFile(".env", { rule }).reason, "secret");
    assert.equal(classifyFile(".env", { isBinary: true, rule }).reason, "binary");
  });
});

describe("coverage: reason required", () => {
  it("accepts fixtures where every skip has a reason", () => {
    for (const name of ["timing-attack", "secret-leak"]) {
      const raw = readFileSync(resolve(root, `evals/deterministic/${name}/expect.json`), "utf8");
      assertCoverage(JSON.parse(raw));
    }
  });
  it("rejects a skip without a reason", () => {
    assert.throws(() =>
      assertCoverage({ total: 2, reviewed: 1, skipped: [{ path: "x.ts" }] }),
    );
  });
});

describe("verify: 0,0 dropped", () => {
  it("drops line 0 and keeps real lines", () => {
    const out = verifyFindings([
      { path: "src/a.ts", line: 0, category: "x", snippet: "y" },
      { path: "src/a.ts", line: 12, category: "x", snippet: "y" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].line, 12);
  });
  it("drops missing/non-integer lines", () => {
    assert.equal(verifyFindings([{ path: "s.py", category: "sqli", snippet: "q" }]).length, 0);
  });
});

describe("dedupe ignores line drift", () => {
  it("collapses same path+category+snippet across lines", () => {
    const out = dedupe([
      { path: "src/db.py", line: 3, category: "sqli", snippet: "execute( f-string )" },
      { path: "src/db.py", line: 9, category: "sqli", snippet: "execute(  f-string )" },
    ]);
    assert.equal(out.length, 1);
  });
  it("keeps distinct snippets or categories", () => {
    const out = dedupe([
      { path: "src/db.py", line: 3, category: "sqli", snippet: "aaa" },
      { path: "src/db.py", line: 3, category: "sqli", snippet: "bbb" },
      { path: "src/db.py", line: 3, category: "xss", snippet: "aaa" },
    ]);
    assert.equal(out.length, 3);
  });
});

describe("fixtures match gates logic", () => {
  it("timing-attack: 5 total / 2 reviewed / secret+binary+vendor skipped", () => {
    const exp = JSON.parse(readFileSync(resolve(root, "evals/deterministic/timing-attack/expect.json"), "utf8"));
    assert.equal(exp.total, 5);
    assert.equal(exp.reviewed, 2);
    assert.deepEqual(
      exp.skipped.map((s) => s.reason).sort(),
      ["binary", "default-exclude", "secret"],
    );
    assert.equal(classifyFile(".env", {}).reason, "secret");
    assert.equal(classifyFile("assets/logo.png", { isBinary: true }).reason, "binary");
    assert.equal(classifyFile("vendor/lodash/index.js", {}).reason, "default-exclude");
    assert.equal(classifyFile("src/auth.ts", {}).status, "reviewed");
    assert.equal(classifyFile("src/timing.ts", {}).status, "reviewed");
  });
  it("secret-leak: 4 total / 2 reviewed / pem+test skipped", () => {
    const exp = JSON.parse(readFileSync(resolve(root, "evals/deterministic/secret-leak/expect.json"), "utf8"));
    assert.equal(exp.total, 4);
    assert.equal(exp.reviewed, 2);
    assert.deepEqual(
      exp.skipped.map((s) => s.reason).sort(),
      ["default-exclude", "secret"],
    );
    assert.equal(classifyFile("certs/server.pem", {}).reason, "secret");
    assert.equal(classifyFile("internal/auth_test.go", {}).reason, "default-exclude");
    assert.equal(classifyFile("src/auth.py", {}).status, "reviewed");
    assert.equal(classifyFile("src/db.py", {}).status, "reviewed");
  });
});

describe("live modules (skip until parts 1/2 land)", () => {
  it("index.mjs exports runHarness when present", async (t) => {
    if (!indexMod) { t.skip("lib/harness/index.mjs absent"); return; }
    assert.equal(typeof indexMod.runHarness, "function");
  });

  it("gates.mjs matchGlob(path, pattern) handles *", async (t) => {
    if (!gatesMod) { t.skip("lib/harness/gates.mjs absent"); return; }
    assert.equal(typeof gatesMod.matchGlob, "function");
    assert.equal(gatesMod.matchGlob("certs/server.pem", "*.pem"), true);
    assert.equal(gatesMod.matchGlob("certs/server.key", "*.pem"), false);
    assert.equal(gatesMod.matchGlob("vendor/lodash/index.js", "vendor/"), true);
  });

  it("gates.mjs applyGates is first-match-wins", async (t) => {
    if (!gatesMod) { t.skip("lib/harness/gates.mjs absent"); return; }
    assert.equal(typeof gatesMod.applyGates, "function");
    const r = gatesMod.applyGates([
      { path: ".env", isBinary: true },
      { path: "certs/server.pem" },
      { path: "internal/auth_test.go" },
      { path: "src/auth.py" },
    ], {});
    const reasonOf = (p) => r.skipped.find((s) => s.path === p)?.reason;
    assert.equal(reasonOf(".env"), "binary"); // gate 1 beats gate 2
    assert.equal(reasonOf("certs/server.pem"), "secret");
    assert.equal(reasonOf("internal/auth_test.go"), "default-exclude");
    assert.deepEqual(r.reviewed.map((f) => f.path), ["src/auth.py"]);
    for (const s of r.skipped) {
      assert.ok(s.reason && s.reason.length > 0, `skip ${s.path} needs a reason`);
    }
  });

  it("gates.mjs applyGates include bypasses later gates only", async (t) => {
    if (!gatesMod) { t.skip("lib/harness/gates.mjs absent"); return; }
    const kept = gatesMod.applyGates([{ path: "vendor/keep.js" }], { ruleJson: { include: ["vendor/keep.js"] } });
    assert.deepEqual(kept.reviewed.map((f) => f.path), ["vendor/keep.js"]);
    const dropped = gatesMod.applyGates([{ path: ".env" }], { ruleJson: { include: [".env"] } });
    assert.equal(dropped.reviewed.length, 0); // earlier secret gate still wins
    assert.equal(dropped.skipped[0].reason, "secret");
  });

  it("verify.mjs verifyFindings recovers or drops mispositioned 0,0", async (t) => {
    if (!verifyMod) { t.skip("lib/harness/verify.mjs absent"); return; }
    assert.equal(typeof verifyMod.verifyFindings, "function");
    const dir = mkdtempSync(join(tmpdir(), "harness-verify-"));
    writeFileSync(join(dir, "a.ts"), "const x = 1;\nconst y = needle();\nconst z = 3;\n");
    // line 0 with a findable snippet recovers to the real line
    const recovered = verifyMod.verifyFindings(
      [{ file: "a.ts", line: 0, snippet: "needle()", category: "c" }], { cwd: dir },
    );
    assert.equal(recovered.verified.length, 1);
    assert.equal(recovered.verified[0].verifiedLine, 2);
    // line 0 with an unfindable snippet is dropped, never filed floating
    const dropped = verifyMod.verifyFindings(
      [{ file: "a.ts", line: 0, snippet: "no-such-snippet-xyz", category: "c" }], { cwd: dir },
    );
    assert.equal(dropped.verified.length, 0);
    assert.equal(dropped.dropped.length, 1);
  });

  it("verify.mjs dedupe ignores line drift", async (t) => {
    if (!verifyMod) { t.skip("lib/harness/verify.mjs absent"); return; }
    assert.equal(typeof verifyMod.dedupe, "function");
    const out = verifyMod.dedupe([
      { file: "p", category: "c", snippet: "s", line: 1 },
      { path: "p", category: "c", snippet: "s", line: 2 },
    ]);
    assert.equal(out.length, 1);
  });
});
