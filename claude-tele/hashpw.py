#!/usr/bin/env python3
"""
hashpw.py — generate a salted passphrase hash for claude-tele's shell unlock.

The bot NEVER stores your shell passphrase in plaintext. Instead you store a
salted PBKDF2-SHA256 hash in config.json under `shell_passphrase_hash`, and
unlock the shell over Telegram with `/unlock <passphrase>`.

Usage:
    python3 hashpw.py
        → prompts for the passphrase (twice, hidden) and prints the hash line
          to paste into config.json.

    python3 hashpw.py --stdin
        → read the passphrase from stdin (for scripting); prints the hash.

Then set in config.json:
    "shell_passphrase_hash": "pbkdf2_sha256$200000$....$...."
"""

from __future__ import annotations

import getpass
import sys

from security import hash_passphrase


def main() -> int:
    if "--stdin" in sys.argv[1:]:
        passphrase = sys.stdin.readline().rstrip("\n")
    else:
        passphrase = getpass.getpass("Shell passphrase: ")
        confirm = getpass.getpass("Confirm passphrase: ")
        if passphrase != confirm:
            print("Passphrases did not match.", file=sys.stderr)
            return 1
    if not passphrase:
        print("Empty passphrase — aborting.", file=sys.stderr)
        return 1

    digest = hash_passphrase(passphrase)
    print()
    print("Paste this into claude-tele/config.json:")
    print()
    print(f'  "shell_passphrase_hash": "{digest}",')
    print()
    print("Then keep the plaintext passphrase off-machine (a password manager).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
