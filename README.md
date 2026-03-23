# 👹 SpriteBoy Studio

A web-based sprite sheet editor, animation sequencer, and sprite composition tool built with React 19 and Canvas 2D.

## Features

- **Builder Mode** – Compose sprite sheets by placing assets on a grid or freeform canvas
- **Slicer Tools** – Auto-detect sprites via BFS, grid-based slicing, background removal (chroma/luma key)
- **Animation Editor** – Keyframe-based sequencer with real-time preview, onion skinning, and dual-view playback
- **Collision Editor** – Define hitboxes (hurtbox, hitbox, solid, trigger) per frame
- **AI Generation** – Gemini 3 Pro/Flash + Imagen 4 integration for sprite generation and variation
- **Export** – PNG, spritesheet ZIP, GIF, and code export (JSON, Phaser 3, Godot)
- **Persistent Storage** – IndexedDB-backed asset library with default SVG assets

## Tech Stack

| Layer | Tool |
|---|---|
| Runtime | React 19 + TypeScript 5.8 |
| Bundler | Vite 8 (Rolldown) |
| Styling | Tailwind CSS 4 (design-token based) |
| Animation | GSAP 3, CSS keyframes |
| Testing | Vitest 4 + Testing Library |
| Linting | OXC (oxlint) |
| Package Manager | Bun |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (v1.1+)
- Node.js 22+ (for Vite compatibility)

### Install

```bash
bun install
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

### Logging

All scripts have `:log` variants that save output to `logs/`:

```bash
bun run build:log   # → logs/build.log
bun run test:log    # → logs/test.log
bun run lint:log    # → logs/lint.log
```

## Project Structure

```
├── index.html              # Entry HTML
├── index.tsx               # React root mount
├── index.css               # Tailwind v4 theme + custom utilities
├── App.tsx                 # App shell (ProjectProvider → AppLayout)
├── vite.config.ts          # Vite 8 + React + Tailwind config
├── vitest.config.ts        # Vitest test runner config
├── .oxlintrc.json          # OXC linter rules
├── components/
│   ├── AppLayout.tsx       # Master layout, modals, resizable timeline
│   ├── Header.tsx          # Brand, file/edit menus, mode tabs
│   ├── CanvasArea.tsx      # Canvas rendering + interaction logic
│   ├── LeftSidebar.tsx     # Mode-dependent tool panels
│   ├── RightSidebar.tsx    # Inspector (frame, animation, slot props)
│   ├── Timeline.tsx        # Keyframe sequencer with drag & drop
│   ├── common/             # Shared UI primitives
│   └── panels/             # Left/right sidebar panel implementations
├── contexts/
│   └── ProjectContext.tsx   # Global state provider
├── hooks/
│   ├── useProjectController.ts  # Central state orchestrator
│   ├── useUIController.ts       # Toast, modal, viewport state
│   ├── useUndo.ts               # 50-step undo/redo history
│   ├── useKeyboardShortcuts.ts  # Global keyboard handlers
│   └── domains/
│       ├── useAnimationLogic.ts # Animation CRUD + playback
│       ├── useBuilderLogic.ts   # Asset/slot management + AI
│       └── useSlicerLogic.ts    # Grid slicing + sprite detection
├── types/
│   ├── core.ts             # Domain models (Frame, Animation, etc.)
│   ├── enums.ts            # AppMode, HitboxType, DragMode
│   ├── config.ts           # GridConfig, UserPreferences
│   └── ui.ts               # Viewport, sidebar, modal types
├── utils/
│   ├── algorithms.ts       # Grid generation, sprite detection, BG removal
│   ├── renderUtils.ts      # CanvasRenderer static class
│   ├── canvasMath.ts       # Resize handles, snapping, grid math
│   ├── aiService.ts        # Gemini/Imagen API wrapper
│   ├── exportFormats.ts    # JSON/Phaser/Godot exporters
│   ├── db.ts               # IndexedDB persistence
│   ├── uiFeedback.ts       # Synthesized audio feedback
│   ├── imageWorker.ts      # Web Worker for pixel operations
│   └── defaultAssets.ts    # Inline SVG placeholder assets
├── tests/                  # Vitest test suites
├── scripts/                # Build/log utilities
├── docs/                   # Architecture & design documentation
└── .vscode/tasks.json      # VS Code task definitions
```

## Environment Variables

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio API key for generation features |

Create a `.env` file at the project root:

```env
GEMINI_API_KEY=your_api_key_here
```

## VS Code Tasks

Open the Command Palette (`Ctrl+Shift+P`) → **Tasks: Run Task** to access:

| Task | Description |
|---|---|
| 🚀 Dev Server | Start Vite dev server |
| 📦 Build | Production build with log |
| 🔍 Lint | Run oxlint with log |
| 🧪 Test | Run vitest with log |
| 📊 Test Coverage | Coverage report |
| ✅ Typecheck | TypeScript check |
| 🔎 Full Check | Typecheck + lint |
| 👁️ Preview | Preview production build |
| 🧹 Clean | Remove dist & logs |

## License

Private – All rights reserved.
