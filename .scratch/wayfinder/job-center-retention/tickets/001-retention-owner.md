# Ticket 001 — Atomic visible job retention

- **Status:** accepted
- **Owner:** `core/stores/jobRetention.ts` + JobStore reducer/selectors.
- **Consumes:** accepted F7-01 lifecycle/tombstones and F7-02 runner.
- **Must retain:** every active family, every ancestor required by a visible
  retry, session job/request tombstones and consumed retry sources.
- **Must prune:** only complete terminal root families, atomically and oldest
  activity first, until the configured terminal-family budget is satisfied.
- **Must reject:** accessors, inherited/missing/extra policy fields, non-integer
  or out-of-range budgets and any policy mutation after store construction.
- **Acceptance:** deterministic retention/selectors tests plus fresh reviewer
  verdict `accept`.
