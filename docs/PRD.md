
# Documento de Requisitos del Producto (PRD) - SpriteSlice Studio

## 1. Introducción y Visión

**SpriteSlice Studio** es una aplicación web ("Single Page Application") diseñada para desarrolladores de videojuegos indie y artistas de píxeles. Su objetivo es proporcionar un flujo de trabajo unificado y sin servidor (local-first) para preparar *assets* gráficos antes de importarlos a motores de juego como Unity, Godot o Phaser.

La visión es eliminar la necesidad de herramientas de escritorio pesadas o scripts de Python complejos para tareas comunes como cortar spritesheets, crear animaciones básicas y definir cajas de colisión.

## 2. Perfil de Usuario

*   **Game Developer Indie:** Necesita iterar rápido, cortar hojas de sprites descargadas de internet y generar metadatos (JSON) compatibles con su motor.
*   **Pixel Artist:** Necesita previsualizar animaciones y limpiar fondos de sus creaciones sin salir del navegador.

## 3. Modos de la Aplicación (Funcionalidades Core)

La aplicación se estructura en 4 modos distintos que operan sobre un estado de proyecto compartido.

### 3.1. Modo SLICER (Cortador)
*   **Objetivo:** Importar una imagen fuente y definir regiones (frames) individuales.
*   **Requisitos:**
    *   Importación de imágenes (PNG, JPG, WEBP).
    *   **Auto-Slice:** Algoritmo para detectar "islas" de píxeles no transparentes automáticamente.
    *   **Grid Slice:** Configuración manual de filas, columnas, márgenes y padding.
    *   **Background Removal:** Herramienta de "varita mágica" (Chroma Key/Luma Key) para eliminar fondos de color sólido con tolerancia ajustable.
    *   Manipulación manual de frames (mover, redimensionar, crear, borrar).

### 3.2. Modo BUILDER (Compositor)
*   **Objetivo:** Crear un nuevo spritesheet combinando múltiples assets individuales (packing manual).
*   **Requisitos:**
    *   Definición del tamaño del canvas de salida (ej. 1024x1024).
    *   **Biblioteca de Assets:** Área para arrastrar y soltar imágenes externas o frames extraídos del Slicer.
    *   **Grid System:** Sistema de slots donde se pueden colocar assets.
    *   Propiedades por Slot: Ajuste (Fit/Fill/Stretch), Flip X/Y, Offset.

### 3.3. Modo ANIMATION (Animación)
*   **Objetivo:** Crear secuencias de animación utilizando los frames definidos en Slicer o Builder.
*   **Requisitos:**
    *   Gestión de múltiples animaciones (Crear, Renombrar, Duplicar, Borrar).
    *   **Línea de Tiempo:** Drag & drop para reordenar keyframes.
    *   **Reproducción:** Play/Pause, FPS ajustable, Loop.
    *   **Onion Skinning:** Visualización semitransparente del frame anterior.
    *   **Pivotes:** Definición del punto de anclaje (Pivot X/Y) por frame.

### 3.4. Modo COLLISION (Colisiones)
*   **Objetivo:** Definir metadatos de física y combate.
*   **Requisitos:**
    *   Creación de múltiples cajas (Hitboxes) por frame.
    *   Tipos de caja: Hitbox (Ataque), Hurtbox (Daño), Collision (Física).
    *   Etiquetado (Tags) para lógica de juego (ej. "head", "body").
    *   Herramientas de productividad: Copiar/Pegar hitboxes entre frames, Flip horizontal.

## 4. Requisitos No Funcionales

*   **Rendimiento:** Debe mantener 60 FPS durante la manipulación del canvas. El renderizado pesado no debe bloquear la UI de React.
*   **Privacidad:** Todo el procesamiento ocurre en el navegador del cliente (`<canvas>`). Ninguna imagen se sube a un servidor.
*   **Persistencia:** Guardado y carga de proyectos en formato `.json` (incluyendo imágenes en Base64 para portabilidad).
*   **Exportación:**
    *   Imagen: PNG optimizado.
    *   Datos: JSON Genérico, Formato Phaser 3, Formato Godot (Resource).

## 5. Interfaz de Usuario (UI/UX)
*   **Tema:** Oscuro por defecto (Dark Mode) para reducir fatiga visual, con acento configurable.
*   **Layout:** Estilo "IDE": Sidebar Izquierdo (Herramientas), Centro (Canvas), Sidebar Derecho (Propiedades), Abajo (Línea de tiempo).
