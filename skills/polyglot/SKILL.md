---
name: polyglot
description: Detect the stack in the touched files and run the right build, test, and lint commands for Python, Go, Rust, Node, Java, or Docker
---

Use this when a command needs to verify code and the repo's stack is unknown or mixed. Detect from the files and manifests actually present — never assume a runner, a package manager, or a test suite exists.

## Detection — manifests beat vibes

Check the touched area for these signals, in order. Several may match at once — that means polyglot, and each area reports its own stack.

- Python: `pyproject.toml`, `setup.cfg`, `requirements*.txt`, `uv.lock`, `.venv`
- Go: `go.mod`
- Rust: `Cargo.toml`
- Node/TypeScript: `package.json` (read `packageManager` + `scripts`; never assume `npm`)
- Java: `pom.xml`, `build.gradle*`
- Docker: `Dockerfile`, `compose*.yml`, `docker-compose*.yml` (note presence only — never build or start images unasked)

## Commands matrix

Prefer the repo's declared script over the raw tool (e.g. `scripts.test` before bare `pytest`). Probe cheaply (`--version` / `--help`) before running anything long.

| Stack | Test | Lint / typecheck | Notes |
|:--|:--|:--|:--|
| Python | `pytest -q` (or `uv run pytest -q`) | `ruff check .`, `mypy` only if configured | Activate `.venv` if present; never install packages unasked |
| Go | `go test ./...` | `gofmt -l .`, `go vet ./...` | No venv; module-aware via `go.mod` |
| Rust | `cargo test --quiet` | `cargo clippy -- -D warnings`, `cargo fmt --check` | First build may be slow — say so before running |
| Node/TS | `npm test -- --runInBand` (or pnpm/yarn per `packageManager`) | `npm run lint`, `npm run typecheck` if declared | Never run `npm install` unasked; respect lockfile |
| Java | `mvn -q test` or `./gradlew test` | `mvn -q checkstyle:check` only if configured | Wrapper script (`mvnw`/`gradlew`) wins over system binary |
| Docker | n/a | `docker compose config --quiet` to validate only | Validate, never `up` — starting services is a separate decision |

## Rules

- Read-only first: manifests and scripts before any execution.
- Cheapest probe first: `--version` before the suite, one package before `./...`.
- If no runner exists for a stack, report `no-framework` loudly. An unverifiable claim is not a satisfied one.
- Never touch `.github/workflows/`, CI config, lockfiles, or secrets to make a check pass.

## Report-back format (required)

End any verification block with one line per command run:

```
[polyglot: <stack> `<cmd>` → exit <n> · <summary line or "none found">]
```

If no command was run, the line reads `[polyglot: <stack> no command — <why>]`. This is the artifact that makes the skill checkable: a reader can point at the line and say whether the check ran.
