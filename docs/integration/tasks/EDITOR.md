# Tareas Editor y release

Superficies propietarias: `features/compose/**`, `features/animate/**`, `features/collision/**`, `features/export/**`, `core/ai/**`, ports de export y primitives Studio compartidos. La interfaz y funcionalidad se replican de forma nativa: no se importa el shell, reducer o persistence root de Animoto.

## Compose, variants, timeline y Builder

| ID | Tipo | Dep. | Behaviors | Resultado individual | Prueba de cierre | Estado |
|---|---|---|---|---|---|---|
| A1-01 | J | F1-08,F2-07,F3-07,F5-06,F6-06 | A1.1-A1.2 | Create/open composition from Asset or Region | IT project graph | done |
| A1-02 | E | A1-01 | A1.3,A2.1-A2.2 | Project menu and empty/bootstrap Compose UI | BR+A11Y + REV | active |
| A1-03 | J | A1-01 | A1.4 | Composition dimensions/aspect/background workflow | RT+BR J1/J3 | active |
| A1-04 | J | A1-02,A1-03 | A1.1-A1.4,A2.1-A2.2 | Portable first-composition acceptance | Package RT+REV | todo |
| A2-01 | J | A1-04 | A2.3-A2.4 | Layer add/remove/duplicate commands | UT+undo | todo |
| A2-02 | J | A2-01 | A2.5-A2.7 | Sync/reorder and stable layer identity | Identity stress UT | todo |
| A2-03 | J | A2-01 | A2.8 | Visibility/opacity command and projection | UT+VIS | todo |
| A2-04 | E | A2-02,A2-03 | A2.3-A2.8 | Layers panel, DnD and inline controls | BR+A11Y + REV | todo |
| A2-05 | J | A2-04 | A2.3-A2.8 | Layer undo/reload/render-count gate | BR+RT+PERF+REV | todo |
| A3-01 | J | A2-05,F5-06 | A2.9,A3.1-A3.2 | Selection overlay and transform gizmo pointer model | Pointer/DPR UT | todo |
| A3-02 | J | A3-01 | A2.9,A3.3-A3.5 | Translate/scale/rotate/flip with transaction coalescing | UT drag→one undo | todo |
| A3-03 | E | A3-02 | A2.10,A3.6-A3.7 | Numeric transform and quick-action controls | BR+A11Y + REV | todo |
| A3-04 | J | A3-02 | A3.8 | Snap guides and precision modifiers | Geometry+VIS | todo |
| A3-05 | J | A3-03,A3-04 | A2.9-A2.10,A3.1-A3.8 | Pointer/keyboard/DPR/render parity gate | BR J3+REV | todo |
| A4-01 | J | A2-05,A3-05 | A2.11,A5.1 | VariantSet create/activate command semantics | UT+graph invariants | todo |
| A4-02 | J | A4-01 | A5.2-A5.3 | Replace/remove variant and cache invalidation | UT+VIS | todo |
| A4-03 | E | A4-02 | A5.1-A5.3 | A/B/C/D controls and active-state UI | BR+A11Y + REV | todo |
| A4-04 | J | A4-03 | A2.11,A5.1-A5.3 | Reload/thumbnail/export visual-match gate | RT+VIS+REV | todo |
| A5-01 | J | A1-04,A4-04,F4-06,F6-06 | A4.1-A4.3 | Sequence create/delete and cel add/remove commands | UT+undo | todo |
| A5-02 | J | A5-01 | A4.4-A4.6 | Cel duplicate/reorder/swap stable-identity semantics | Identity stress UT | todo |
| A5-03 | J | A5-02 | A4.7-A4.9 | Multi-select/batch prompt/lock commands | UT transaction matrix | todo |
| A5-04 | J | A5-01 | A4.10-A4.11 | User keyframe import/center as one composition | IT blob+graph+undo | todo |
| A5-05 | E | A5-03,A5-04 | A4.1-A4.11,H5.1-H5.3 | Timeline, DnD, selection, prompt, lock and upload UI | BR+A11Y + REV | todo |
| A5-06 | J | A5-05 | A4.1-A4.11,H5.1-H5.3 | Timeline reload/identity/keyboard gate | BR J4+RT+REV | todo |
| B1-01 | J | A1-04,A3-05,F1-08,F5-06 | H3.1-H3.3 | Builder grid/free composition model and geometry contract | ADR addendum+UT | todo |
| B1-02 | J | B1-01 | H3.4-H3.6 | Slot layer fit/alignment/clip/full transform semantics | VIS geometry goldens | todo |
| B1-03 | J | B1-01 | H3.7-H3.9 | Free object commands, z-order and transforms | UT+VIS+undo | todo |
| B1-04 | E | B1-02,B1-03 | H3.1-H3.9 | Builder superset controls and canvas UI | BR+A11Y + REV | todo |
| B1-05 | J | B1-04,F3-07 | H3.10 | Legacy Builder migration with ambiguous/missing asset report | MIG+RT | todo |
| B1-06 | J | B1-04,B1-05 | H3.1-H3.10 | Builder J3 visual/reload/export gate | BR+VIS+REV | todo |
| I1-01 | J | G6-05,A1-04 | G6.6-G6.9 | Slice Region/Asset→Compose intent and command adapter | IT no reimport | todo |
| I1-02 | J | I1-01,A5-06 | G6.6-G6.9 | Multi-result→Sequence adapter preserving recipe provenance | IT+RT | todo |
| I1-03 | J | I1-02 | G6.6-G6.9 | J2→J3 seamless handoff journey | BR+REV | todo |

