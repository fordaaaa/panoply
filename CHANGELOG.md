# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [semver](https://semver.org/).

## [0.3.0] — 2026-08-18

No functional change. First release published through the automated pipeline rather than by hand, and the first to carry a git tag — 0.2.0 went to npm without either.

### Changed

- Version bumped across `package.json`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json`, which CI holds in lockstep.

## [0.2.0] — 2026-08-13

Published to npm but never tagged or documented; these notes were written after the fact. Global install, and a GitHub MCP server that actually connects.

### Added

- **`npx panoply init --global`** — installs once for every project on the machine, writing to the user-level directory each agent already merges with the project's: `~/.claude/commands/`, `~/.config/opencode/commands/`, `~/.cursor/commands/`. Detection follows the same scope, looking at the home directory instead of the working tree.
- **Header support in the MCP roster.** `mcp/servers.json` entries can carry a `headers` map, rendered into all three generated configs. `${VAR}` is expanded by the host agent at load time, so no token is ever written into a generated file.
- **`release.yml`** — publishes to npm on a `v*` tag via trusted publishing over GitHub OIDC. No `NPM_TOKEN` secret exists to leak or rotate, and provenance attestations are automatic. The job refuses to publish if the tag and `package.json` version disagree.

### Changed

- **The GitHub MCP server authenticates with a token, not OAuth.** Its OAuth does not support dynamic client registration, so the in-agent flow fails; the roster now sends `Authorization: Bearer ${GITHUB_MCP_TOKEN}`. Toolset pinning moved from the `?toolsets=` query parameter — silently ignored by the server — to the `X-MCP-Toolsets` header, which actually filters, 44 tools down to 38.

### Fixed

- **User-level MCP configs are written atomically.** `~/.claude.json` is the running app's live state file, not ours, and rewriting it in place risked a reader seeing a half-written file or a bad merge eating untouched settings. The installer now backs up to `.panoply-bak`, writes a sibling temp file, and renames it over the target.

## [0.1.0] — 2026-08-11

First versioned release. Adds four commands, one-command install, and a safety pass over the two that existed.

### Added

- **`/map`** — cached repo cartography at `.panoply/map.md`, stamped with the commit it was built from and refreshed incrementally, so sessions stop re-reading the whole tree.
- **`/spec`** — a resumable spec and checklist at `.panoply/specs/<slug>.md`, with an append-only decisions log. Survives a compacted context, a restart, or switching tools.
- **`/verify`** — grades the working diff against a spec's acceptance criteria using four parallel checkers, runs the suite in the main thread, and writes the verdict back to the spec.
- **`/debug`** — hypothesis ledger at `.panoply/debug/<slug>.md`. Every theory gets a falsifying experiment and a recorded result, so nothing is tested twice.
- **Install without cloning** — `npx panoply init` detects the host agent and installs; Claude Code users can add the repo as a plugin marketplace instead.
- **One canonical MCP roster** — `mcp/servers.json` renders into `.mcp.json`, `.cursor/mcp.json`, and `opencode.json`. Opt-in servers (`context7`, `playwright`, `sentry`) ship only with `--with`.
- **`{{INCLUDE:_partial.md}}`** in `build.mjs`, replacing the single-purpose `{{BOOTSTRAP}}` token. Shared partials for the severity scale, git preflight, and untrusted-input rules.
- **`node build.mjs --lint`** and a CI workflow gating staleness, determinism, dependency count, and version lockstep.

### Changed

- **`autoclose` now defaults to `off`.** Auto-merge requires five conditions to hold simultaneously — a passing test suite that actually covers the change, maintainer-authored issues, no foreign commits on the branch, and a genuinely mergeable PR. `--admin` is never passed.
- **Bootstrap no longer runs on first invocation.** Commands start in local mode and stay there until you ask for something that leaves the working tree. It no longer runs `gh auth login`, triggers MCP OAuth silently, executes `build.mjs` in your repo, or writes files before you've answered anything.
- **`/cr-run` tiers renamed** `low|medium|high` → `quick|standard|deep`, defaulting to `quick`, and now print a cost estimate and ask before spending above it. The old names described thoroughness; these describe spend.
- The GitHub MCP server is pinned to the `issues,pull_requests,repos` toolsets — roughly 15–25k tokens of tool definitions per session down to 5–7k.
- Filed issues carry a `panoply` label, and dedupe filters on it instead of scanning every open issue.

### Fixed

- **`build.mjs` deleted any `.md` in a target directory that wasn't one of its own commands.** Run in a consumer's repo, this destroyed their hand-written slash commands. Deletion is now scoped to files carrying the generated marker.
- `description` was emitted unquoted for the Claude Code target only; any description containing `:` produced invalid YAML and the command silently vanished from the picker.
- `{{BOOTSTRAP}}` substitution failed on a CRLF checkout, and used string replacement, so `$&` or `$1` inside a partial would corrupt the output.
- Missing `name`/`description` rendered the literal string `undefined` into shipped files; both are now required and validated.
- A directory named `*.md` in a target dir crashed the cleanup pass.
- Mismatched frontmatter quotes (`"foo'`) were stripped as if they matched.
- `/cr-fix` hardcoded `main` and a fixed branch name — it now resolves the default branch and timestamps the branch so a second run can't collide with or inherit a stale one.
- `/cr-run` claimed it "never edits files" while local mode edited the working tree.
- `/cr-fix` local mode was unreachable by construction: `filing: local` files no issues, so there were never any issue numbers to resolve.
- Subagents were called read-only while being spawned as `general-purpose`, which can write.

### Security

- Added an untrusted-input rule to every command. Issue bodies, comments, and repo source are data, not instructions — a pipeline that reads an issue and ends in a merge to the default branch is a prompt-injection path to `main`. Issue-driven fixes may never touch `.github/workflows/`, CI config, lockfiles, or credentials, and non-maintainer issues never auto-merge.
- Security findings are never auto-filed. Filing a 🔴 vulnerability as a public issue is a zero-day disclosure with no fix available; these are reported on screen, with a private advisory offered instead.
- Bootstrap adds `.panoply/` to `.gitignore` — a committed `autoclose: on` silently applied to every collaborator.

### Removed

- `browser-capture/` — an untracked orphan holding one stale `.pyc` and no source. The opt-in `playwright` MCP server covers it.
