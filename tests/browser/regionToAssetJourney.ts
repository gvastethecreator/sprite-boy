import { browserRegionCrop } from "../../features/slice/assets/browserRegionCrop";

declare global {
  var __spriteBoyS105: Promise<unknown> | undefined;
}

function nativeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!context) throw new Error("S1-05 2D browser context unavailable.");
  context.imageSmoothingEnabled = false;
  return context;
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("S1-05 output Blob could not be read."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });
}

async function run() {
  const sourceCanvas = document.querySelector<HTMLCanvasElement>("#source");
  const outputCanvas = document.querySelector<HTMLCanvasElement>("#output");
  if (!sourceCanvas || !outputCanvas) throw new Error("S1-05 harness is incomplete.");
  const sourceContext = nativeContext(sourceCanvas);
  const sourcePixels = new Uint8ClampedArray(6 * 5 * 4);
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 6; x += 1) {
      const offset = (y * 6 + x) * 4;
      sourcePixels[offset] = x * 40 + 10;
      sourcePixels[offset + 1] = y * 50 + 5;
      sourcePixels[offset + 2] = (x + y) * 20;
      sourcePixels[offset + 3] = x === 2 && y === 2 ? 0 : x === 4 && y === 3 ? 128 : 255;
    }
  }
  sourceContext.putImageData(new ImageData(sourcePixels, 6, 5), 0, 0);
  const sourceBlob = await new Promise<Blob>((resolve, reject) => sourceCanvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("S1-05 source encode failed.")),
    "image/png",
  ));
  const canonicalSourceBitmap = await createImageBitmap(sourceBlob);
  const canonicalSourceCanvas = new OffscreenCanvas(6, 5);
  const canonicalSourceContext = canonicalSourceCanvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!canonicalSourceContext) throw new Error("S1-05 canonical decode context unavailable.");
  canonicalSourceContext.drawImage(canonicalSourceBitmap, 0, 0);
  canonicalSourceBitmap.close();
  const canonicalSourcePixels = canonicalSourceContext.getImageData(0, 0, 6, 5).data;
  const outputBlob = await browserRegionCrop.crop(sourceBlob, {
    bounds: { x: 1, y: 1, width: 4, height: 3 },
    sourceWidth: 6,
    sourceHeight: 5,
  });
  const outputBitmap = await createImageBitmap(outputBlob);
  const outputContext = nativeContext(outputCanvas);
  outputContext.clearRect(0, 0, 4, 3);
  outputContext.drawImage(outputBitmap, 0, 0);
  outputBitmap.close();
  const outputPixels = [...outputContext.getImageData(0, 0, 4, 3).data];
  const expected: number[] = [];
  for (let y = 1; y <= 3; y += 1) {
    for (let x = 1; x <= 4; x += 1) {
      const offset = (y * 6 + x) * 4;
      expected.push(...canonicalSourcePixels.slice(offset, offset + 4));
    }
  }
  if (JSON.stringify(outputPixels) !== JSON.stringify(expected)) throw new Error("S1-05 crop pixels changed.");
  return Object.freeze({
    outputWidth: 4,
    outputHeight: 3,
    bounds: "1,1,4,3",
    transparentPixelCount: outputPixels.filter((_, index) => index % 4 === 3 && outputPixels[index] === 0).length,
    partialAlphaPixelCount: outputPixels.filter((_, index) => index % 4 === 3 && outputPixels[index] === 128).length,
    pixels: outputPixels,
    outputBase64: await blobBase64(outputBlob),
  });
}

globalThis.__spriteBoyS105 = run();
