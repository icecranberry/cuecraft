export type StickerDropPosition = 'before' | 'after';

export function moveStickerInOrder(
  ids: string[],
  activeId: string,
  targetId: string,
  position: StickerDropPosition
): string[];

import type { StickerInstance } from '../core/types';

export function assignStickerStackOrder(stickers: StickerInstance[], topToBottomIds: string[]): StickerInstance[];
