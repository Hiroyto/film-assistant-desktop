// Film-grain tile as a PNG data URL, generated once per page load.
//
// The SVG feTurbulence grain it replaces had to be rasterized on every paint;
// on large layers iOS Safari drew it tile by tile, so transitions flashed a
// grid of small squares. A plain bitmap tile paints instantly.
let cached: string | null = null;

export const noiseDataUrl = (size = 160): string => {
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  cached = canvas.toDataURL('image/png');
  return cached;
};
