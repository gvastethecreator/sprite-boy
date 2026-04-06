# Guía de Componentes - SpriteSlice Studio

Este documento desglosa la estructura de la interfaz de usuario y la responsabilidad de cada componente.

## Jerarquía Principal

```
App
└── AppLayout (Layout principal, Grid CSS/Flex)
    ├── Header (Barra superior)
    ├── LeftSidebar (Herramientas, Librería, Animaciones)
    ├── CanvasArea (Viewport central, <canvas>)
    ├── Timeline (Secuenciador inferior)
    ├── RightSidebar (Propiedades, Inspector)
    └── Modals (Export, Settings, Help)
```

## Descripción de Componentes

### 1. `AppLayout.tsx`

- **Responsabilidad:** Orquestador principal. Recibe el `controller` y distribuye el estado y las funciones a los hijos.
- **Layout:** Gestiona la disposición responsiva de los paneles y los diálogos modales.

### 2. `CanvasArea.tsx`

- **Responsabilidad:** Manejo de la interacción directa con el espacio de trabajo.
- **Features:**
  - Contiene el elemento `<canvas>`.
  - Captura eventos de ratón (Drag, Drop, Click) y teclado.
  - Implementa la lógica de "Cámara" (Zoom, Pan).
  - Traduce coordenadas de pantalla a coordenadas de mundo (World Space).
  - Llama a `CanvasRenderer` para dibujar.

### 3. `LeftSidebar.tsx`

Cambia su contenido dinámicamente según el `AppMode` actual.

- **`ToolsPanel`**: Configuración de Grilla, Auto-slice, Varita mágica (Chroma Key).
- **`AnimationPanel`**: Lista de animaciones creadas.
- **`LibraryPanel`** (Solo Builder): Grid de assets importados disponibles para arrastrar.
- **`TemplatePanel`** (Solo Template): Opciones de visualización para exportación.

### 4. `RightSidebar.tsx`

Actúa como un "Inspector de Propiedades". Muestra información contextual basada en la selección actual.

- **Si hay Frame seleccionado:** Muestra X, Y, W, H.
- **Si hay Hitbox seleccionada:** Muestra Tag, Tipo, Dimensiones.
- **Si hay Animación activa:** Muestra nombre, FPS, Loop, y propiedades del Keyframe actual (Pivote).
- **Si hay Builder Slot seleccionado:** Muestra ajustes de imagen (Fit/Fill, Flip, Offset).

### 5. `Timeline.tsx`

- **Responsabilidad:** Visualización y manipulación de la secuencia de animación.
- **Features:**
  - Lista horizontal de frames.
  - Drag & Drop para reordenar (usando API nativa de HTML5 DnD).
  - Controles de reproducción (Play, Pause, Step).
  - "Tray" (Bandeja) desplegable para añadir nuevos frames desde la fuente disponible.

### 6. `Header.tsx`

- **Responsabilidad:** Navegación global y acciones a nivel de archivo.
- **Controles:** Selector de Modo (Slice, Hitbox, Build, Export), Undo/Redo, Abrir/Guardar Proyecto, Ajustes.

### 7. Modales

- **`ExportModal.tsx`**: Generador de código y descarga de PNG. Muestra una vista previa del código generado en tiempo real.
- **`SettingsModal.tsx`**: Preferencias de usuario (Tema, Color de acento, Densidad UI).
- **`HelpModal.tsx`**: Tabla de atajos de teclado.

## Componentes UI Reutilizables

- **`NumberControl.tsx`**: Input numérico avanzado. Permite arrastrar el label para cambiar el valor (scrubbing), usar flechas, o escribir directamente. Soporta sliders opcionales.
