
import { 
    AppMode, GridConfig, FrameData, SlotData, SpriteAnimation, 
    TemplateConfig, OnionSkinConfig, Keyframe, FrameLabelConfig, SlotAlignment
} from '../types';

/** Shared state passed to every CanvasRenderer draw method. */
export interface RenderContext {
    ctx: CanvasRenderingContext2D;
    width: number;
    height: number;
    scale: number;
    offset: { x: number, y: number };
    currentMode: AppMode;
    slicerImgObj: HTMLImageElement | null;
    assetCache: Record<string, HTMLImageElement>;
    frames: FrameData[];
    builderSlots: Record<number, SlotData>;
    activeAnimation: SpriteAnimation | null;
    gridConfig: GridConfig;
    builderGrid: GridConfig; 
    templateConfig?: TemplateConfig;
    onionSkin?: OnionSkinConfig;
    selectedFrameIndex: number | null;
    playbackFrameIndex: number;
    isPlaying: boolean;
    isDraggingPivot: boolean;
    tempPivot: { x: number, y: number } | null;
    isHoveringBuilderSlot: number | null;
    selectedHitboxId: string | null;
    isExport: boolean;
    includeGridInExport: boolean;
    dragSelectionRect: { x: number, y: number, w: number, h: number } | null;
    guides: any[];
    labelConfig?: FrameLabelConfig;
    isDragOverCanvas?: boolean; 
    draggingSlotIndex?: number | null;
    mousePos?: { x: number, y: number };
}

/**
 * Calcula las dimensiones exactas de las celdas basadas en la grilla.
 * Aplica márgenes externos y espaciado (gap) interno entre celdas.
 */
/** Pre-computes derived grid geometry (cell size, total cols/rows) from image dimensions and GridConfig. */
export function calculateGeometry(width: number, height: number, grid: GridConfig) {
    const { rows, cols, marginX, marginY, paddingX, paddingY } = grid;
    
    // El gap total es el espacio entre celdas (cols - 1)
    const totalGapW = Math.max(0, paddingX * (cols - 1));
    const totalGapH = Math.max(0, paddingY * (rows - 1));
    
    // Los márgenes son hacia adentro desde ambos lados
    const totalMarginW = marginX * 2;
    const totalMarginH = marginY * 2;
    
    // Espacio disponible real para el contenido de las celdas
    const availableW = width - totalMarginW - totalGapW;
    const availableH = height - totalMarginH - totalGapH;
    
    // Tamaño de cada celda (mínimo 1px para evitar errores de división)
    const cellW = Math.max(1, availableW / cols);
    const cellH = Math.max(1, availableH / rows);
    
    return { rows, cols, marginX, marginY, paddingX, paddingY, cellW, cellH };
}

let cachedPattern: CanvasPattern | null = null;

/** Stateful renderer that draws the sprite-sheet canvas (checkerboard, grid, frames, overlays, rulers). */
export class CanvasRenderer {
    public static render(state: RenderContext) {
        const { ctx, width, height, scale, offset, isExport, templateConfig, isPlaying, activeAnimation, isDragOverCanvas, currentMode } = state;
        ctx.imageSmoothingEnabled = false; 
        const dpr = window.devicePixelRatio || 1;
        const canvasWidth = ctx.canvas.width / dpr;
        const canvasHeight = ctx.canvas.height / dpr;

        if (!isExport) {
            ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
            ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            if (currentMode === AppMode.ANIMATION && activeAnimation) {
                this.renderDualView(state, canvasWidth, canvasHeight);
            } else {
                ctx.save(); ctx.translate(offset.x, offset.y); ctx.scale(scale, scale);
                if (templateConfig?.backgroundColor && templateConfig.backgroundColor !== 'transparent') {
                    ctx.fillStyle = templateConfig.backgroundColor; ctx.fillRect(0, 0, width, height);
                } else { this.drawCheckerboard(ctx, width, height); }
                this.renderBuilderMode(state);
                if (state.currentMode === AppMode.BUILDER || state.currentMode === AppMode.ANIMATION) {
                    this.renderSlicerMode(state);
                }
                if (isDragOverCanvas && currentMode === AppMode.BUILDER) {
                    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 4 / scale; ctx.strokeRect(0, 0, width, height);
                    ctx.fillStyle = 'rgba(59, 130, 246, 0.1)'; ctx.fillRect(0, 0, width, height);
                }
                if (scale > 12) { this.drawPixelGrid(ctx, width, height, scale, offset, canvasWidth, canvasHeight); }
                ctx.restore();
            }
        } else {
             ctx.save();
             if (templateConfig?.backgroundColor && templateConfig.backgroundColor !== 'transparent') {
                ctx.fillStyle = templateConfig.backgroundColor; ctx.fillRect(0, 0, width, height);
             }
             this.renderBuilderMode(state);
             ctx.restore();
        }
    }

