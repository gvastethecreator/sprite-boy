# Wayfinder: F7-04 Job Center UI ownership

## Question

Where can Job Center remain reachable in every workspace and viewport while
sharing the accepted store/runner, focus trap and panel primitives instead of
adding feature-local progress/toast surfaces?

## Current routes

- `components/layout/AppLayout.tsx` owns the one Studio shell, modal precedence,
  desktop/compact breakpoint and all globally reachable overlays.
- `StudioHeader` is present in empty and ready workspaces at every viewport. Its
  right action cluster is the stable Job Center trigger location.
- `StudioDialog` already owns focus trap, Escape, restore and reduced motion;
  `StudioPanel` owns labelled sidebar/drawer presentation. F7-04 should compose
  them rather than create another overlay primitive.
- `StudioStoreContext` owns the single JobStore but not a shared JobRunner. A
  provider-owned runner is the minimum real cancel port; feature adapters may
  inject retry actions when their vertical slices arrive.
- F7-03 provides memoized active-first entries, summaries and retry eligibility
  inputs. Animoto/Grid donor toasts are not alternate Job Center owners.

## Canonical route

1. Extend the Studio provider with one runner tied to its JobStore and dispose
   only provider-owned runners on unmount.
2. Add a header trigger with active/total badge. Open one right-side drawer at
   desktop and compact widths through the shared dialog/focus contract.
3. `JobCenter` renders empty, active and terminal entries; semantic progress,
   phase/message, attempt, status and safe details. It subscribes only through
   F7-03 selectors.
4. Cancel calls the shared runner. Retry renders only when a terminal is still
   actionable and an adapter supplied a real retry callback; no inert button.
5. A polite atomic live region announces aggregate activity/status changes;
   action failures use an alert without leaking unknown error detail.

## Proof route

- Component tests cover empty/running/progress/cancel/retry/consumed/error and
  action failure states with focus-safe controls.
- Shell tests cover trigger badge, Escape/restore and modal precedence.
- Production browser proof covers 1440x900 and 1024x768: open/close/focus,
  drawer fit, empty state readability, no overflow and no console errors.
- Typecheck, strict lint, accumulated UI/contract tests, build and independent
  review gate the slice.