## Playback, AI y edición avanzada

| ID | Tipo | Dep. | Behaviors | Resultado individual | Prueba de cierre | Estado |
|---|---|---|---|---|---|---|
| A6-01 | J | A5-06,F5-06 | A6.1-A6.3,H5.4 | Playback clock, FPS, loop and scrub state machine | Fake-clock UT | todo |
| A6-02 | J | A6-01 | A6.4 | Hidden-tab/catch-up and idle scheduling policy | Timing+PERF UT | todo |
| A6-03 | J | A6-01,F5-06 | A6.5,H5.5 | Onion-skin projection without document mutation | VIS+UT | todo |
| A6-04 | E | A6-02,A6-03 | A6.1-A6.6,H5.4-H5.5 | Player/scrub/loop/pin/onion UI | BR+A11Y + REV | todo |
| A6-05 | J | A6-04 | A6.1-A6.6,H5.4-H5.5 | Timing/idle/export-isolation gate | BR J4+PERF+REV | todo |
| A7-01 | J | A1-04,A4-04,A5-06,A6-05,F7-07 | A7.1,H2.1-H2.2 | Provider-neutral AI request/response/error/redaction port | Contract+SEC UT | todo |
| A7-02 | J | A7-01 | A7.2-A7.4,H2.3-H2.5 | Prompt/plan/context/analyze domain contracts | Fake-provider UT | todo |
| A7-03 | J | A7-02 | H2.6-H2.8 | Host model/mode/reference-image routing without secret persistence | Routing+SEC UT | todo |
| A7-04 | E | A7-02,A7-03 | A7.1-A7.4,H2.1-H2.8 | Generation Inspector controls and context UI | BR+A11Y + REV | todo |
| A7-05 | J | A7-01,F7-07 | A7.9-A7.10 | Cost/progress/cancel/error mapping into Job Center | IT fake-provider lifecycle | todo |
| A7-06 | J | A7-04,A7-05 | A7.1-A7.4,A7.9-A7.10,H2.1-H2.8 | Redaction/cost/cancel/provider-failure gate | SEC+BR J5+REV | todo |
| A8-01 | J | A7-06 | A7.5-A7.6 | Sequential/recursive generation DAG and count limits | Graph/property UT | todo |
| A8-02 | J | A8-01 | A7.7 | Lock/pin/neighbor constraints in generation plan | UT edge matrix | todo |
| A8-03 | J | A8-02 | A7.8 | Draft result and atomic accept/reject commands | IT+undo | todo |
| A8-04 | J | A8-03 | A7.5-A7.10 | Partial failure/cancel/retry without late writes | IT hostile job matrix | todo |
| A8-05 | J | A8-04 | A7.5-A7.10 | Audit/provenance/cost and J5 acceptance | BR+SEC+REV | todo |
| A9-01 | J | A8-05 | A8.1 | Regenerate selection as draft, preserving locks | IT+undo | todo |
| A9-02 | J | A9-01 | A7.8 | Fill-missing planning and neighbor context policy | UT sparse sequence | todo |
| A9-03 | E | A9-02 | A8.1 | Correction/regenerate/fill review UI | BR+A11Y + REV | todo |
| A9-04 | J | A9-03 | A7.8,A8.1 | Partial-failure/provenance/reload gate | BR J5+RT+REV | todo |
| A10-01 | J | A3-05,A5-06 | A8.2 | Alignment session model, cancel/apply and reference policy | ADR addendum+UT | todo |
| A10-02 | J | A10-01,F5-06 | A8.2 | Pan/zoom/reset/reference overlay and transform preview | Pointer/DPR+VIS | todo |
| A10-03 | E | A10-02 | A8.2 | Alignment modal controls and keyboard flow | BR+A11Y + REV | todo |
| A10-04 | J | A10-03 | A8.2 | Apply/undo/reload/export visual-match gate | BR J6+VIS+REV | todo |

