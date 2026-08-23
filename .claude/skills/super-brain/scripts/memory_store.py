#!/usr/bin/env python3
"""
super-brain memory store — dependency-free JSONL memory for Claude Code.

Storage format: one JSON object per line in memory/entries.jsonl:
  {"id": 1, "ts": "2026-08-23T12:00:00+00:00", "text": "...", "tags": ["preference"], "source": "manual"}

Subcommands:
  add <text> [--tags a,b,c] [--source SOURCE]
      Append a new memory entry. Prints the stored entry as JSON.

  search <query> [--limit N] [--tag TAG]
      Keyword-score every entry against the query, print the top N
      (default 5) as JSON, most relevant first. Ties broken by recency.
      Returns an empty JSON array (not an error) when nothing matches —
      callers should treat that as "no relevant memory," not a failure.

  list [--limit N] [--tag TAG]
      Print the N most recent entries (default 20), newest first.

  stats
      Print entry count and tag frequency, for a quick sanity check.

No third-party dependencies — stdlib only, so hooks can call this with
plain `python3` and nothing else needs to be installed.
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

STORE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "memory", "entries.jsonl")

_WORD_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text):
    return _WORD_RE.findall(text.lower())


def _load_entries():
    if not os.path.exists(STORE_PATH):
        return []
    entries = []
    with open(STORE_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return entries


def _next_id(entries):
    return (max((e.get("id", 0) for e in entries), default=0)) + 1


def cmd_add(args):
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    entries = _load_entries()
    tags = [t.strip() for t in args.tags.split(",")] if args.tags else []
    tags = [t for t in tags if t]
    entry = {
        "id": _next_id(entries),
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "text": args.text,
        "tags": tags,
        "source": args.source,
    }
    with open(STORE_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(json.dumps(entry, ensure_ascii=False))


def _score(entry, query_words):
    if not query_words:
        return 0.0
    haystack_words = _tokenize(entry.get("text", ""))
    tag_words = set(w for tag in entry.get("tags", []) for w in _tokenize(tag))
    haystack_set = set(haystack_words)
    score = 0.0
    for qw in query_words:
        if qw in tag_words:
            score += 3.0
        if qw in haystack_set:
            score += 1.0
        # partial/substring credit for near-matches (e.g. "prefer" vs "preference")
        elif any(qw in hw or hw in qw for hw in haystack_set if len(qw) > 3 and len(hw) > 3):
            score += 0.4
    return score


def cmd_search(args):
    entries = _load_entries()
    if args.tag:
        entries = [e for e in entries if args.tag in e.get("tags", [])]
    query_words = _tokenize(args.query)
    scored = [(e_, _score(e_, query_words)) for e_ in entries]
    scored = [pair for pair in scored if pair[1] > 0]
    scored.sort(key=lambda pair: (pair[1], pair[0].get("id", 0)), reverse=True)
    top = [e_ for e_, _s in scored[: args.limit]]
    print(json.dumps(top, ensure_ascii=False, indent=2))


def cmd_list(args):
    entries = _load_entries()
    if args.tag:
        entries = [e for e in entries if args.tag in e.get("tags", [])]
    entries.sort(key=lambda e: e.get("id", 0), reverse=True)
    print(json.dumps(entries[: args.limit], ensure_ascii=False, indent=2))


def cmd_stats(args):
    entries = _load_entries()
    tag_counts = {}
    for e in entries:
        for t in e.get("tags", []):
            tag_counts[t] = tag_counts.get(t, 0) + 1
    print(json.dumps({"count": len(entries), "tags": tag_counts}, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description="super-brain memory store")
    sub = parser.add_subparsers(dest="command", required=True)

    p_add = sub.add_parser("add", help="Add a new memory entry")
    p_add.add_argument("text", help="The fact/preference/decision to remember")
    p_add.add_argument("--tags", default="", help="Comma-separated tags, e.g. preference,project-x")
    p_add.add_argument("--source", default="manual", help="Where this entry came from (manual, hook, agent name, ...)")
    p_add.set_defaults(func=cmd_add)

    p_search = sub.add_parser("search", help="Search memory by keyword relevance")
    p_search.add_argument("query", help="Free-text query")
    p_search.add_argument("--limit", type=int, default=5)
    p_search.add_argument("--tag", default=None, help="Restrict to entries carrying this tag")
    p_search.set_defaults(func=cmd_search)

    p_list = sub.add_parser("list", help="List most recent entries")
    p_list.add_argument("--limit", type=int, default=20)
    p_list.add_argument("--tag", default=None)
    p_list.set_defaults(func=cmd_list)

    p_stats = sub.add_parser("stats", help="Show entry count and tag frequency")
    p_stats.set_defaults(func=cmd_stats)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
