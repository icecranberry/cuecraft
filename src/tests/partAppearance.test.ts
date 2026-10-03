import { describe, expect, it } from 'vitest';
import { appearancePartId, partAppearance } from '../cue/partAppearance';
import { resolveTemplate } from '../cue/templates';
import { useStore } from '../state/store';

describe('continuous butt appearance', () => {
  const template = resolveTemplate('nineball');
  it('uses the barrel material, tint and finish even when a saved cap has different settings', () => {
    const overrides = { 'butt-cap': { matPreset: 'rosewood', color: '#abcdef', finish: 'matte' as const }, 'face-butt': { matPreset: 'rubber', color: '#000000', finish: 'gloss' as const } };
    expect(partAppearance(template, 'face-butt', overrides)).toEqual(partAppearance(template, 'butt-cap', overrides));
    expect(partAppearance(template, 'face-butt', overrides).override).toBe(overrides['butt-cap']);
    expect(partAppearance(template, 'face-butt', { 'face-butt': overrides['face-butt'] }).presetId).toBe('ebony');
    expect(appearancePartId('face-tip')).toBe('face-tip');
  });
  it('routes cap selection and edits to the barrel, with undo and redo retaining the shared appearance', () => {
    useStore.setState({ design: { name: 'test', cueTemplateId: 'nineball', globalFinish: 'gloss', stickers: [], partOverrides: {} }, past: [], future: [], loaded: false });
    const store = useStore.getState();
    store.select({ kind: 'part', id: 'face-butt' });
    expect(useStore.getState().selection.id).toBe('butt-cap');
    store.focusPart('face-butt');
    expect(useStore.getState().focusPartId).toBe('butt-cap');
    store.pushHistory();
    store.setPartOverride('face-butt', { matPreset: 'maple', finish: 'semi', color: '#ffbb88' });
    const overrides = useStore.getState().design.partOverrides;
    expect(overrides['face-butt']).toBeUndefined();
    expect(partAppearance(template, 'face-butt', overrides).override).toMatchObject({ matPreset: 'maple', finish: 'semi', color: '#ffbb88' });
    store.undo();
    expect(partAppearance(template, 'face-butt', useStore.getState().design.partOverrides).presetId).toBe('ebony');
    store.redo();
    expect(partAppearance(template, 'face-butt', useStore.getState().design.partOverrides).presetId).toBe('maple');
  });
});
