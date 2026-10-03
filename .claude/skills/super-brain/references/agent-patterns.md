# Delegation patterns

jcode's "swarm" lets a coordinator agent spawn subordinate agents that work
the same repo in parallel, each reporting back instead of the coordinator
doing every step itself. Claude Code's equivalent primitive is the `Agent`
tool. This file is the playbook for when that's worth doing versus when it's
just overhead — read it when a task is big enough that delegation is a live
question, not for routine single-file work.

## When to delegate

Delegate when a task splits into pieces that don't depend on each other's
output, or when a piece is pure research/search that would otherwise bloat
the main conversation with grep output and file dumps you don't need to keep
around. Good candidates:

- "Investigate X and Y" where X and Y touch unrelated parts of the codebase
- Open-ended research ("how does auth work here", "what's left before we can
  ship") that would otherwise mean many exploratory tool calls cluttering
  the main thread
- A batch of independent, mechanical changes across many files

Don't delegate a task that's already a single clear edit, or where step 2
depends on judgment calls made while doing step 1 — that just adds a
round-trip and a colder context for no benefit.

## Coordinator pattern

Acting as coordinator:

1. Break the task into pieces with minimal interdependency.
2. Fire independent pieces in the same turn (multiple `Agent` calls in one
   response) rather than one at a time — that's the actual parallelism win.
3. Brief each agent like a colleague with no memory of this conversation:
   state the goal, what's already known/ruled out, and exact file paths/line
   numbers where you have them. An agent that has to rediscover context you
   already have is wasted work.
4. Synthesize the returned reports yourself — don't just relay them
   verbatim. You're the one who knows why the task matters; use that to
   decide what's signal in each report.

## What NOT to do

Don't spawn an agent to save yourself three tool calls you could just make
directly — that's the overhead case. Reserve delegation for genuinely
parallel or genuinely context-heavy work, per the Agent tool's own guidance.