## Export, host parity, cuarentena y release

| ID | Tipo | Dep. | Behaviors | Resultado individual | Prueba de cierre | Estado |
|---|---|---|---|---|---|---|
| A11-01 | J | A4-04,A6-05,F7-07,G7-04 | H1.1 | Canonical PNG snapshot/grid-toggle exporter | ART dimensions/pixels | todo |
| A11-02 | J | A11-01 | H1.2-H1.3,A9.1-A9.2 | ZIP/GIF exporters with alpha/timing/count parity | ART decode | todo |
| A11-03 | J | A11-01 | H1.4-H1.6 | Generic/Phaser/Godot metadata exporters | Schema fixture ART | todo |
| A11-04 | J | A11-02 | A9.3-A9.5 | MP4/WebM codec port and capability fallback | Browser codec matrix+ART | todo |
| A11-05 | E | A11-02,A11-03,A11-04 | A9.1-A9.5,H1.1-H1.6 | Export Center format/options/progress/cancel UI | BR+A11Y + REV | todo |
| A11-06 | J | A11-05 | A9.1-A9.5,H1.1-H1.6 | Cancel/quota/codec-failure/retry artifact gate | Hostile BR+ART | todo |
| A11-07 | J | A11-06 | A9.1-A9.5,H1.1-H1.6 | J7 cross-format decode and compositor parity | Full ART+VIS+REV | todo |
| A12-01 | J | A1-04,A11-07,B1-06 | A3.8,A10.2,H6.1-H6.3 | Unified shortcut registry, precedence and help data | Keyboard UT | todo |
| A12-02 | E | A12-01,F6-04 | A10.3-A10.4,H6.4 | Sound/toast/loading/feedback primitives | BR+A11Y + REV | todo |
| A12-03 | J | F3-07 | H6.5-H6.6 | Preferences codec/migration/reset and durable workspace subset | RT+MIG | todo |
| A12-04 | E | A12-02,A12-03 | A3.8,A10.1-A10.4,H6.1-H6.8 | Responsive/compact panels, Settings, Help and command palette | BR+A11Y + REV | todo |
| A12-05 | J | A12-04 | A1-A10,H6 | Legacy donor shell/store/persistence import audit and removal | `rg` no forbidden roots | todo |
| A12-06 | J | A12-05 | A1-A10,H6 | J9 responsive/a11y/no-warning/full editor parity gate | BR+PERF+REV | todo |
| C1-01 | J | F1-08,F5-06,F6-06,A5-06 | H5.6-H5.7 | Stable CollisionSet owner and rectangle shape commands | UT graph+undo | todo |
| C1-02 | J | C1-01 | H5.6-H5.7 | Collision workspace reachability and selection flow | BR navigation | todo |
| C1-03 | E | C1-02 | H5.6-H5.7 | Create/edit/tag/delete collision UI and overlay | BR+A11Y+VIS + REV | todo |
| C1-04 | J | C1-03,A11-07 | H5.6-H5.7 | Collision save/reload/export metadata | RT+ART | todo |
| C1-05 | J | C1-04 | H5.6-H5.7 | J6 collision/alignment acceptance | BR+REV | todo |
| X1-01 | J | G8-05,A12-06,C1-05 | H1-H6 | Consumer inventory proves canonical engine is default | `rg`+runtime trace | todo |
| X1-02 | J | X1-01 | H1-H6 | Legacy project/controller/persistence behind isolated rollback flag | IT flag matrix | todo |
| X1-03 | J | X1-02 | H1-H6 | Legacy read-only fallback smoke and no mixed consumers | BR+MIG | todo |
| X1-04 | J | X1-03 | 159 outcomes | Quarantine/removal manifest and W6 acceptance | Full parity+REV | todo |
| R1-01 | J | F8-06,G8-05,A12-06,C1-05,X1-04 | 159 outcomes | Release-candidate migration preview, backup and rollback | MIG J8 | todo |
| R1-02 | J | R1-01 | 159 outcomes | Full gate manifest, flags and local diagnostic report | All required gates | todo |
| R1-03 | J | R1-02 | 159 outcomes | Release review and explicit blocker/ship verdict | Independent REV | todo |
| R2-01 | J | R1-03 + soak | 159 outcomes | Soak evidence and physical legacy fallback deletion | Full regression+MIG | todo |
| R2-02 | J | R2-01 | 159 outcomes | Flags/adapters/docs cleanup; canonical path only | `rg`+build+BR+REV | todo |
