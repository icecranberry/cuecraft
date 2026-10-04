export type PatternSurface = { kind: 'lathe' | 'face'; width: number; height: number };

// Pattern picker assets are surface designs: cover the chosen part on first apply.
// The resulting sticker dimensions remain editable in the adjustment dock.
export function patternSurfaceSize(surface: PatternSurface): { width: number; height: number } {
  return { width: Math.max(1, surface.width), height: Math.max(1, surface.height) };
}
