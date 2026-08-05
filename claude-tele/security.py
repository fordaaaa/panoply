"""
security.py — defense-in-depth helpers for claude-tele.

Everything here is PURE and side-effect-light on purpose so it can be unit
tested without a running bot or a Telegram token:

  - passphrase hashing / verification (salted PBKDF2-HMAC-SHA256, never plaintext)
  - a catastrophic-command denylist (best-effort guardrail, NOT a sandbox)
  - config-file permission tightening
  - bot-token resolution (env var > macOS Keychain > config.json)
  - an append-only audit log writer

IMPORTANT: none of this replaces the user-ID whitelist in bot.py. The whitelist
is the primary control; these are layers ON TOP of it.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import shutil
import stat
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# --------------------------------------------------------------------------
# Passphrase hashing (for the /unlock shell state machine).
# Stored format (single string, safe to keep in config.json):
#     pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>
# --------------------------------------------------------------------------

_PBKDF2_ALGO = "pbkdf2_sha256"
_DEFAULT_ITERATIONS = 200_000


def hash_passphrase(passphrase: str, iterations: int = _DEFAULT_ITERATIONS) -> str:
    """Return a salted PBKDF2 hash string for `passphrase`. Never stores or
    returns the plaintext. A fresh random salt is generated each call."""
    if not passphrase:
        raise ValueError("passphrase must not be empty")
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"), salt, iterations)
    return f"{_PBKDF2_ALGO}${iterations}${salt.hex()}${dk.hex()}"


def verify_passphrase(passphrase: str, stored: str) -> bool:
    """Constant-time verify `passphrase` against a `stored` hash string produced
    by hash_passphrase(). Returns False on any malformed/empty input rather than
    raising, so a bad config can never crash the unlock path."""
    if not passphrase or not stored:
        return False
    try:
        algo, iter_s, salt_hex, hash_hex = stored.split("$")
        if algo != _PBKDF2_ALGO:
            return False
        iterations = int(iter_s)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except (ValueError, AttributeError):
        return False
    dk = hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(dk, expected)


# --------------------------------------------------------------------------
# Catastrophic-command denylist.
# This is a GUARDRAIL against fat-finger disasters, NOT a security sandbox — a
# determined attacker who is already whitelisted can trivially evade it. Its job
# is to stop obvious machine-destroying commands from an unlocked shell.
# --------------------------------------------------------------------------

# (compiled regex, human label). All matched case-insensitively.
_DENY_PATTERNS = [
    (re.compile(r"\bmkfs\b", re.I), "mkfs (format filesystem)"),
    (re.compile(r"\bdd\b[^\n]*\bof=\s*/dev/", re.I), "dd of=/dev/… (raw disk write)"),
    (re.compile(r">\s*/dev/(sd|nvme|disk|hd)", re.I), "redirect to a raw disk device"),
    (re.compile(r":\s*\(\s*\)\s*\{", re.I), "fork bomb :(){ ... }"),
    (re.compile(r"\b(shutdown|reboot|halt|poweroff)\b", re.I), "shutdown/reboot/halt/poweroff"),
    (re.compile(r"\bmv\b[^\n]+\s+/dev/null\b", re.I), "mv … /dev/null (data destruction)"),
    (re.compile(r"\bchmod\b\s+-R\s+0*\s+/(?:\s|$)", re.I), "chmod -R 0 / (lock out the system)"),
]

# Targets that make an `rm -rf` catastrophic.
_DANGEROUS_RM_TARGETS = {"/", "~", "$HOME", "${HOME}", "/*", "~/*", "*", "."}


def _dangerous_rm(cmd: str) -> bool:
    """True if `cmd` contains an `rm` invocation with BOTH recursive and force
    flags aimed at the filesystem root, the home dir, or a bare wildcard."""
    # Split into rough command segments so `echo ok; rm -rf /` is inspected.
    for segment in re.split(r"[;&|\n]+", cmd):
        m = re.search(r"(?<![\w./-])rm(?![\w./-])(.*)", segment, re.I)
        if not m:
            continue
        flags: set[str] = set()
        targets: list[str] = []
        for tok in m.group(1).split():
            if tok.startswith("--"):
                if tok in ("--recursive", "--force", "--no-preserve-root"):
                    flags.add("r" if "rec" in tok else "f")
            elif tok.startswith("-"):
                flags.update(tok[1:])
            else:
                targets.append(tok)
        has_recursive = "r" in flags or "R" in flags
        has_force = "f" in flags
        if not (has_recursive and has_force):
            continue
        for tg in targets:
            norm = tg.rstrip("/") or "/"
            if tg in _DANGEROUS_RM_TARGETS or norm in _DANGEROUS_RM_TARGETS:
                return True
    return False


def catastrophic_reason(cmd: str) -> Optional[str]:
    """Return a human label if `cmd` matches a catastrophic pattern, else None.
    Case-insensitive, best-effort. Used to REFUSE (never execute) the command."""
    if not cmd:
        return None
    if _dangerous_rm(cmd):
        return "rm -rf on / or ~ (recursive force delete)"
    for pat, label in _DENY_PATTERNS:
        if pat.search(cmd):
            return label
    return None


# --------------------------------------------------------------------------
# Secret / config file handling.
# --------------------------------------------------------------------------

def tighten_permissions(path: Path) -> Optional[str]:
    """If `path` is group/other readable or writable, chmod it to 0600.
    Returns a warning message if it had to change perms, else None. POSIX only."""
    if os.name != "posix" or not path.exists():
        return None
    mode = path.stat().st_mode
    if mode & (stat.S_IRWXG | stat.S_IRWXO):
        os.chmod(path, 0o600)
        return (
            f"{path.name} was group/other-accessible (mode {oct(mode & 0o777)}); "
            "tightened to 0600. It holds your bot token — keep it private."
        )
    return None


_KEYCHAIN_SERVICE = "claude-tele-bot-token"


def resolve_bot_token(cfg: dict) -> Optional[str]:
    """Resolve the bot token in priority order:
        1. env var CLAUDE_TELE_BOT_TOKEN
        2. macOS Keychain (security find-generic-password -s claude-tele-bot-token -w)
        3. config.json's bot_token
    Returns the token string or None if none is usable."""
    env = os.environ.get("CLAUDE_TELE_BOT_TOKEN")
    if env and env.strip():
        return env.strip()

    if shutil.which("security"):  # macOS Keychain
        try:
            out = subprocess.run(
                ["security", "find-generic-password", "-s", _KEYCHAIN_SERVICE, "-w"],
                capture_output=True, text=True, timeout=10,
            )
            if out.returncode == 0 and out.stdout.strip():
                return out.stdout.strip()
        except (OSError, subprocess.SubprocessError):
            pass

    tok = cfg.get("bot_token")
    if tok and tok != "PASTE_BOTFATHER_TOKEN_HERE":
        return tok
    return None


# --------------------------------------------------------------------------
# Audit log (append-only). Every executed action + auth event is recorded.
# --------------------------------------------------------------------------

def append_audit(path: Path, sender_id, event: str, detail: str = "") -> None:
    """Append one ISO-timestamped line to the audit log. Never raises —
    auditing must not be able to take the bot down."""
    try:
        ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
        # Collapse newlines so one action is exactly one auditable line.
        detail = detail.replace("\n", "\\n").replace("\r", "")
        line = f"{ts}\tid={sender_id}\t{event}\t{detail}\n"
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(line)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    except Exception:  # noqa: BLE001 — auditing is best-effort, never fatal
        pass


# --------------------------------------------------------------------------
# Workspace guardrail (best-effort; documented as NOT a jail).
# --------------------------------------------------------------------------

def is_within(path: str, root: str) -> bool:
    """True if `path` resolves inside `root`. Used as a soft check only."""
    try:
        root_p = Path(root).expanduser().resolve()
        target = Path(path).expanduser().resolve()
        return target == root_p or root_p in target.parents
    except (OSError, ValueError):
        return False