    private static getAlignmentCoords(align: SlotAlignment, cw: number, ch: number, iw: number, ih: number) {
        let x = 0, y = 0;
        if (align.includes('left')) x = 0;
        else if (align.includes('right')) x = cw - iw;
        else x = (cw - iw) / 2;
        if (align.includes('top')) y = 0;
        else if (align.includes('bottom')) y = ch - ih;
        else y = (ch - ih) / 2;
        return { x, y };
    }

    private static renderBuilderMode(state: Partial<RenderContext>) {
        const { ctx, width, height, builderGrid, builderSlots, assetCache, selectedFrameIndex, scale, isHoveringBuilderSlot, labelConfig, currentMode, draggingSlotIndex, mousePos } = state as RenderContext;
        if (!ctx || !builderGrid || !builderSlots) return;
        const { rows, cols, marginX, marginY, paddingX, paddingY, cellW, cellH } = calculateGeometry(width, height, builderGrid);
        
        // Dibujar guías de la grilla
        if (currentMode === AppMode.BUILDER && rows * cols < 5000) {
            ctx.save(); ctx.beginPath(); ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'; ctx.lineWidth = 1 / scale;
            
            // Líneas horizontales
            for (let r = 0; r <= rows; r++) {
                const y = marginY + (r * (cellH + paddingY));
                // Ajuste para que la última línea no sume un padding extra
                const finalY = r === rows ? marginY + (r * cellH) + (Math.max(0, r-1) * paddingY) : y;
                ctx.moveTo(marginX, finalY);
                ctx.lineTo(width - marginX, finalY);
            }
            
            // Líneas verticales
            for (let c = 0; c <= cols; c++) {
                const x = marginX + (c * (cellW + paddingX));
                const finalX = c === cols ? marginX + (c * cellW) + (Math.max(0, c-1) * paddingX) : x;
                ctx.moveTo(finalX, marginY);
                ctx.lineTo(finalX, height - marginY);
            }
            ctx.stroke(); ctx.restore();
        }

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const idx = r * cols + c;
                const slot = builderSlots[idx];
                const isSelected = selectedFrameIndex === idx && currentMode === AppMode.BUILDER;
                const isHovered = isHoveringBuilderSlot === idx && currentMode === AppMode.BUILDER;
                
                // Posicionamiento preciso considerando gaps entre celdas
                const x = marginX + (c * (cellW + paddingX));
                const y = marginY + (r * (cellH + paddingY));

                if (isHovered) { 
                    ctx.fillStyle = 'rgba(59, 130, 246, 0.15)'; 
                    ctx.fillRect(x, y, cellW, cellH); 
                    ctx.strokeStyle = '#3b82f6'; 
                    ctx.lineWidth = 2 / scale; 
                    ctx.strokeRect(x, y, cellW, cellH); 
                }

                if (slot && assetCache[slot.assetId] && draggingSlotIndex !== idx) {
                    const img = assetCache[slot.assetId]; 
                    ctx.save(); 
                    ctx.beginPath(); ctx.rect(x, y, cellW, cellH); ctx.clip();
                    ctx.globalAlpha = slot.opacity ?? 1;
                    let dw = img.width, dh = img.height;
                    if (slot.fitMode === 'fit') { const rat = Math.min(cellW/dw, cellH/dh); dw *= rat; dh *= rat; }
                    else if (slot.fitMode === 'fill') { const rat = Math.max(cellW/dw, cellH/dh); dw *= rat; dh *= rat; }
                    else if (slot.fitMode === 'stretch') { dw = cellW; dh = cellH; }
                    const scaledW = dw * (slot.scaleX ?? 1);
                    const scaledH = dh * (slot.scaleY ?? 1);
                    const align = this.getAlignmentCoords(slot.alignment || 'center', cellW, cellH, scaledW, scaledH);
                    ctx.translate(x + align.x + scaledW/2 + slot.offsetX, y + align.y + scaledH/2 + slot.offsetY); 
                    if (slot.rotation) ctx.rotate(slot.rotation * Math.PI / 180);
                    ctx.scale(slot.flipX ? -1 : 1, slot.flipY ? -1 : 1);
                    ctx.drawImage(img, -scaledW/2, -scaledH/2, scaledW, scaledH); 
                    ctx.restore();
                }

                if (isSelected) { 
                    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2/scale; ctx.strokeRect(x, y, cellW, cellH); 
                    this.drawFrameLabel(ctx, idx, x, y, cellW, cellH, scale, labelConfig); 
                }
            }
        }
    }

    private static renderSlicerMode(state: Partial<RenderContext>) {
        const { ctx, slicerImgObj, frames, selectedFrameIndex, scale, currentMode, isExport, labelConfig, gridConfig, width, height } = state as RenderContext;
        if (!ctx || !slicerImgObj) return;
        if (frames.length === 0) ctx.drawImage(slicerImgObj, 0, 0);
        else { frames.forEach(f => { if (!f.hidden) ctx.drawImage(slicerImgObj, f.x, f.y, f.w, f.h, f.x, f.y, f.w, f.h); }); }
        
        if (!isExport && currentMode !== AppMode.ANIMATION) {
            const { rows, cols, marginX, marginY, paddingX, paddingY, cellW, cellH } = calculateGeometry(width, height, gridConfig);
            if (rows * cols < 5000) {
                ctx.save();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.lineWidth = 1 / scale;
                ctx.beginPath();
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const x = marginX + (c * (cellW + paddingX));
                        const y = marginY + (r * (cellH + paddingY));
                        ctx.rect(x, y, cellW, cellH);
                    }
                }
                ctx.stroke();
                ctx.restore();
            }
        }
        
        if (selectedFrameIndex !== null && frames[selectedFrameIndex]) {
            const f = frames[selectedFrameIndex];
            if (f.hidden && !isExport) return;
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2 / scale;
            ctx.strokeRect(f.x, f.y, f.w, f.h);
            this.drawFrameLabel(ctx, f.id, f.x, f.y, f.w, f.h, scale, labelConfig);
        }
    }

    private static renderDualView(state: RenderContext, cw: number, ch: number) {
        const {
            ctx, activeAnimation, playbackFrameIndex, width, height,
            scale, offset, slicerImgObj, frames, labelConfig,
            builderSlots, assetCache,
        } = state;
        if (!activeAnimation) return;

        // --- Left panel: source frames ---
        const midX = Math.floor(cw * 0.6);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, midX, ch);
        ctx.clip();

        ctx.save();
        ctx.translate(offset.x, offset.y);
        ctx.scale(scale, scale);
        this.drawCheckerboard(ctx, width, height);
        this.renderBuilderMode({ ...state, isExport: false });
        this.renderSlicerMode({ ...state, isExport: false });

        const usedFrameIds = new Set(activeAnimation.keyframes.map(kf => kf.sourceIndex));
        ctx.lineWidth = 2 / scale;
        frames.forEach(f => {
            if (!f.hidden && usedFrameIds.has(f.id)) {
                ctx.strokeStyle = '#fbbf24';
                ctx.strokeRect(f.x, f.y, f.w, f.h);
            }
        });

        const currentKf = activeAnimation.keyframes[playbackFrameIndex];
        if (currentKf) {
            const f = frames.find(fr => fr.id === currentKf.sourceIndex);
            if (f && !f.hidden) {
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 3 / scale;
                ctx.strokeRect(f.x, f.y, f.w, f.h);
                this.drawFrameLabel(ctx, f.id, f.x, f.y, f.w, f.h, scale, labelConfig);
            }
        }
        ctx.restore();
        ctx.restore();

        // --- Right panel: animation preview ---
        ctx.save();
        ctx.beginPath();
        ctx.rect(midX, 0, cw - midX, ch);
        ctx.clip();

        ctx.fillStyle = '#0a0a0c';
        ctx.fillRect(midX, 0, cw - midX, ch);
        ctx.strokeStyle = '#27272a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(midX, 0);
        ctx.lineTo(midX, ch);
        ctx.stroke();

        const previewSize = Math.min(cw - midX - 64, ch - 160);
        const px = midX + (cw - midX - previewSize) / 2;
        const py = (ch - previewSize) / 2 - 20;

        ctx.save();
        ctx.translate(px, py);

        ctx.save();
        this.drawCheckerboard(ctx, previewSize, previewSize);
        ctx.restore();

        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.strokeRect(0, 0, previewSize, previewSize);

        if (currentKf) {
            const frame = frames.find(f => f.id === currentKf.sourceIndex);
            const slot = builderSlots[currentKf.sourceIndex];
            const rotRad = (currentKf.rotation || 0) * Math.PI / 180;
            const sx = currentKf.scaleX ?? 1;
            const sy = currentKf.scaleY ?? 1;
            const alpha = currentKf.opacity ?? 1;

            if (slot && assetCache[slot.assetId]) {
                const img = assetCache[slot.assetId];
                const sBase = Math.min(previewSize / img.width, previewSize / img.height) * 0.8;
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.translate(previewSize / 2, previewSize / 2);
                ctx.rotate(rotRad);
                ctx.scale(sBase * sx * (slot.flipX ? -1 : 1), sBase * sy * (slot.flipY ? -1 : 1));
                ctx.translate(-img.width * currentKf.pivotX, -img.height * currentKf.pivotY);
                ctx.drawImage(img, 0, 0);
                this.drawPivotMarker(ctx, img.width, img.height, currentKf.pivotX, currentKf.pivotY, sBase * Math.max(sx, sy));
                ctx.restore();
            } else if (frame && slicerImgObj) {
                const sBase = Math.min(previewSize / frame.w, previewSize / frame.h) * 0.8;
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.translate(previewSize / 2, previewSize / 2);
                ctx.rotate(rotRad);
                ctx.scale(sBase * sx, sBase * sy);
                ctx.translate(-frame.w * currentKf.pivotX, -frame.h * currentKf.pivotY);
                ctx.drawImage(slicerImgObj, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
                this.drawPivotMarker(ctx, frame.w, frame.h, currentKf.pivotX, currentKf.pivotY, sBase * Math.max(sx, sy));
                ctx.restore();
            }
        }

        ctx.fillStyle = 'white';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${activeAnimation.name.toUpperCase()}`, previewSize / 2, previewSize + 30);
        ctx.restore();
        ctx.restore();
    }

    private static drawPivotMarker(
        ctx: CanvasRenderingContext2D,
        w: number, h: number,
        px: number, py: number,
        curScale: number
    ) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5 / curScale;
        ctx.beginPath();
        const pl = 8 / curScale;
        const ax = w * px;
        const ay = h * py;
        ctx.moveTo(ax - pl, ay);
        ctx.lineTo(ax + pl, ay);
        ctx.moveTo(ax, ay - pl);
        ctx.lineTo(ax, ay + pl);
        ctx.stroke();
    }

    private static drawCheckerboard(ctx: CanvasRenderingContext2D, w: number, h: number) {
        if (!cachedPattern) {
            const pC = document.createElement('canvas');
            pC.width = 32;
            pC.height = 32;
            const pX = pC.getContext('2d');
            if (pX) {
                pX.fillStyle = '#141418';
                pX.fillRect(0, 0, 32, 32);
                pX.fillStyle = '#1c1c22';
                pX.fillRect(0, 0, 16, 16);
                pX.fillRect(16, 16, 16, 16);
                cachedPattern = ctx.createPattern(pC, 'repeat');
            }
        }
        if (cachedPattern) {
            ctx.fillStyle = cachedPattern;
            ctx.fillRect(0, 0, w, h);
        }
    }

    private static drawPixelGrid(
        ctx: CanvasRenderingContext2D,
        w: number, h: number,
        sc: number,
        off: { x: number; y: number },
        cw: number, ch: number
    ) {
        if (sc < 8) return;
        const startX = Math.max(0, Math.floor(-off.x / sc));
        const endX = Math.min(w, Math.ceil((cw - off.x) / sc));
        const startY = Math.max(0, Math.floor(-off.y / sc));
        const endY = Math.min(h, Math.ceil((ch - off.y) / sc));
        const op = Math.min(0.15, (sc - 12) / 60);
        ctx.strokeStyle = `rgba(255, 255, 255, ${op})`;
        ctx.lineWidth = 1 / sc;
        ctx.beginPath();
        for (let x = startX; x <= endX; x++) {
            ctx.moveTo(x, startY);
            ctx.lineTo(x, endY);
        }
        for (let y = startY; y <= endY; y++) {
            ctx.moveTo(startX, y);
            ctx.lineTo(endX, y);
        }
        ctx.stroke();
    }

    private static drawFrameLabel(
        ctx: CanvasRenderingContext2D,
        id: number | string,
        x: number, y: number,
        w: number, h: number,
        sc: number,
        config?: FrameLabelConfig
    ) {
        if (config && !config.visible) return;
        ctx.save();
        const text = `#${id}`;
        const fs = Math.max(8, (config?.fontSize || 12) / sc);
        ctx.font = `bold ${fs}px sans-serif`;
        const m = ctx.measureText(text);
        const px = 6 / sc;
        const py = 4 / sc;
        const bh = fs + py;
        const bw = m.width + px * 2;
        const bx = x;
        const by = y - bh - 4 / sc;

        ctx.globalAlpha = config?.opacity ?? 1;
        ctx.fillStyle = config?.color || '#3b82f6';
        ctx.beginPath();

        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(bx, by, bw, bh, 4 / sc);
        } else {
            const r = 4 / sc;
            ctx.moveTo(bx + r, by);
            ctx.lineTo(bx + bw - r, by);
            ctx.arcTo(bx + bw, by, bx + bw, by + r, r);
            ctx.lineTo(bx + bw, by + bh - r);
            ctx.arcTo(bx + bw, by + bh, bx + bw - r, by + bh, r);
            ctx.lineTo(bx + r, by + bh);
            ctx.arcTo(bx, by + bh, bx, by + bh - r, r);
            ctx.lineTo(bx, by + r);
            ctx.arcTo(bx, by, bx + r, by, r);
        }
        ctx.fill();

        ctx.fillStyle = 'white';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, bx + px, by + bh / 2);
        ctx.restore();
    }
}
