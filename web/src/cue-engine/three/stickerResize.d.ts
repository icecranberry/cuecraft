import type { StickerInstance } from '../core/types';

export function resizeStickerFromCorner(
  target: StickerInstance['target'],
  startW: number,
  startH: number,
  rotDeg: number,
  corner: number,
  w: number,
  h: number,
  radius?: number
): Pick<StickerInstance, 'w' | 'h' | 'target'>;
