# Product Requirements Document (PRD) - SpriteBoy Studio

## 1. Introduction and Vision

**SpriteBoy Studio** is a web application ("Single Page Application") designed for indie game developers and pixel artists. Its goal is to provide a unified, serverless workflow (local-first) for preparing graphical assets before importing them into game engines like Unity, Godot, or Phaser.

The vision is to eliminate the need for heavy desktop tools or complex Python scripts for common tasks such as slicing sprite sheets, creating basic animations, and defining collision boxes.

## 2. User Profile

- **Indie Game Developer:** Needs to iterate quickly, slice sprite sheets downloaded from the internet, and generate metadata (JSON) compatible with their engine.
- **Pixel Artist:** Needs to preview animations and clean up backgrounds of their creations without leaving the browser.

## 3. Application Modes (Core Features)

The application is structured around 4 distinct modes that operate over a shared project state.

### 3.1. BUILDER Mode (Composer)

- **Goal:** Create a new sprite sheet by combining multiple individual assets (manual packing).
- **Requirements:**
  - Output canvas size definition (e.g. 1024x1024).
  - **Asset Library:** Drag-and-drop area for external images or frames extracted from the Slicer.
  - **Grid System:** Slot system where assets can be placed.
  - Per-slot properties: Fit/Fill/Stretch, Flip X/Y, Offset, Rotation, Opacity.

### 3.2. SLICER (Auto-Slice inside the Builder workspace)

- **Goal:** Import a source image and define individual regions (frames).
- **Requirements:**
  - Image import (PNG, JPG, WEBP).
  - **Auto-Slice:** Algorithm to detect "islands" of non-transparent pixels automatically.
  - **Grid Slice:** Manual configuration of rows, columns, margins, and padding.
  - **Background Removal:** "Magic wand" tool (Chroma Key / Luma Key) to remove solid color backgrounds with adjustable tolerance.
  - Manual manipulation of frames (move, resize, create, delete).

### 3.3. ANIMATION Mode

- **Goal:** Create animation sequences using the frames defined in Slicer or Builder.
- **Requirements:**
  - Multi-animation management (Create, Rename, Duplicate, Delete).
  - **Timeline:** Drag & drop to reorder keyframes.
  - **Playback:** Play/Pause, adjustable FPS, Loop.
  - **Onion Skinning:** Semi-transparent rendering of the previous frame.
  - **Pivots:** Anchor point (Pivot X/Y) definition per frame.

### 3.4. COLLISION Mode

- **Goal:** Define physics and combat metadata.
- **Requirements:**
  - Creation of multiple boxes (Hitboxes) per frame.
  - Box types: Hitbox (Attack), Hurtbox (Damage), Collision (Physics), Trigger.
  - Tagging for game logic (e.g. "head", "body").
  - Productivity tools: Copy/Paste hitboxes between frames, horizontal flip.

## 4. Non-Functional Requirements

- **Performance:** Must maintain 60 FPS during canvas manipulation. Heavy rendering must not block the React UI.
- **Privacy:** All processing happens in the client's browser (`<canvas>`). No image is uploaded to a server.
- **Persistence:** Save and load projects in `.json` format (including Base64 images for portability).
- **Export:**
  - Image: Optimized PNG.
  - Data: Generic JSON, Phaser 3 format, Godot (Resource) format, ZIP of individual PNGs, GIF of animation sequences.

## 5. User Interface (UI/UX)

- **Theme:** Dark by default (Dark Mode) to reduce visual fatigue, with configurable accent.
- **Layout:** "IDE" style: Left Sidebar (Tools), Center (Canvas), Right Sidebar (Properties), Bottom (Timeline).
