# 👹 SpriteBoy Studio

A web-based sprite sheet editor, animation sequencer, and sprite composition tool built with React 19 and Canvas 2D.

## Features

- **Builder Mode** – Compose sprite sheets by placing assets on a grid or freeform canvas
- **Slicer Tools** – Auto-detect sprites via BFS, dynamic manual grids with canvas divider resizing, and background removal (chroma/luma key)
- **Animation Editor** – Keyframe-based sequencer with real-time preview, onion skinning, and dual-view playback
- **Collision Editor** – Define hitboxes (hurtbox, hitbox, solid, trigger) per frame
- **Export** – PNG, spritesheet ZIP, GIF, and code export (JSON, Phaser 3, Godot)
- **Persistent Storage** – IndexedDB-backed asset library with default SVG assets

## Tech Stack

| Layer           | Tool                                |
| --------------- | ----------------------------------- |
| Runtime         | React 19 + TypeScript 7             |
| Bundler         | Vite 8 (Rolldown)                   |
| Styling         | Tailwind CSS 4 (design-token based) |
| Animation       | GSAP 3, CSS keyframes               |
| Testing         | Vitest 4 + Testing Library          |
| Linting         | OXC (oxlint)                        |
| Package Manager | Bun 1.3.14                          |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) 1.3.14
- Node.js 24+

### Install

```bash
bun install --frozen-lockfile --ignore-scripts
```

### Development

```bash
bun run dev        # Start dev server at http://localhost:3000
```

### Build

```bash
bun run build      # Production build → dist/
bun run preview    # Preview production build
```

### Testing

```bash
bun run test            # Run tests once
bun run test:watch      # Watch mode
bun run test:coverage   # Coverage report
```

### Linting & Type Checking

```bash
bun run lint        # OXC linter
bun run lint:fix    # Auto-fix lint issues
bun run typecheck   # TypeScript type check
bun run check       # Both typecheck + lint
```

### Studio quality gates

```bash
bun scripts/studio-gates.mjs --gate reproducibility
bun scripts/studio-gates.mjs --gate all
bun scripts/studio-gates.mjs --gate e2e
```

The tracked `bun.lock` is authoritative. CI rejects manifest/lock drift, high or
critical dependency advisories, and any failing Studio gate.

### Logging

All scripts have `:log` variants that save output to `logs/`:

```bash
bun run build:log   # → logs/build.log
bun run test:log    # → logs/test.log
bun run lint:log    # → logs/lint.log
```

## Dual stack (short)

The app runs **two** project stacks during migration:

1. **Canonical** (`core/`, `features/`, `CanonicalProjectProvider`) — durable Studio V1 graph, package codec, jobs, Slice/Compose.
2. **Legacy host** (`useProjectController`, `ProjectContext`, `utils/*` bridges) — builder/slicer/animation panels still on `FrameData`. **Do not grow durable logic here** (see `AGENTS.md`).

Workspaces: Slice · Compose · Animate · Collision · Export (hash navigation via `core/studio/workspaceRegistry`).

## Project Structure

```
├── index.html / index.tsx / index.css
├── App.tsx                 # StudioLocalStores → CanonicalProject → ProjectProvider → AppLayout
├── AGENTS.md               # Agent/human dual-stack map + commands
├── core/                   # Project engine, stores, persistence, render, export, processing
├── features/
│   ├── slice/              # Source session, grid pipeline, irregular tools, grid export
│   ├── compose/            # Composition bootstrap + canvas settings
│   └── collision/          # Canonical collision surface (in progress)
├── components/
│   ├── layout/             # AppLayout, sidebars, timeline panel
│   ├── canvas/             # CanvasArea, toolbar, status
│   ├── studio/             # StudioHeader, JobCenter, dialogs, workspace chrome
│   ├── overlays/           # Export, Settings, Help, palette, toasts
│   ├── panels/             # Left/right inspectors
│   └── common/             # Shared controls
├── contexts/               # CanonicalProject, StudioStore, legacy Project
├── hooks/                  # Legacy controller + canvas hooks (freeze durable growth)
├── types/                  # Legacy host types + enums
├── utils/                  # Legacy algorithms, renderUtils, db, exportFormats
├── tests/                  # Vitest contract/hooks/components/integration
├── scripts/                # studio-gates and quality smoke
└── docs/                   # ADRs under architecture/; integration ledger under integration/
```

## VS Code Tasks

Open the Command Palette (`Ctrl+Shift+P`) → **Tasks: Run Task** to access:

| Task             | Description               |
| ---------------- | ------------------------- |
| 🚀 Dev Server    | Start Vite dev server     |
| 📦 Build         | Production build with log |
| 🔍 Lint          | Run oxlint with log       |
| 🧪 Test          | Run vitest with log       |
| 📊 Test Coverage | Coverage report           |
| ✅ Typecheck     | TypeScript check          |
| 🔎 Full Check    | Typecheck + lint          |
| 👁️ Preview       | Preview production build  |
| 🧹 Clean         | Remove dist & logs        |

## License

Released under the [MIT License](./LICENSE). See the file for the full text.
