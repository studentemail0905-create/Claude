---
name: super-brain
description: Persistent cross-session memory and structured-answer system for this repo, inspired by jcode's agent-memory/swarm architecture. Gives Claude a real long-term memory instead of starting cold every session — store durable facts, preferences, decisions, and project context as they come up, recall relevant ones before answering, delegate research or multi-part work to subagents instead of doing it all serially, and present answers in a scannable, structured way instead of a wall of prose. Use this skill proactively and by default on essentially every substantive turn in this repo — not just when the user says "remember" or "recall." Trigger it whenever: the user shares a preference, decision, fact, or piece of project context worth keeping past this session; a new prompt might relate to something discussed before (check memory first); a task is big enough to benefit from delegating pieces to subagents; or an answer would land better as structured output (list/table/sections) than a paragraph. This is the default operating mode for this repo, not an opt-in tool.
---

# super-brain

A standing memory + delegation + presentation layer for Claude Code sessions
in this repo, adapted from three ideas in
[jcode](https://github.com/1jehuang/jcode) (a Rust coding-agent harness):
its agent-memory system (recall relevant past turns without an explicit ask),
its multi-agent swarm (a coordinator delegates parallel work instead of doing
everything serially), and its emphasis on dense, structured output over
scrollback walls of text. jcode does memory via vector embeddings and a
background daemon process; this skill gets the same *behavior* — recall that
doesn't require the user to ask, and consolidation that happens without
being told — using only what a Claude Code session actually has: local
files, the `Agent` tool, and (for the "runs on every turn automatically"
part) hooks in `.claude/settings.json` that call the script in this skill.
There's no vector DB and no daemon here — keyword/tag search over a JSONL
file is the honest equivalent, and it's enough: the point isn't the
retrieval algorithm, it's that recall and consolidation happen without
being asked.

## Why this exists, and how the pieces fit together

A session without memory forces the user to re-explain context every time.
The fix has two halves, and they run at different layers:

1. **The mechanical half — hooks.** `.claude/settings.json` should wire a
   `UserPromptSubmit` hook that runs `scripts/memory_store.py search` on the
   incoming prompt and injects any hits as context, and a `Stop` hook that
   nudges extraction after each answer. Hooks are what makes this
   deterministic — "every time," not "whenever the model remembers to." If
   this repo's `.claude/settings.json` doesn't have those hooks yet, that's
   a gap worth closing: use the `update-config` skill to add them (don't
   hand-edit `settings.json` from here — that skill knows the current hook
   event schema and how to wire scripts safely).
2. **The judgment half — you, in this skill.** Hooks can inject raw search
   results into context, but they can't decide *what's worth remembering*
   or *how to weave a recalled fact into an answer* — that needs judgment,
   which is what the rest of this file covers. Even with hooks wired, keep
   doing the parts below directly: hooks are a safety net for consistency,
   not a replacement for actually thinking about what matters.

In other words: don't wait for hook infrastructure to start acting on
memory. Use the script directly, every relevant turn, starting now.

## 1. Recall before you answer

Before working on anything that might connect to prior context — a
follow-up, a preference-sensitive choice, a "like we discussed" — check
memory first:

```bash
python3 .claude/skills/super-brain/scripts/memory_store.py search "<key terms from the current prompt>"
```

Pull 2-4 key terms from the user's actual words, not a paraphrase — the
search is plain keyword/tag overlap (see `scripts/memory_store.py`'s
docstring for the scoring), so terms that don't appear in stored text won't
match no matter how conceptually related they are. An empty result is
common and fine — it means answer from scratch, not that something is
broken.

When you get hits, use them the way you'd use something you actually
remembered: weave the relevant fact in naturally, don't recite "According to
my memory store, entry #4 says...". The user should experience this as you
having a good memory, not as you narrating a database lookup.

## 2. Store what's actually durable

After a turn where something worth keeping past this session came up, store
it:

```bash
python3 .claude/skills/super-brain/scripts/memory_store.py add "<one clear factual sentence>" --tags tag1,tag2
```

Worth storing: stable preferences ("wants commit messages under 3 lines"),
project decisions ("chose Postgres over SQLite for X because Y"), durable
facts about the user's setup or goals, corrections the user made to your
work (so you don't repeat the mistake). **Not** worth storing: anything
already obvious from the codebase itself, one-off task details that won't
matter next session, or anything sensitive the user hasn't clearly meant to
persist (credentials, anything they'd be unhappy to see resurface later —
when in doubt, don't store it).

Write entries as standalone facts, not conversation fragments — "user
prefers X" reads correctly in isolation six months from now; "yeah that
sounds good" does not. Tag consistently (`preference`, `decision`,
`project:<name>`, `person:<name>`, ...) so `--tag` filtering and search stay
useful as the store grows — skim `memory_store.py stats` occasionally to see
what tags already exist before inventing a new one.

Do this as you go, not as a batch job at the end — a fact mentioned in
passing and never written down is a fact that's gone once the session ends.

## 3. Delegate the pieces that don't need to be serial

For research-heavy or multi-part tasks, don't do everything yourself
serially — that's exactly what jcode's swarm avoids, and Claude Code's
`Agent` tool is the direct equivalent. Read `references/agent-patterns.md`
before a task big enough that delegation is a live question (multi-part
investigation, independent parallel changes, open-ended research that would
otherwise fill the main thread with exploratory tool calls). It covers when
delegation actually pays for itself versus when it's just overhead, how to
brief a subagent so it doesn't re-derive context you already have, and how
to fire independent pieces in parallel rather than one at a time.

## 4. Answer in a structured, scannable way

Match structure to the content, don't impose it reflexively:

- A multi-part answer (steps, comparisons, several distinct findings)
  earns headers, a table, or a bulleted list — that's the "more proper
  manner" a wall of prose can't deliver.
- A single fact or a yes/no answer doesn't need any of that scaffolding —
  a table with one row is worse than a sentence. Structure should make
  information easier to scan, not perform thoroughness.
- When you recalled memory and it changes or informs the answer, make that
  visible in how you present it (e.g., a short "given that you prefer X..."
  lead-in) rather than burying the connection.

This is the same principle the top-level tone-and-style guidance already
states — this skill isn't adding new rules here so much as flagging that
memory recall is a reason structure often pays off (comparing "what you
told me before" against "what's true now" is naturally a two-column
situation).

## Script reference

`scripts/memory_store.py` (stdlib-only, no dependencies) — full docstring at
the top of the file:

| Command | Purpose |
|---|---|
| `add <text> [--tags a,b] [--source S]` | Append a memory entry |
| `search <query> [--limit N] [--tag T]` | Keyword-ranked recall, most relevant first |
| `list [--limit N] [--tag T]` | Most recent entries, newest first |
| `stats` | Entry count + tag frequency, for a quick sanity check |

Data lives in `memory/entries.jsonl`, one JSON object per line. It's
committed to git deliberately — this environment runs in ephemeral
containers, so committing the store is what makes memory actually survive
between sessions instead of vanishing with the container. Don't hand-edit
the JSONL; go through the script so IDs/timestamps stay consistent.
