
import { FrameData, GridConfig } from '../types';
import { calculateGeometry } from './renderUtils';

// --- CLIENT SIDE BRIDGE ---

const WORKER_TIMEOUT_MS = 30_000;

let workerInstance: Worker | null = null;
const pendingPromises: Record<string, { resolve: Function, reject: Function, timer: ReturnType<typeof setTimeout> }> = {};

function destroyWorker() {
    if (workerInstance) {
        workerInstance.terminate();
        workerInstance = null;
    }
    // Reject all pending promises
    for (const id of Object.keys(pendingPromises)) {
        pendingPromises[id].reject(new Error('Worker terminated'));
        clearTimeout(pendingPromises[id].timer);
        delete pendingPromises[id];
    }
}

function getWorker() {
    if (!workerInstance) {
        workerInstance = new Worker(new URL('./imageWorker.ts', import.meta.url), { type: 'module' });
        workerInstance.onmessage = (e) => {
            const { type, id, result, error } = e.data;
            if (pendingPromises[id]) {
                clearTimeout(pendingPromises[id].timer);
                if (type === 'SUCCESS') pendingPromises[id].resolve(result);
                else pendingPromises[id].reject(new Error(error));
                delete pendingPromises[id];
            }
        };
        workerInstance.onerror = (e) => {
            console.error('Worker crashed:', e.message);
            destroyWorker(); // Will reject all pending and force re-creation on next call
        };
    }
    return workerInstance;
}

function runWorkerTask<T>(type: string, payload: any, transfer: Transferable[] = []): Promise<T> {
    return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).substr(2);
        const timer = setTimeout(() => {
            if (pendingPromises[id]) {
                delete pendingPromises[id];
                reject(new Error(`Worker task "${type}" timed out after ${WORKER_TIMEOUT_MS}ms`));
            }
        }, WORKER_TIMEOUT_MS);
        pendingPromises[id] = { resolve, reject, timer };
        getWorker().postMessage({ type, id, payload }, transfer);
    });
}

function getImageData(img: HTMLImageElement): { width: number, height: number, data: Uint8ClampedArray } {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    // willReadFrequently optimizes the canvas for heavy readback operations (like this)
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Cannot get context');
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, img.width, img.height);
    return { width: id.width, height: id.height, data: id.data };
}

// --- PUBLIC API ---

/** Creates a uniform grid of FrameData from dimensions and GridConfig. */
export function generateFramesFromGrid(width: number, height: number, grid: GridConfig): FrameData[] {
    const { rows, cols, marginX, marginY, paddingX, paddingY, cellW, cellH } = calculateGeometry(width, height, grid);
    const frames: FrameData[] = [];
    let idCounter = 0;
    
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = marginX + (c * (cellW + paddingX));
            const y = marginY + (r * (cellH + paddingY));
            const finalX = Math.floor(x);
            const finalY = Math.floor(y);
            const finalW = Math.floor(cellW);
            const finalH = Math.floor(cellH);

            if (finalX + finalW <= width && finalY + finalH <= height) {
                frames.push({
                    id: idCounter++,
                    x: finalX,
                    y: finalY,
                    w: finalW,
                    h: finalH
                });
            }
        }
    }
    return frames;
}

/** Detects all sprites in an image via flood-fill (runs in Worker). */
export async function detectSprites(img: HTMLImageElement, threshold: number = 10): Promise<FrameData[]> {
    const { width, height, data } = getImageData(img);
    return runWorkerTask<FrameData[]>('DETECT_SPRITES', { width, height, buffer: data.buffer, threshold });
}

/** Detects a single sprite at a specific pixel coordinate (runs in Worker). */
export async function detectSpriteAt(img: HTMLImageElement, startX: number, startY: number, threshold: number = 10) {
    const { width, height, data } = getImageData(img);
    return runWorkerTask<{x:number, y:number, w:number, h:number} | null>('DETECT_ONE', { width, height, buffer: data.buffer, startX, startY, threshold });
}

/** Removes a target color from an image with tolerance and edge softness (runs in Worker). */
export async function removeBackground(imgSrc: string, targetHex: string, tolerance: number = 0, softness: number = 20): Promise<Blob | null> {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imgSrc;
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
    });

    const { width, height, data } = getImageData(img);
    
    const result: any = await runWorkerTask('REMOVE_BG', { 
        width, height, buffer: data.buffer, targetHex, tolerance, softness 
    });

    try {
        // Create a COPY of the buffer to avoid detached buffer issues if reuse is attempted
        const bufferCopy = result.buffer.slice(0);
        const resultImageData = new ImageData(
            new Uint8ClampedArray(bufferCopy), 
            result.width, 
            result.height
        );

        const canvas = document.createElement('canvas');
        canvas.width = resultImageData.width;
        canvas.height = resultImageData.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.putImageData(resultImageData, 0, 0);
        
        return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    } catch (e) {
        console.error("Failed to reconstruct ImageData", e);
        return null;
    }
}

/** Crops a region from an image source and returns a data URI. */
export async function cropImage(sourceSrc: string, x: number, y: number, w: number, h: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = sourceSrc;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject("Context error"); return; }
            ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
    });
}

/** Converts RGB values (0–255) to a hex color string. */
export const rgbToHex = (r: number, g: number, b: number) => "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
