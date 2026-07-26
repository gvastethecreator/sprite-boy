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
    const transfer: Transferable[] = [];
    if (
      result &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      "buffer" in result &&
      (result as { buffer?: unknown }).buffer instanceof ArrayBuffer
    ) {
      transfer.push((result as { buffer: ArrayBuffer }).buffer);
    }
    self.postMessage({ type: "SUCCESS", id, result }, transfer);
  } catch (err: any) {
    self.postMessage({ type: "ERROR", id, error: err.message });
  }
};
