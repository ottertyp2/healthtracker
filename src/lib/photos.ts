export type PreparedPhoto = {
  file: Blob;
  thumbnail: string;
  name: string;
};

export async function prepareMealPhoto(input: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(input);
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare photo canvas.");
  ctx.drawImage(bitmap, 0, 0, width, height);

  const photo = await canvasToBlob(canvas, "image/jpeg", 0.82);

  const thumbMax = 420;
  const thumbScale = Math.min(1, thumbMax / Math.max(bitmap.width, bitmap.height));
  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = Math.round(bitmap.width * thumbScale);
  thumbCanvas.height = Math.round(bitmap.height * thumbScale);
  const thumbCtx = thumbCanvas.getContext("2d");
  if (!thumbCtx) throw new Error("Could not prepare thumbnail canvas.");
  thumbCtx.drawImage(bitmap, 0, 0, thumbCanvas.width, thumbCanvas.height);
  const thumbnail = thumbCanvas.toDataURL("image/jpeg", 0.62);

  return {
    file: photo,
    thumbnail,
    name: `meal-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`,
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Could not encode image."));
      else resolve(blob);
    }, type, quality);
  });
}
