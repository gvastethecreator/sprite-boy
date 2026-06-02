# Technical Architecture - SpriteBoy Studio

This document describes the engineering decisions, design patterns, and data flow of the application.

## 1. Stack Overview

| Layer            | Tool                          | Version |
| ---------------- | ----------------------------- | ------- |
| UI Framework     | React                         | 19.2    |
| Language         | TypeScript                    | 5.8     |
| Bundler          | Vite (Rolldown)               | 8.x     |
| Styling          | Tailwind CSS                  | 4.x     |
| Animation        | GSAP + CSS keyframes          | 3.12    |
| Testing          | Vitest + Testing Library      | 4.x     |
| Linting          | OXC (oxlint)                  | 1.x     |
| Package Manager  | Bun                           | 1.x     |
| Rendering        | HTML5 Canvas API (Imperative) | -       |
| Persistence      | IndexedDB                     | -       |
| AI               | Google GenAI (Gemini/Imagen)  | -       |

## 2. Design Pattern: React UI + Canvas Engine

To achieve high performance, the application decouples the React render cycle from the Canvas render cycle.

### 2.1. The Problem

Rendering heavy images, guides, hitboxes, and animations at 60 FPS through React components (DOM) is inefficient and causes jank.

### 2.2. The Solution: `CanvasRenderer` (Static Class)

A utility class (`utils/renderUtils.ts`) acts as a "stateless" rendering engine.

- **Render Loop:** `useProjectController` runs a `requestAnimationFrame` loop.
- **Render Context:** On every frame, a complete `RenderContext` object (containing all relevant state: frames, images, configuration, mouse) is passed to the static `CanvasRenderer.render()` method.
- **Advantage:** React only manages inputs and layout structure. The canvas redraws imperatively, allowing complex operations (zoom, pan, pixel grid, onion skin) without virtual DOM reconciliation.

## 3. State Management

### 3.1. `useProjectController`

The "brain" of the application.

- Centralizes all business logic.
- Exposes methods to modify state (actions).
- Manages side effects (timers, image loading).
- Bridges UI components and global state.

### 3.2. `useUndo`

A generic hook that wraps the project state (`ProjectState`).

- Implements a simple _Memento_ pattern (Past, Present, Future).
- Supports "ephemeral" updates (`setEphemeral`) for high-frequency actions (such as dragging a frame) that should not generate undo history until the action ends (`onMouseUp`).

## 4. Data Model (`types/`)

The data model is designed to be JSON-serializable.

- **`ImageMeta`**: Reference to the source image. Uses a `Blob URL` (`blob:http://...`) to keep images in browser memory without duplicating data in Base64 until save time.
- **`FrameData`**: Coordinates `{x, y, w, h}` relative to the source image. Contains an array of `HitboxData`.
- **`SpriteAnimation`**: List of `Keyframe`. A `Keyframe` references a `FrameData` by index and adds animation metadata (pivot).
- **`BuilderSlots`**: A hash map for Builder mode, linking logical grid cells with `Assets` from the library.

## 5. Key Algorithms

### 5.1. Sprite Detection (`detectSprites` in `algorithms.ts`)

- Uses a **Breadth-First Search (BFS)** or "Flood Fill" algorithm.
- Analyzes the `ImageData` of the canvas to find islands of non-transparent pixels.
- Optimization: "Yields" control to the main thread every few rows to avoid freezing the UI when processing large images.

### 5.2. Background Removal (`removeBackground`)

- Implements **Chroma Key** logic in the HSL color space.
- Calculates color distance between the pixel and the target color.
- Applies feathering on edges to avoid hard (aliased) borders.
- Automatically detects whether to use Luma Key (for grays) or Chroma Key (for colors).

## 6. Data Flow

1. **Input:** User interacts (Click, Keyboard, Drag).
2. **Controller:** `useProjectController` receives the event.
3. **Logic:** State is updated (e.g. move a frame).
4. **React Render:** React detects state change and updates the DOM (numeric inputs, layer list).
5. **Canvas Render:** A `useEffect` in `CanvasArea` or the animation loop detects the change and calls `CanvasRenderer.render()`.
6. **Paint:** The HTML5 canvas updates visually.
