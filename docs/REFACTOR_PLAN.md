
# 🏗 Plan de Refactorización y Modularización - SpriteSlice Studio

## 1. Análisis del Estado Actual

Tras revisar la base de código, se han identificado los siguientes puntos críticos que afectan la mantenibilidad y escalabilidad:

### A. Componentes Monolíticos ("God Components")
1.  **`RightSidebar.tsx`**: Contiene múltiples sub-componentes definidos internamente (`GenerationPanel`, `FrameProperties`, `AnimationProperties`). Mezcla lógica de presentación con lógica de negocio compleja.
2.  **`CanvasArea.tsx`**: Maneja renderizado, eventos de ratón, lógica de herramientas (varita mágica, cuentagotas) y redimensionamiento en un solo archivo.
3.  **`useProjectController.ts`**: Gestiona tanto el estado del dominio (frames, assets) como el estado efímero de la UI (modales, toasts, paneles).

### B. Acoplamiento de UI
*   Componentes visuales básicos (`Section`, `SectionHeader`, `PropRow`) están duplicados o definidos dentro de componentes contenedores, impidiendo su reutilización en el `LeftSidebar` o modales.

### C. Estructura de Carpetas
*   La carpeta `components` es plana (excepto por `panels/left`). Necesita una jerarquía semántica más clara (`common`, `canvas`, `layout`, `overlays`).

---

## 2. Estrategia de Modularización

El objetivo es aplicar el principio de **Separación de Responsabilidades (SoC)**.

### Fase 1: Desacoplamiento de UI y Paneles (Implementada Ahora)
*   **Acción**: Extraer componentes de UI reutilizables a `components/common`.
*   **Acción**: Atomizar `RightSidebar` en módulos específicos dentro de `components/panels/right/`.
*   **Beneficio**: Reduce el tamaño de `RightSidebar.tsx` de ~400 líneas a ~100 líneas y facilita la lectura.

### Fase 2: Segregación de Estado (Implementada Ahora)
*   **Acción**: Crear `hooks/useUIController.ts` para manejar modales, toasts, diálogos y paletas de comandos.
*   **Acción**: Limpiar `useProjectController.ts` para que solo orqueste lógica de negocio, delegando la UI al nuevo hook.
*   **Beneficio**: `useProjectController` se vuelve más testearle y menos propenso a renderizados innecesarios.

### Fase 3: Optimización del Canvas (Recomendación Futura)
*   **Acción**: Extraer los manejadores de eventos (`onMouseDown`, `onMouseMove`) de `CanvasArea` a un hook `useCanvasInteraction`.
*   **Acción**: Mover la lógica de dibujo auxiliar (reglas, grid) a `utils/canvasHelpers.ts`.

---

## 3. Nueva Estructura de Directorios

```text
src/
├── components/
│   ├── common/           # UI Genérica (Inputs, Sections, Headers)
│   ├── panels/
│   │   ├── left/         # Herramientas del lado izquierdo
│   │   └── right/        # Propiedades del lado derecho (Refactorizado)
│   ├── canvas/           # Todo lo relacionado al Canvas
│   ├── overlays/         # Modales y Toasts
│   └── layout/           # Header, Barras laterales
├── hooks/
│   ├── domains/          # Hooks específicos (Slicer, Builder, Anim)
│   └── useUIController.ts # Nuevo hook de estado de interfaz
```
