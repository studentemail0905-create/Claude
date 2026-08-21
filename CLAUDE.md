# Subagent delegation policy

This repo holds Pratulya's Claude Code skills and custom subagent definitions.
Custom subagents live in `.claude/agents/*.md`; their usage is tracked in
`.claude/agents/REGISTRY.md`. Follow this policy fully autonomously — no need to
ask before creating, delegating to, or retiring an agent.

## The cap

**Maximum 8 subagent definitions in `.claude/agents/` at any time.** Check
`.claude/agents/REGISTRY.md` before creating a new one. If 8 already exist and a
genuinely new recurring category emerges, retire the agent with the oldest
"Last used" date (log the retirement in the registry, delete its `.md` file) and
create the new one in its place.

## Growth: organic, not seeded

Don't pre-create agents for guessed categories. Instead:

1. When a task comes in, check `.claude/agents/REGISTRY.md`'s Log table for an
   existing agent whose domain matches. If one fits, delegate to it (see
   Delegation below) instead of doing the work inline.
2. If no existing agent fits, check the Watchlist table. If this category is
   already listed, increment its occurrence count and update "Last seen." If its
   occurrence count reaches **2**, create a dedicated subagent for it now (see
   Creating an agent) and move it from the Watchlist to the Log.
3. If the category isn't on the Watchlist either, add it with occurrence count 1
   and do the task inline (no agent yet — one occurrence isn't a pattern).
4. Pratulya can also just ask directly ("make an agent for X") — that skips the
   threshold and creates one immediately, cap permitting.

A "category" is a recurring *kind* of task with a stable domain and output shape
(e.g. "SEO audits," "code review," "research/exploration") — not every individual
request. Judge similarity the way a person would, not by exact string match.

## Creating an agent

Use the `agent-builder` skill's design principles (`.claude/skills/agent-builder/`)
when writing a new `.claude/agents/<name>.md`:
- 3-5 capabilities max to start (i.e. a tight, specific `tools` list — not `*`
  unless the domain genuinely needs everything)
- One clear domain, one clear job — don't build a generalist
- Trust the model: a good description + scoped tools beats a rigid step-by-step
  script in the agent's prompt

Standard Claude Code subagent file format: YAML frontmatter (`name`,
`description`, `tools`, optionally `model`) followed by the system prompt. Then
add a row to `REGISTRY.md`'s Log table (Created = today, Last used = today, Use
count = 1).

## Delegation

When a task matches an existing agent's domain, delegate via the `Agent` tool
with that `subagent_type` rather than doing the work in the main conversation —
that's the entire point (keeps main context clean, lets the agent specialize).
After delegating, bump that agent's "Last used" date and Use count in
`REGISTRY.md`.

Skip delegation for trivial one-offs even if they'd technically match a domain —
the cost of a round-trip isn't worth it for something a single tool call answers
directly.
