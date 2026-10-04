/** 选择纹样时保留当前相机视角和部件目标。 */
export function stickerSelectionState(state, id) {
  return {
    selection: { kind: 'sticker', id },
    view: state.view,
    focusPartId: state.focusPartId,
    viewNonce: state.viewNonce
  }
}

/** 纹样选择期间保留左侧最近选中的部件。 */
export function propertyPartAfterSelection(currentPartId, selection) {
  return selection.kind === 'part' && selection.id ? selection.id : currentPartId
}
