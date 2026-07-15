export function detectSprites(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
) {
  const visited = new Uint8Array(width * height);
  const frames = [];
  let idCounter = 0;
  const getIdx = (x: number, y: number) => (y * width + x) * 4;
  const dx = [0, 0, -1, 1];
  const dy = [-1, 1, 0, 0];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (visited[index] === 0 && data[getIdx(x, y) + 3] > threshold) {
        let minX = x,
          maxX = x,
          minY = y,
          maxY = y;
        const queue = [index];
        visited[index] = 1;
        let pixelCount = 0;
        let qIndex = 0;

        while (qIndex < queue.length) {
          const curr = queue[qIndex++];
          pixelCount++;
          const cx = curr % width;
          const cy = Math.floor(curr / width);

          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          for (let i = 0; i < 4; i++) {
            const nx = cx + dx[i];
            const ny = cy + dy[i];
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIndex = ny * width + nx;
              if (visited[nIndex] === 0 && data[getIdx(nx, ny) + 3] > threshold) {
                visited[nIndex] = 1;
                queue.push(nIndex);
              }
            }
          }
        }

        const w = maxX - minX + 1;
        const h = maxY - minY + 1;
        if (w > 2 && h > 2 && pixelCount > 4) {
          frames.push({ id: idCounter++, x: minX, y: minY, w, h });
        }
      }
    }
  }
  return frames;
}

export function detectSpriteAt(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  threshold: number,
) {
  const getIdx = (x: number, y: number) => (y * width + x) * 4;
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return null;
  if (data[getIdx(startX, startY) + 3] <= threshold) return null;

  const visited = new Uint8Array(width * height);
  const queue = [startY * width + startX];
  visited[startY * width + startX] = 1;

  let minX = startX,
    maxX = startX,
    minY = startY,
    maxY = startY;
  const dx = [0, 0, -1, 1];
  const dy = [-1, 1, 0, 0];
  let qIndex = 0;

  while (qIndex < queue.length) {
    const curr = queue[qIndex++];
    const cx = curr % width;
    const cy = Math.floor(curr / width);

    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;

    for (let i = 0; i < 4; i++) {
      const nx = cx + dx[i];
      const ny = cy + dy[i];
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIndex = ny * width + nx;
        if (visited[nIndex] === 0 && data[getIdx(nx, ny) + 3] > threshold) {
          visited[nIndex] = 1;
          queue.push(nIndex);
        }
      }
    }
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

export function removeBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  targetHex: string,
  tolerance: number,
  softness: number,
) {
  const hex = targetHex.replace("#", "");
  let rT = 0,
    gT = 0,
    bT = 0;

  if (hex.length === 3) {
    rT = parseInt(hex[0] + hex[0], 16);
    gT = parseInt(hex[1] + hex[1], 16);
    bT = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length >= 6) {
    rT = parseInt(hex.substring(0, 2), 16);
    gT = parseInt(hex.substring(2, 4), 16);
    bT = parseInt(hex.substring(4, 6), 16);
  }

  if (isNaN(rT) || isNaN(gT) || isNaN(bT)) return data;

  const [hT, sT, lT] = rgbToHsl(rT, gT, bT);
  const tolNorm = Math.max(0.001, tolerance / 100);
  const softNorm = Math.max(0.001, softness / 100);
  const isGrayscaleTarget = sT < 0.1;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    let matchScore = 0;

    if (isGrayscaleTarget) {
      const rDist = Math.abs(r - rT) / 255;
      const gDist = Math.abs(g - gT) / 255;
      const bDist = Math.abs(b - bT) / 255;
      matchScore = Math.sqrt(rDist * rDist + gDist * gDist + bDist * bDist) / 1.732;
    } else {
      const [h, s, l] = rgbToHsl(r, g, b);
      let hDist = Math.abs(h - hT);
      if (hDist > 180) hDist = 360 - hDist;
      const hScore = hDist / 180;
      const sScore = Math.abs(s - sT);
      const lScore = Math.abs(l - lT);

      matchScore = hScore * 0.5 + sScore * 0.3 + lScore * 0.2;
    }

    let alpha = 1.0;
    if (matchScore < tolNorm) {
      alpha = 0;
    } else if (matchScore < tolNorm + softNorm) {
      const t = (matchScore - tolNorm) / softNorm;
      alpha = t * t * (3 - 2 * t);

      if (!isGrayscaleTarget && alpha < 0.9) {
        const factor = (1 - alpha) * 0.8;
        data[i] = Math.max(0, data[i] - (rT - data[i]) * factor);
        data[i + 1] = Math.max(0, data[i + 1] - (gT - data[i + 1]) * factor);
        data[i + 2] = Math.max(0, data[i + 2] - (bT - data[i + 2]) * factor);
      }
    }

    data[i + 3] = Math.floor(data[i + 3] * alpha);
  }
  return data;
}

self.onmessage = async (e) => {
  const { type, id, payload } = e.data;
  try {
    let result;

    switch (type) {
      case "DETECT_SPRITES":
        result = detectSprites(
          new Uint8ClampedArray(payload.buffer),
          payload.width,
          payload.height,
          payload.threshold,
        );
        break;

      case "REMOVE_BG":
        const data = new Uint8ClampedArray(payload.buffer);
        removeBackground(
          data,
          payload.width,
          payload.height,
          payload.targetHex,
          payload.tolerance,
          payload.softness,
        );
        result = { width: payload.width, height: payload.height, buffer: data.buffer };
        break;

      case "DETECT_ONE":
        result = detectSpriteAt(
          new Uint8ClampedArray(payload.buffer),
          payload.width,
          payload.height,
          payload.startX,
          payload.startY,
          payload.threshold,
        );
        break;

      default:
        throw new Error("Unknown worker command");
    }
    self.postMessage({ type: "SUCCESS", id, result });
  } catch (err: any) {
    self.postMessage({ type: "ERROR", id, error: err.message });
  }
};
