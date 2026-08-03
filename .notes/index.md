# `.notes/` — private notes convention

**This `index.md` is the one exception in this folder: it's committed on purpose, as a template that documents the convention below. Every *other* file in `.notes/` is gitignored and stays private — see [`.gitignore`](../.gitignore).**

⚠️ Because this file is tracked, **anything you type here gets published** to the public repo. Do **not** put private notes, half-formed ideas, or TODOs in `index.md`. Put those in *sibling* files (e.g. `.notes/todo.md`, `.notes/design.md`) — those are gitignored and never leave your machine.

Open this folder directly as an Obsidian vault if you want backlinks/graph — Obsidian only needs a folder of markdown, no commit required.

## How knowledge is split
- **`.notes/` (except this file)** — private, this-project dev notes. Local only, gitignored.
- **Claude Code memory** (`~/.claude/projects/<this-repo>/memory/`) — durable cross-session facts Claude recalls automatically. Private to you.
- **Public repo** — only things worth shipping: commands, prompts, README, and this template.
- **`.claude/cr/`** — runtime state (codebase map, learned notes) when the commands run *against a target repo*. Gitignored here so our own runs don't leak.

## For AI assistants
- Keep `.notes/` in `.gitignore`. If it isn't there, add it.
- **Never** `git add` or commit sibling files in `.notes/` — `index.md` is the only tracked file here, and it's a template, not a notes dump.
- Treat everything in `.notes/` other than this file as private context: safe to read, never to publish.
