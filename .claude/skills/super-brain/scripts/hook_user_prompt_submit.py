#!/usr/bin/env python3
"""
UserPromptSubmit hook glue for super-brain.

Reads the hook's stdin JSON (contains a "prompt" field with the text the
user just submitted), searches the memory store for anything relevant, and
- if it finds hits - emits hookSpecificOutput.additionalContext so the
model sees them before it starts working on the new prompt. Emits nothing
(valid, empty JSON) when there's no match or no prompt, so silence is the
common case, not an error.
"""
import json
import subprocess
import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MEMORY_STORE = os.path.join(SCRIPT_DIR, "memory_store.py")


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        print("{}")
        return

    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        print("{}")
        return

    try:
        result = subprocess.run(
            [sys.executable, MEMORY_STORE, "search", prompt, "--limit", "5"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        entries = json.loads(result.stdout) if result.returncode == 0 else []
    except (subprocess.SubprocessError, json.JSONDecodeError, ValueError):
        entries = []

    if not entries:
        print("{}")
        return

    lines = [f"- {e.get('text', '')}" + (f" [{', '.join(e.get('tags', []))}]" if e.get("tags") else "") for e in entries]
    context = (
        "super-brain memory recall — the following past entries may be relevant "
        "to the user's current prompt (weave them in naturally if useful, "
        "ignore if not actually relevant):\n" + "\n".join(lines)
    )
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": context}}))


if __name__ == "__main__":
    main()
