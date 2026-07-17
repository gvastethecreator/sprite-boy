# Ticket 001 — Globally reachable Job Center drawer

- **Status:** active
- **Owner:** `AppLayout` trigger/overlay + `components/studio/JobCenter.tsx`.
- **Consumes:** one JobStore, one provider runner, F7-03 selectors, shared
  StudioDialog/StudioPanel.
- **Must show:** empty, active progress, terminal status, attempt, safe details,
  active/total summary and polite aggregate updates.
- **Must act:** cancel through the runner; retry only through a supplied real
  callback and only for an unconsumed source.
- **Must preserve:** Escape precedence, trigger focus restore, compact fit,
  reduced motion, no duplicate mounts and no project persistence/history.
- **Acceptance:** component+A11Y tests, final browser captures and independent
  `accept`.

