import type { CueTemplate, PartOverride } from '../core/types';
import { ringOverride } from './ringColors';

/** The rounded tail and barrel are one editable part, including old saved designs. */
export function appearancePartId(id: string) {
  return id === 'face-butt' ? 'butt-cap' : id;
}

export function partAppearance(template: CueTemplate, id: string, overrides: Record<string, PartOverride>) {
  const partId = appearancePartId(id);
  const part = template.segments.find((item) => item.id === partId) ?? template.faces.find((item) => item.id === partId);
  const override = ringOverride(partId, overrides);
  return { partId, override, presetId: override?.matPreset ?? part?.matPreset };
}
