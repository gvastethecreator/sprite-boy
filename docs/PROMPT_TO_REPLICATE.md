# Prompt para Replicar SpriteSlice Studio

_Este documento contiene un prompt diseñado para ser introducido en un LLM (como Gemini, GPT-4 o Claude 3.5 Sonnet) para recrear la estructura y lógica fundamental de SpriteSlice Studio._

---

**PROMPT:**

Actúa como un Arquitecto de Software experto en React y Gráficos Web. Tu tarea es generar el código fuente para una aplicación web llamada "SpriteSlice Studio".

**Contexto del Proyecto:**
Una herramienta "Local-First" para desarrolladores de juegos que permite manipular spritesheets. La aplicación no usa backend, todo ocurre en el navegador.

**Stack Tecnológico:**

- React 19 (Functional Components, Hooks).
- TypeScript (Tipado estricto).
- Tailwind CSS (Estilizado).
- HTML5 Canvas API (Para el renderizado del área de trabajo).
- Lucide React (Iconos).

**Requisitos Arquitectónicos Clave:**

1.  **Separación Render/Estado:** Debes implementar una clase estática `CanvasRenderer` que reciba un objeto de contexto (estado, imágenes, configuración) y dibuje en un contexto 2D. El componente React `CanvasArea` solo debe manejar eventos y llamar a este renderizador dentro de un `requestAnimationFrame` o `useEffect`.
2.  **Gestión de Estado Centralizada:** Crea un hook `useProjectController` que maneje toda la lógica de negocio (CRUD de frames, animaciones, assets).
3.  **Historial:** Implementa un hook `useUndo` que maneje el historial (past, present, future) para permitir Ctrl+Z/Ctrl+Y.
4.  **Modelo de Datos:**
    - `AppMode`: ENUM ('SLICER', 'BUILDER', 'ANIMATION', 'COLLISION').
    - `FrameData`: { x, y, w, h, hitboxes: [] }.
    - `SpriteAnimation`: { id, name, fps, keyframes: [] }.
    - `HitboxData`: { x, y, w, h, type: 'HIT'|'HURT'|'COLLISION' }.

**Funcionalidades a Implementar:**

1.  **Modo Slicer:** Cargar una imagen y dibujar rectángulos (frames) sobre ella. Implementar lógica de selección y arrastre de estos rectángulos en el canvas.
2.  **Modo Animation:** Una línea de tiempo que permita secuenciar los frames creados. Debe tener reproducción (loop) y visualización de Onion Skin (frame anterior semitransparente).
3.  **Modo Collision:** Permitir dibujar rectángulos hijos (hitboxes) dentro de un frame seleccionado.
4.  **Algoritmos:** Incluye una función `detectSprites` que use un algoritmo simple de escaneo de píxeles para encontrar bounding boxes no transparentes automáticamente.
5.  **Exportación:** Generar un JSON genérico con la estructura de la animación y los frames.

**Estructura de Archivos Sugerida:**

- `types.ts`: Interfaces.
- `utils/renderUtils.ts`: La clase `CanvasRenderer`.
- `hooks/useProjectController.ts`: Lógica de estado.
- `components/CanvasArea.tsx`: Wrapper del canvas.
- `components/Timeline.tsx`: UI de la línea de tiempo.
- `App.tsx`: Layout principal.

Por favor, genera el código esencial para `types.ts`, `renderUtils.ts` y `useProjectController.ts` enfocándote en la lógica de renderizado performante y la estructura de datos.
