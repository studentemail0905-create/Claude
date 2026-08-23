# memory/entries.jsonl

Append-only JSON-lines memory store, managed by `../scripts/memory_store.py`.
Don't hand-edit this file — use the script (`add`, `search`, `list`, `stats`)
so IDs and timestamps stay consistent. It's committed to git on purpose: this
repo runs in ephemeral containers, and committing is what makes memory
actually survive across sessions instead of evaporating with the container.

Each line is one entry: `{"id", "ts", "text", "tags", "source"}`.
