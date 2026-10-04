export function moveStickerInOrder(ids, activeId, targetId, position) {
  if (activeId === targetId) return ids
  const reordered = ids.filter((id) => id !== activeId)
  const targetIndex = reordered.indexOf(targetId)
  if (targetIndex < 0) return ids
  reordered.splice(targetIndex + (position === 'after' ? 1 : 0), 0, activeId)
  return reordered
}

export function assignStickerStackOrder(stickers, topToBottomIds) {
  const zById = new Map(topToBottomIds.map((id, index) => [id, topToBottomIds.length - index]))
  return stickers.map((sticker) => ({ ...sticker, z: zById.get(sticker.id) ?? sticker.z }))
}
