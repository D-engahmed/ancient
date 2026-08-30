# Performance and Cost Engineering

## 1. Performance budget

Every execution should have budgets:

``` text
latency budget
token budget
model cost budget
tool-call budget
parallelism budget
memory budget
retry budget          # NEW: bounded attempts, not unbounded backoff forever
```

Budgets turn resource use into an engineering constraint.

------------------------------------------------------------------------

## 2. Cost-aware routing

Routing should evaluate:

``` text
capability fit
expected quality
latency
price
fallback availability
observed failure rate    # NEW: a cheap model that fails 40% of the time
                           # is not actually cheap once retries are counted
```

Not just:

``` text
largest model wins
```

------------------------------------------------------------------------

## 3. Parallelism is not automatically faster

Parallel work creates:

``` text
coordination cost
context duplication
resource contention
merge conflicts
```

Use parallelism only when critical-path reduction exceeds coordination
overhead.

------------------------------------------------------------------------

## 4. Context is a resource

More context can reduce quality.

The context manager needs:

``` mermaid
flowchart LR
    Sources --> Retrieve
    Retrieve --> Rank
    Rank --> Budget
    Budget --> Compose
```

Measure relevance, not only token count.

------------------------------------------------------------------------

## 5. Cache deliberately

Potential cache targets:

-   provider metadata
-   repository indexing
-   retrieval results
-   deterministic tool output

Do not cache:

-   security-sensitive output without isolation
-   mutable execution state without invalidation rules
-   **a failed result** --- never cache an error response as if it were
    a valid cache hit; a transient `PROVIDER_UNAVAILABLE` from ten
    seconds ago is not evidence the provider is still down now

------------------------------------------------------------------------

## 6. Performance testing

Measure end-to-end:

``` text
request accepted
→ execution created
→ first useful output
→ completion
```

Also measure, separately:

``` text
request accepted
→ execution created
→ first failure
→ recovery (retry / fallback / degrade)
→ completion
```

Do not optimize a fast function inside a slow architecture, and do not
report a headline latency number that hides how much of it comes from
retry overhead --- report both the p50/p95 for clean runs and for
recovered runs.
