import type { Asset, DesignSnapshot, StickerInstance } from '../core/types';

export function withWrapColor(
  design: DesignSnapshot,
  segId: string,
  color: string,
  opacity: number,
  assets: Asset[]
): { design: DesignSnapshot; removedIds: string[] };

export function withWrapSticker(
  design: DesignSnapshot,
  segId: string,
  sticker: StickerInstance,
  assets: Asset[]
): { design: DesignSnapshot; removedIds: string[] };

export function withoutWrapAppearance(
  design: DesignSnapshot,
  segId: string,
  assets: Asset[]
): { design: DesignSnapshot; removedIds: string[]; changed: boolean };
