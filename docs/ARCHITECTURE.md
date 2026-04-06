# Arquitectura Técnica - SpriteBoy Studio

Este documento describe las decisiones de ingeniería, patrones de diseño y flujo de datos de la aplicación.

## 1. Visión General del Stack

| Capa            | Herramienta                   | Versión |
| --------------- | ----------------------------- | ------- |
| Framework UI    | React                         | 19.2    |
| Lenguaje        | TypeScript                    | 5.8     |
| Bundler         | Vite (Rolldown)               | 8.x     |
| Estilos         | Tailwind CSS                  | 4.x     |
| Animación       | GSAP + CSS keyframes          | 3.12    |
| Testing         | Vitest + Testing Library      | 4.x     |
| Linting         | OXC (oxlint)                  | 1.x     |
| Package Manager | Bun                           | 1.x     |
| Renderizado     | HTML5 Canvas API (Imperativo) | -       |
| Persistencia    | IndexedDB                     | -       |
| IA              | Google GenAI (Gemini/Imagen)  | -       |

## 2. Patrón de Diseño: React UI + Canvas Engine

Para lograr un alto rendimiento, la aplicación desacopla el ciclo de renderizado de React del ciclo de renderizado del Canvas gráfico.

### 2.1. El Problema

Renderizar imágenes pesadas, guías, hitboxes y animaciones a 60 FPS mediante componentes React (DOM) es ineficiente y causa "jank".

### 2.2. La Solución: `CanvasRenderer` (Clase Estática)

Se utiliza una clase utilitaria (`utils/renderUtils.ts`) que actúa como un motor de renderizado "stateless".

- **Render Loop:** `useProjectController` mantiene un bucle `requestAnimationFrame`.
- **Render Context:** En cada frame, se pasa un objeto `RenderContext` completo (que contiene todo el estado relevante: frames, imágenes, configuración, ratón) al método estático `CanvasRenderer.render()`.
- **Ventaja:** React solo gestiona los inputs y la estructura del layout. El canvas se redibuja de forma imperativa, permitiendo operaciones complejas (zoom, pan, pixel-grid, onion skin) sin reconciliación del Virtual DOM.

## 3. Gestión de Estado

### 3.1. `useProjectController`

Es el "cerebro" de la aplicación.

- Centraliza toda la lógica de negocio.
- Expone métodos para modificar el estado (acciones).
- Gestiona los efectos secundarios (timers, carga de imágenes).
- Sirve como puente entre los componentes de UI y el estado global.

### 3.2. `useUndo`

Un hook genérico que envuelve el estado del proyecto (`ProjectState`).

- Implementa un patrón _Memento_ simple (Past, Present, Future).
- Permite actualizaciones "efímeras" (`setEphemeral`) para acciones de alta frecuencia (como arrastrar un frame) que no deben generar historial de deshacer hasta que la acción termina (`onMouseUp`).

## 4. Estructura de Datos (`types.ts`)

El modelo de datos está diseñado para ser serializable a JSON.

- **`ImageMeta`**: Referencia a la imagen fuente. Usa `Blob URL` (`blob:http://...`) para mantener las imágenes en memoria del navegador sin duplicar datos en Base64 hasta el momento de guardar.
- **`FrameData`**: Coordenadas `{x, y, w, h}` relativas a la imagen fuente. Contiene un array de `HitboxData`.
- **`SpriteAnimation`**: Lista de `Keyframe`. Un `Keyframe` referencia a un `FrameData` por índice y añade metadatos de animación (pivote).
- **`BuilderSlots`**: Un mapa hash para el modo Builder, vinculando celdas de una grilla lógica con `Assets` de la librería.

## 5. Algoritmos Clave

### 5.1. Detección de Sprites (`detectSprites` en `algorithms.ts`)

- Usa un algoritmo de **Búsqueda en Anchura (BFS)** o "Flood Fill".
- Analiza el `ImageData` del canvas para encontrar islas de píxeles no transparentes.
- Optimización: "Cede" el control al hilo principal (Yield to main thread) cada ciertas filas para no congelar la UI durante el procesamiento de imágenes grandes.

### 5.2. Eliminación de Fondo (`removeBackground`)

- Implementa lógica de **Chroma Key** en el espacio de color HSL.
- Calcula la distancia de color entre el píxel y el color objetivo.
- Aplica suavizado (Feathering) en los bordes para evitar bordes duros (aliasing).
- Detecta automáticamente si debe usar Luma Key (para grises) o Chroma Key (para colores).

## 6. Flujo de Datos

1. **Input:** Usuario interactúa (Click, Teclado, Drag).
2. **Controller:** `useProjectController` recibe el evento.
3. **Lógica:** Se actualiza el estado (ej. mover un frame).
4. **React Render:** React detecta cambio de estado y actualiza el DOM (inputs numéricos, lista de capas).
5. **Canvas Render:** Un `useEffect` en `CanvasArea` o el loop de animación detecta el cambio y llama a `CanvasRenderer.render()`.
6. **Paint:** El canvas HTML5 se actualiza visualmente.
