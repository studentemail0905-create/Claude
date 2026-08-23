#!/usr/bin/env python3
"""
Stop hook glue for super-brain.

Nudges Claude to consider persisting anything durable from the turn that
just ended, via memory_store.py add. Uses decision:"block" (Claude Code's
documented mechanism for a Stop hook to keep the turn going) so the
reminder actually reaches the model instead of being silently discarded -
a Stop hook has no other way to inject text, since the conversation has
already ended by the time it runs.

Guards against the obvious failure mode of that mechanism (infinite loop:
block -> Claude responds -> Stop fires again -> block again forever) by
checking stop_hook_active, which Claude Code sets to true on the Stop
event that follows a hook-issued block. Seeing it true means this hook
already fired once for this turn, so it backs off instead of blocking
again.
"""
import json
import sys


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        payload = {}

    if payload.get("stop_hook_active"):
        print("{}")
        return

    reason = (
        "super-brain: before finishing up, consider whether anything from this turn "
        "is worth remembering past this session - a stated preference, a decision, a "
        "correction, durable project context. If so, store it now with: "
        "python3 .claude/skills/super-brain/scripts/memory_store.py add \"<fact>\" "
        "--tags tag1,tag2. If nothing durable came up, no action needed - just say so "
        "briefly and stop."
    )
    print(json.dumps({"decision": "block", "reason": reason}))


if __name__ == "__main__":
    main()
