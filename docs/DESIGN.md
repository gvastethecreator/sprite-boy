# Diseño de UI/UX - SpriteSlice Studio

Este documento describe la filosofía de diseño, el sistema de estilos y los patrones de interacción que definen la experiencia de usuario de SpriteSlice Studio.

## 1. Filosofía de Diseño

- **Profesional y Moderno**: Una estética limpia, minimalista y de alta tecnología.
- **Identidad Reactiva**: La marca (logo) no es solo estática; responde a la interacción del usuario con animaciones lúdicas y cambios cromáticos globales.
- **Centrado en el Contenido**: El espacio de trabajo (canvas) es el protagonista.
- **Feedback Constante**: Todas las interacciones clave tienen una respuesta visual y auditiva clara.

## 2. Sistema de Diseño y Estilos

### 2.1. Colores de Acento Dinámicos

El color de acento (`--accent-rgb`) puede cambiar dinámicamente. Al rotar los colores desde el logo, toda la aplicación transiciona suavemente gracias a reglas de transición global en el `:root`.

**Color Predeterminado:** Negro (`0 0 0`) para una estética neutral y elegante.

**Paleta de Ciclo:**

1. Negro (Base / Inicial)
2. Azul
3. Púrpura
4. Rosa
5. Rojo
6. Naranja
7. Amarillo
8. Verde
9. Cian

### 2.2. Animaciones de Marca

- **Logo Pop**: Una micro-interacción que utiliza `scale` y `rotate` para confirmar la acción del usuario al cambiar el esquema de color. Se acompaña de un aumento temporal de brillo (`brightness`).

... (resto del documento) ...
