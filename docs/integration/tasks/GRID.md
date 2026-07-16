# Tareas Grid y Slice

Superficie propietaria: `features/slice/**`, adapters `core/processing/**`, results commit commands y tests relacionados. Todo comportamiento replica capacidades donantes dentro del workspace Slice; no monta el shell/store de Grid Splitter.

## Source session y worker

| ID | Tipo | Dep. | Behaviors | Resultado individual | Prueba de cierre | Estado |
|---|---|---|---|---|---|---|
| G0-01 | J | F2-07,F6-06,F7-07 | G1.1-G1.3 | Source-session state machine pick/drop/validate/decode | UT file/type/size/decode matrix | done |
| G0-02 | E | G0-01 | G1.1-G1.3 | Dropzone/file-picker UI nativa Studio | BR+A11Y + REV | done |
| G0-03 | J | G0-01,F5-06 | G1.4-G1.5 | Preview, dimensions/size metadata y URL lease | BR + no URL leak | done |
| G0-04 | E | G0-03 | G1.6 | Replace/reset source con confirmación y cleanup | BR + REV | done |
| G0-05 | J | G0-02,G0-04 | G1.1-G1.6 | Error/focus/retry gate de source session | Hostile BR+A11Y | done |
| G1-01 | J | F2-07,F7-07 | G2-G5,G6.1-G6.3 | Protocol requestId/progress/result/error/cancel versionado | Contract UT | done |
| G1-02 | E | G1-01 | G2-G5 | Port mecánico de helpers algorítmicos donantes puros | Golden UT + REV | done |
| G1-03 | J | G1-02 | G2-G5 | Worker real y adapter JobRunner | IT real worker | done |
| G1-04 | J | G1-03 | G6.1-G6.3 | Concurrent/cancel/crash/timeout/late-response handling | IT hostile matrix | done |
| G1-05 | J | G1-04 | G2-G5 | Manifest golden y baseline algorítmico congelado | Hash/geometry evidence + REV | done |

## Pipeline Grid

| ID | Tipo | Dep. | Behaviors | Resultado individual | Prueba de cierre | Estado |
|---|---|---|---|---|---|---|
| G2-01 | J | G0-05,G1-05 | G2.1-G2.3 | Parámetros auto/manual rows/cols y validation | UT boundary matrix | done |
| G2-02 | J | G2-01 | G2.2-G2.5 | Energy profile, segment detection y grid inference | Golden/property UT | done |
| G2-03 | E | G2-02,F5-06 | G2.1-G2.5 | Grid controls y detected-feedback UI | BR+A11Y + REV | done |
| G2-04 | J | G2-02,F5-06 | G2.6 | Overlay geometry DPR/zoom/resize-safe | VIS + geometry UT | done |
| G2-05 | J | G2-03,G2-04 | G2.1-G2.6 | Manual/auto switching and deterministic recipe state | BR+RT | done |
| G3-01 | J | G2-05 | G3.1-G3.2 | Threshold/padding trim stage | Pixel golden UT | done |
| G3-02 | J | G3-01 | G3.3-G3.4 | Reduction and empty/transparent cell policy | Edge fixture UT | done |
| G3-03 | E | G3-02 | G3.1-G3.4 | Crop controls, preview summary y reset | BR+A11Y + REV | done |
| G3-04 | J | G3-03 | G3.1-G3.4 | OOB/zero-size/huge-padding hostile gate | Property UT + REV | done |
| G4-01 | J | G1-05,G3-04 | G4.1-G4.4 | Chroma color/tolerance/smoothness/spill stage | VIS alpha/color goldens | done |
| G4-02 | J | G4-01,F5-06 | G4.5 | DPR-correct eyedropper sampling | Pixel coordinate UT+BR | done |
| G4-03 | E | G4-02 | G4.1-G4.6 | Chroma controls, swatch and eyedropper UI | A11Y+BR + REV | done |
| G4-04 | J | G4-01,G3-04 | G4.7 | Chroma→crop ordering and recipe determinism | RT+VIS | done |
| G4-05 | J | G4-03,G4-04 | G4.1-G4.7 | Transparent/no-match/extreme tolerance gate | Hostile VIS+REV | done |
| G5-01 | J | G3-04,G4-05 | G5.1-G5.3 | Pixel resize/snapping stage | Pixel/hash UT | done |
| G5-02 | J | G5-01 | G5.4-G5.6 | Palette quantization count + auto/fixed modes | Determinism/membership UT | active |
| G5-03 | E | G5-02 | G1.7,G5.7-G5.8 | Palette extraction/presets/control UI | BR+A11Y + REV | todo |
| G5-04 | J | G5-02 | G5.1-G5.8 | Large-image and palette performance budget | PERF artifact | todo |
| G5-05 | J | G5-03,G5-04 | G5.1-G5.8 | Pipeline ordering, reset and recipe round-trip | RT+VIS+REV | todo |

