# Repository Instructions for Claude

## Standing Operating Rules (always follow)

1. **Event-driven, not polling.** Prefer subscribing to events (PR activity webhooks, task
   notifications, etc.) over scheduled/manual status checks. Only schedule a check-in when no
   event subscription actually covers that signal.
2. **Direct replacement, no fallback duality.** When the user requests a change, implement it as
   a direct replacement of the old behavior. Do not add feature flags, dual code paths, "v2"
   parallel implementations, or backwards-compatibility shims to keep old behavior alongside new
   — replace the old feature outright and make sure the new one works. Only build a flag/toggle
   if the user explicitly asks for one.

Full project context and session history: see `MEMORY.md`.
