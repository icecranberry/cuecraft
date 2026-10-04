export function stickerPaintOrder(stickers) {
  return [...stickers].sort((a, b) => a.z - b.z)
}
