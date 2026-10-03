import { describe, expect, it } from 'vitest';
import { expandedSegments, isDecorativeRing, resolveTemplate } from '../cue/templates';
import { ARTWORK_PRESETS, artworkParts, createArtworkScope } from '../cue/artwork';
import { buildUnfoldTemplate } from '../cue/unwrap';
import { useStore } from '../state/store';
import type { DesignSnapshot } from '../core/types';

const design: DesignSnapshot = { name: '装饰环测试', cueTemplateId: 'nineball', globalFinish: 'gloss', partOverrides: {}, stickers: [] };

describe('optional decorative rings', () => {
  it('allows each ring to be removed independently and restores an individually retained legacy ring', () => {
    for (const id of ['ring-joint', 'ring-deco']) {
      const tpl = resolveTemplate('nineball', true, { [id]: { ringEnabled: false } });
      expect(tpl.segments.filter((s) => isDecorativeRing(s.id))).toHaveLength(1);
      expect(tpl.segments.some((s) => s.id === id)).toBe(false);
      if (id === 'ring-joint') {
        expect(tpl.segments.some((s) => s.id === 'joint')).toBe(false);
        expect(tpl.segments.find((s) => s.id === 'butt-forearm')!.a0).toBe(tpl.shaftLengthMm);
      } else expect(tpl.segments.some((s) => s.id === 'joint')).toBe(true);
      const segments = expandedSegments(tpl);
      for (let i = 1; i < segments.length; i++) {
        expect(segments[i].a0).toBe(segments[i - 1].a1);
        expect(segments[i].r0).toBeCloseTo(segments[i - 1].r1);
      }
    }
    const restored = resolveTemplate('nineball', false, { 'ring-joint': { ringEnabled: true } });
    expect(restored.segments.filter((s) => isDecorativeRing(s.id)).map((s) => s.id)).toEqual(['ring-joint']);
  });
  it('keeps rings on legacy designs but excludes them from all artwork scopes and exports', () => {
    const tpl = resolveTemplate('nineball');
    expect(expandedSegments(tpl).filter((s) => isDecorativeRing(s.id))).toHaveLength(2);
    expect(artworkParts(tpl, design).some((p) => isDecorativeRing(p.id))).toBe(false);
    const preset = ARTWORK_PRESETS.find((p) => p.name === '后把通体')!;
    expect(preset.ids).toEqual(['butt-forearm', 'grip', 'butt-cap']);
    const scope = createArtworkScope(tpl, design, 'linked', [...preset.ids, 'ring-joint', 'ring-deco']);
    expect(scope.parts.map((p) => p.id)).toEqual(preset.ids);
    expect(() => createArtworkScope(tpl, design, 'single', ['ring-deco'])).toThrow();
    const unfolded = buildUnfoldTemplate(tpl, { ppi: 300, bleedMm: 2, overlapMm: 1, rowWidthMm: 200, mirror: false });
    expect(unfolded.blocks.some((b) => isDecorativeRing(b.segId))).toBe(false);
  });

  it('fills removed rings with continuous wood without changing length, taper or the source template', () => {
    const original = resolveTemplate('nineball');
    const without = resolveTemplate('nineball', false);
    const segments = expandedSegments(without);
    expect(segments.some((s) => isDecorativeRing(s.id))).toBe(false);
    expect(without.lengthMm).toBe(original.lengthMm);
    expect(segments.at(-1)!.a1).toBe(original.lengthMm);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].a0).toBe(segments[i - 1].a1);
      expect(segments[i].r0).toBeCloseTo(segments[i - 1].r1);
    }
    expect(segments.find((s) => s.id === 'butt-forearm')).toMatchObject({ a0: 737, a1: 1150, matPreset: 'maple' });
    expect(original.segments.find((s) => s.id === 'butt-forearm')).toMatchObject({ a0: 758, a1: 1142 });
    const printable = artworkParts(without, { ...design, decorativeRings: false });
    expect(printable.find((p) => p.id === 'butt-forearm')!.hMm).toBe(413);
  });

  it('saves the option in the design, preserves materials and supports undo/redo', () => {
    const before = { ...design, partOverrides: { 'ring-deco': { matPreset: 'stainless' } } };
    useStore.setState({ design: before, past: [], future: [], loaded: false });
    useStore.getState().setDecorativeRings(false);
    expect(useStore.getState().design.decorativeRings).toBe(false);
    expect(JSON.parse(JSON.stringify(useStore.getState().design)).decorativeRings).toBe(false);
    expect(useStore.getState().design.partOverrides).toEqual(before.partOverrides);
    useStore.getState().setDecorativeRings(false);
    expect(useStore.getState().past).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().design).toEqual(before);
    useStore.getState().redo();
    expect(useStore.getState().design.decorativeRings).toBe(false);
    useStore.getState().setDecorativeRings(true);
    expect(useStore.getState().design.partOverrides).toEqual(before.partOverrides);
  });
});
