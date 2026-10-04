import type { Selection } from './store';

type View = 'whole' | 'shaft' | 'butt' | 'joint' | 'face' | 'focus';

export function stickerSelectionState(
  state: { view: View; focusPartId: string | null; viewNonce: number },
  id: string
): { selection: Selection; view: View; focusPartId: string | null; viewNonce: number };

export function propertyPartAfterSelection(currentPartId: string | null, selection: Selection): string | null;