## Results, irregular parity y hardening

| ID | Tipo | Dep. | Behaviors | Resultado individual | Prueba de cierre | Estado |
|---|---|---|---|---|---|---|
| G6-01 | J | G2-05,G3-04,G4-05,G5-05,F1-08,F3-07 | G6.1-G6.3 | Staged results model and process summary | UT state/result contract | todo |
| G6-02 | E | G6-01 | G6.1-G6.3 | Results tray/status/tips UI | BR+A11Y + REV | todo |
| G6-03 | J | G6-01 | G6.6-G6.8 | Atomic commit recipe+Regions+optional Assets | IT commit/rollback/undo | todo |
| G6-04 | J | G6-03 | G6.9 | Reload and provenance reconstruction | RT save/reload | todo |
| G6-05 | J | G6-02,G6-04 | G6.1-G6.3,G6.6-G6.9 | Process-save-reload-undo journey | BR J2 + REV | todo |
| G7-01 | J | G6-05,F7-07 | G6.4 | Download-one through ExportPort | ART decode | todo |
| G7-02 | E | G7-01 | G6.5 | Download-all package + manifest | ART + REV | todo |
| G7-03 | J | G6-05 | G6.6-G6.9 | Open committed output in Compose/Animate intent | IT handoff contract | todo |
| G7-04 | J | G7-02,G7-03 | G6.4-G6.9,G7.7 | Export shortcut, cancel/error and artifact gate | BR+ART+A11Y+REV | todo |
| S1-01 | J | F1-08,F7-07,G0-05 | H4.1-H4.3 | Connected-components/irregular region detection adapter | Golden/property UT | done |
| S1-02 | J | S1-01,F5-06 | H4.4 | Wand select and add/remove region semantics | BR+VIS | done |
| S1-03 | J | S1-01 | H4.5-H4.6 | Manual create/move/resize/delete Region commands | UT+undo | done |
| S1-04 | E | S1-02,S1-03 | H4.1-H4.6 | Irregular/manual Slice tools UI | BR+A11Y + REV | active |
| S1-05 | J | S1-03,F2-07 | H4.7-H4.8 | Region-to-asset and margins/gaps preservation | IT+VIS+RT | done |
| S1-06 | J | S1-04,S1-05 | H4.1-H4.8 | Irregular journey with undo/save/export | BR J2 irregular + REV | todo |
| G8-01 | J | G0-05,G7-04,S1-06 | G7.1-G7.5 | Unified Slice keyboard/focus/toast/error boundary | A11Y+BR | todo |
| G8-02 | J | G8-01 | G7.6 | Escape cancellation precedence across tools/jobs/modals | Keyboard integration UT | todo |
| G8-03 | J | G8-02 | G1-G7,H4 | Console/leak/repeated-run resilience sweep | BR+PERF | todo |
| G8-04 | J | G8-03 | G1-G7,H4 | Legacy slicer fallback-only adapter and consumer audit | `rg`+IT fallback | todo |
| G8-05 | J | G8-04 | G1-G7,H4 | Full Grid/host parity matrix and W3 acceptance | 56 behaviors evidence + REV | todo |
