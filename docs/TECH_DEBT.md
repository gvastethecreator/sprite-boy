# 🔴 Deuda Técnica – SpriteBoy Studio

Documento de seguimiento de mejoras pendientes, ordenado por prioridad.

---

## 🔴 Prioridad Alta

### 1. `CanvasArea.tsx` – Componente monolítico (~600 líneas)

**Problema:** Mezcla renderizado, eventos de ratón, lógica de herramientas (varita mágica, cuentagotas) y redimensionamiento en un solo archivo.

**Solución propuesta:** Extraer en hooks composables:

- `useCanvasMouse.ts` – manejo de eventos de ratón (drag, zoom, pan)
- `useCanvasTools.ts` – lógica de herramientas (eyedropper, magic wand)
- `useCanvasRenderLoop.ts` – requestAnimationFrame loop

### 2. `useProjectController.ts` – Controller centralizado (~700 líneas)

**Problema:** Gestiona estado de dominio Y estado efímero de UI. Difícil de testear unitariamente.

**Solución propuesta:** Ya se inició la extracción con `domains/` (useAnimationLogic, useBuilderLogic, useSlicerLogic). Completar extrayendo:

- Estado de UI (modales, toasts) → ya en `useUIController`
- Lógica de exportación → `useExportLogic.ts`
- Lógica de persistencia IndexedDB → `usePersistence.ts`

### 3. Cobertura de Tests insuficiente

**Problema:** Solo utils y types tienen tests. No hay tests para hooks, componentes, ni lógica de dominio.

**Próximos tests a implementar:**

- `useUndo.test.ts` – verificar historial, ephemeral updates, limites
- `useAnimationLogic.test.ts` – CRUD animaciones, playback
- `CanvasArea.test.tsx` – renderizado básico, interacciones
- `Header.test.tsx` – navegación de modos, acciones de menú

---

## 🟡 Prioridad Media

### 4. Web Worker sin gestión de errores robusta

**Problema:** `algorithms.ts` crea un Worker singleton. Si el Worker crashea, no se recupera ni notifica al usuario.

**Solución:** Añadir timeout a las promesas del Worker y recrear la instancia en caso de error.

### 5. Blob URL memory leaks potenciales

**Problema:** `ImageMeta.src` usa blob URLs. Si se cargan múltiples imágenes sin cerrar la anterior, los blobs previos podrían permanecer en memoria.

**Solución:** Auditar todos los flujos de carga de imagen y asegurar `URL.revokeObjectURL()` en cleanup.

### 6. `renderUtils.ts` – Clase estática con código minificado

**Problema:** `CanvasRenderer` está escrito en líneas ultra-compactas, dificultando la lectura y debugging.

**Solución:** Reformatear los métodos privados (drawPivotMarker, drawCheckerboard, drawPixelGrid, drawFrameLabel) a formato legible con espaciado adecuado.

### 7. Tipado débil en `exportFormats.ts`

**Problema:** Usa `any` para `frameInfo` y no valida que los keyframes referencien frames existentes.

**Solución:** Tipar completamente las interfaces de exportación y añadir validación.

### 8. Google Fonts via CDN

**Problema:** Las fuentes Archivo y JetBrains Mono se cargan desde Google Fonts CDN, lo que depende de conectividad y puede causar FOUT.

**Solución:** Self-host las fuentes o usar `@fontsource/archivo` y `@fontsource/jetbrains-mono`.

---

## 🟢 Prioridad Baja

### 9. Migrar animaciones CSS a GSAP

**Problema:** Las animaciones actuales (fade-in, slide-up, logo-pop) usan CSS keyframes. GSAP está instalado pero no se usa aún.

**Solución:** Migrar gradualmente las animaciones a GSAP para uniformar la capa de animación y aprovechar el control de timeline, especialmente para transiciones de modales y toasts.

### 10. Componente `NumberControl` – Accesibilidad

**Problema:** El control numérico implementa drag-scrub personalizado que no es accesible via teclado en todos los navegadores.

**Solución:** Añadir aria-attributes y asegurar navegación por teclado completa.

### 11. Estructura de carpetas `components/`

**Problema:** La carpeta es semi-plana. Los modales, overlays, y componentes de layout conviven sin separación clara.

**Solución propuesta (de REFACTOR_PLAN.md):**

```
components/
├── layout/      # AppLayout, Header, Sidebars
├── canvas/      # CanvasArea, CanvasToolbar, CanvasStatusBar
├── overlays/    # Modals, CommandPalette, ContextMenu, Toasts
├── panels/      # Left/Right sidebar panels
└── common/      # Primitivos UI reutilizables
```

### 12. Documentación inline

**Problema:** Los archivos de hooks y utils carecen de JSDoc en funciones públicas.

**Solución:** Añadir JSDoc a la API pública de cada módulo.

---

## 📊 Métricas actuales

| Métrica | Valor |
| --- | --- |
| Tests unitarios | ~31 |
| Archivos typescript | ~40 |
| Coverage estimado | ~15% (solo utils) |
| Componentes | 18 principales + 9 paneles |
| Hooks | 7 (4 core + 3 domain) |
| LOC total estimado | ~8000 |
