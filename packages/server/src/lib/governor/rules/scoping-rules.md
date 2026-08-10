## Scoping Rules

- Work on one feature unit at a time.
- Prefer small, verifiable increments over large speculative changes.
- Do not combine changes across unrelated packages in a single implementation step.

## When To Split Work

Split an implementation step if it combines:

- CLI UI changes and server-side AI orchestration changes
- Schema changes and unrelated feature work
- Multiple unrelated route handlers or tool definitions
- Behavior that is not clearly defined in the context files

If a change cannot be verified end to end quickly, the scope is too broad — split it.
