function wrapStickerIds(stickers, assets, segId) {
  const wrapAssetIds = new Set(assets.filter((asset) => asset.kind === 'wrap').map((asset) => asset.id))
  return stickers
    .filter((sticker) => sticker.target.kind === 'lathe' && sticker.target.segId === segId && wrapAssetIds.has(sticker.assetId))
    .map((sticker) => sticker.id)
}

export function withWrapColor(design, segId, color, opacity, assets) {
  const removedIds = new Set(wrapStickerIds(design.stickers, assets, segId))
  return {
    removedIds: [...removedIds],
    design: {
      ...design,
      partOverrides: {
        ...design.partOverrides,
        [segId]: { ...design.partOverrides[segId], color, colorOpacity: opacity }
      },
      stickers: design.stickers.filter((sticker) => !removedIds.has(sticker.id))
    }
  }
}

export function withWrapSticker(design, segId, sticker, assets) {
  const removedIds = new Set(wrapStickerIds(design.stickers, assets, segId))
  const partOverrides = { ...design.partOverrides }
  const override = { ...partOverrides[segId] }
  delete override.color
  delete override.colorOpacity
  if (Object.keys(override).length) partOverrides[segId] = override
  else delete partOverrides[segId]
  return {
    removedIds: [...removedIds],
    design: {
      ...design,
      partOverrides,
      stickers: [...design.stickers.filter((item) => !removedIds.has(item.id)), sticker]
    }
  }
}

export function withoutWrapAppearance(design, segId, assets) {
  const removedIds = new Set(wrapStickerIds(design.stickers, assets, segId))
  const partOverrides = { ...design.partOverrides }
  const override = { ...partOverrides[segId] }
  delete override.color
  delete override.colorOpacity
  if (Object.keys(override).length) partOverrides[segId] = override
  else delete partOverrides[segId]
  const hasColor = design.partOverrides[segId]?.color !== undefined || design.partOverrides[segId]?.colorOpacity !== undefined
  return {
    changed: removedIds.size > 0 || hasColor,
    removedIds: [...removedIds],
    design: {
      ...design,
      partOverrides,
      stickers: design.stickers.filter((sticker) => !removedIds.has(sticker.id))
    }
  }
}
