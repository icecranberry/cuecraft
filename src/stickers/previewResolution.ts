import type { DisplayQuality, StickerInstance } from '../core/types';

const PROFILES = {
  fast: { minPpm: 6, maxPpm: 12, maxDim: 4096, maxPixels: 2 * 1024 * 1024 },
  balanced: { minPpm: 12, maxPpm: 48, maxDim: 8192, maxPixels: 8 * 1024 * 1024 },
  sharp: { minPpm: 16, maxPpm: 64, maxDim: 8192, maxPixels: 16 * 1024 * 1024 },
};
const DRAG_PROFILE = { minPpm: 4, maxPpm: 6, maxDim: 2048, maxPixels: 1024 * 1024 };

/** Match source pixel density, bounded by texture dimensions and a per-part pixel budget. */
export function previewPrintResolution(
  widthMm: number,
  heightMm: number,
  stickers: readonly StickerInstance[],
  imageSize: (s: StickerInstance) => { w: number; h: number } | null,
  quality: DisplayQuality,
  interactive: boolean,
  maxTextureSize: number,
): { ppm: number; maxDim: number } {
  const profile = interactive ? DRAG_PROFILE : PROFILES[quality];
  const maxDim = Math.min(profile.maxDim, maxTextureSize);
  let sourcePpm = profile.minPpm;
  for (const sticker of stickers) {
    if (sticker.hidden) continue;
    const image = imageSize(sticker);
    if (!image || sticker.w <= 0 || sticker.h <= 0) continue;
    // Isotropic density also preserves details when the sticker is rotated.
    sourcePpm = Math.max(sourcePpm, image.w / sticker.w, image.h / sticker.h);
  }
  const ppm = Math.min(
    sourcePpm,
    profile.maxPpm,
    maxDim / Math.max(widthMm, heightMm, 1),
    Math.sqrt(profile.maxPixels / Math.max(1, widthMm * heightMm)),
  );
  return { ppm, maxDim };
}
