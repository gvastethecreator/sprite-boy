# UI/UX Design - SpriteBoy Studio

This document describes the design philosophy, style system, and interaction patterns that define the SpriteBoy Studio user experience.

## 1. Design Philosophy

- **Professional and Modern:** A clean, minimalist, high-tech aesthetic.
- **Reactive Identity:** The brand (logo) is not just static; it responds to user interaction with playful animations and global chromatic changes.
- **Content-Centered:** The workspace (canvas) is the protagonist.
- **Constant Feedback:** All key interactions have a clear visual and auditory response.

## 2. Design System and Styles

### 2.1. Dynamic Accent Colors

The accent color (`--accent-rgb`) can change dynamically. When rotating colors from the logo, the entire application transitions smoothly thanks to global transition rules on `:root`.

**Default Color:** Black (`0 0 0`) for a neutral, elegant aesthetic.

**Cycle Palette:**

1. Black (Base / Initial)
2. Blue
3. Purple
4. Pink
5. Red
6. Orange
7. Yellow
8. Green
9. Cyan

### 2.2. Brand Animations

- **Logo Pop:** A micro-interaction that uses `scale` and `rotate` to confirm the user's action when changing the color scheme. Accompanied by a temporary brightness boost (`brightness`).

... (rest of the document) ...
