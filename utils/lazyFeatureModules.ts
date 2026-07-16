/** Loads the optional AI implementation only after browser input is readable. */
export async function analyzeImageBlob(blob: Blob) {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Image analysis input could not be read."));
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("Image analysis input is invalid."));
    reader.readAsDataURL(blob);
  });
  const { analyzeImage } = await import("./aiService");
  return analyzeImage(base64);
}
