# Engineering Review Checklist

Use this before accepting any new major subsystem.

## Problem

-   [ ] What exact problem does it solve?
-   [ ] What happens if we do nothing?
-   [ ] Is there a simpler solution?

## Ownership

-   [ ] Who owns this state?
-   [ ] Who is allowed to mutate it?
-   [ ] Who is allowed to observe it?

## Boundaries

-   [ ] What contract exposes it?
-   [ ] What internals are hidden?
-   [ ] What dependencies are allowed?

## Failure (expanded)

-   [ ] How does it timeout, and is the timeout strictly shorter than
        its parent's remaining budget?
-   [ ] How does it cancel, and does it register cleanup on the shared
        `AbortSignal`?
-   [ ] How does it retry, and has someone verified `idempotent` is
        actually true rather than assumed?
-   [ ] How does it recover, and is there a test that kills it
        mid-operation and checks the recovery plan?
-   [ ] Does it emit a classified `ErrorEnvelope`, or a raw
        exception/string?
-   [ ] Is its failure mode in the Layer 12.11 reference table? If not,
        add it before merging.
-   [ ] If it has an irreversible side effect, does it have a
        compensation path or a mandatory approval gate?

## Security

-   [ ] What authority does it receive?
-   [ ] Can untrusted input influence privileged actions?
-   [ ] Does it expose secrets?
-   [ ] Does its error output leak more than the caller's trust level
        allows (Layer 13.3)?

## Performance

-   [ ] What is the latency impact?
-   [ ] What is the cost impact?
-   [ ] Does it create unnecessary parallel work?
-   [ ] What is its cost impact *including* expected retries at its
        measured failure rate?

## Observability

-   [ ] Can we trace it?
-   [ ] Can we reproduce failure?
-   [ ] Can we measure cost?
-   [ ] Can we distinguish "succeeded cleanly" from "succeeded after
        recovering" in a dashboard?

## Validation

-   [ ] What benchmark proves it helps?
-   [ ] What test proves the failure mode works?
-   [ ] What metric would cause us to remove it?
-   [ ] What failure-injection test proves the recovery path, not just
        the happy path?

## Final gate

> Can this subsystem be deleted without the whole architecture
> collapsing?

If the answer is no, verify that its centrality is truly justified ---
and verify specifically that its *failure* has been designed with the
same rigor as its success path, since central subsystems are exactly
where an undesigned failure mode causes the widest blast radius.
