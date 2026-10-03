import { describe, expect, it } from 'vitest';
import { ringOverride } from '../cue/ringColors';
import { useStore } from '../state/store';

describe('ring colors', () => {
  it('unifies legacy joint colors and removes tint while leaving other parts alone', () => {
    const overrides = { joint: { matPreset: 'stainless', color: '#ff0000' }, 'ring-joint': { matPreset: 'brass' }, shaft: { color: '#123456' } };
    expect(ringOverride('joint', overrides)).toMatchObject({ matPreset: 'brass', color: undefined });
    expect(ringOverride('ring-joint', overrides)?.matPreset).toBe('brass');
    expect(ringOverride('shaft', overrides)).toBe(overrides.shaft);
    expect(ringOverride('joint', {})?.matPreset).toBe(ringOverride('ring-joint', {})?.matPreset);
  });
  it('synchronizes from either joint piece, preserves ring visibility, and supports undo/redo', () => {
    useStore.setState({ design: { name: 'test', cueTemplateId: 'nineball', globalFinish: 'gloss', stickers: [], partOverrides: { 'ring-joint': { ringEnabled: false }, 'ring-deco': { matPreset: 'brass' } } }, past: [], future: [], loaded: false });
    for (const id of ['joint', 'ring-joint']) {
      useStore.getState().pushHistory();
      useStore.getState().setPartOverride(id, { matPreset: 'stainless' });
      const overrides = useStore.getState().design.partOverrides;
      expect(overrides.joint.matPreset).toBe('stainless');
      expect(overrides['ring-joint']).toMatchObject({ matPreset: 'stainless', ringEnabled: false });
      expect(overrides['ring-deco'].matPreset).toBe('brass');
      useStore.getState().undo();
      expect(useStore.getState().design.partOverrides.joint).toBeUndefined();
      useStore.getState().redo();
      expect(ringOverride('joint', useStore.getState().design.partOverrides)?.matPreset).toBe('stainless');
      useStore.getState().undo();
    }
  });
});
