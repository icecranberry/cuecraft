import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_ASSETS, BUILTIN_PATTERNS, BUILTIN_STICKERS, builtinCategories, builtinPatternUrl, filterAssets, mergeBuiltinPatterns } from '../materials/patterns';
import type { Asset } from '../core/types';
import { applyArtworkToDesign, createArtworkScope } from '../cue/artwork';
import { resolveTemplate } from '../cue/templates';
import { useStore } from '../state/store';

vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

describe('系统纹样库', () => {
  it('ships forty patterns and thirty stickers with unique IDs and matching transparent PNGs', () => {
    expect(BUILTIN_PATTERNS.length).toBeGreaterThanOrEqual(40);
    expect(BUILTIN_STICKERS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(BUILTIN_ASSETS.map((a) => a.id)).size).toBe(BUILTIN_ASSETS.length);
    for (const a of BUILTIN_ASSETS) {
      const directory = a.kind === 'sticker' ? 'stickers' : 'patterns';
      const file = readFileSync(`public/${directory}/${a.id.replace('builtin-', '')}.png`);
      expect(file.subarray(1, 4).toString()).toBe('PNG');
      expect(file.readUInt32BE(16)).toBe(a.w);
      expect(file.readUInt32BE(20)).toBe(a.h);
      expect(file[25]).toBe(6); // RGBA, retains generated transparency.
      expect(builtinPatternUrl(a.blobKey)).toContain(`/${directory}/`);
    }
  });

  it('upgrades an existing library idempotently without losing uploads or hidden personal images', () => {
    const personal: Asset = { ...BUILTIN_PATTERNS[0], id: 'personal', blobKey: 'blob:personal', source: 'upload', tags: ['私人'], removed: true };
    const saved = [{ ...BUILTIN_PATTERNS[0], removed: true }, personal];
    const merged = mergeBuiltinPatterns(saved);
    expect(mergeBuiltinPatterns(merged)).toEqual(merged);
    expect(merged.find((a) => a.id === personal.id)).toBe(personal);
    expect(merged.filter((a) => a.source === 'builtin')).toHaveLength(BUILTIN_ASSETS.length);
    expect(merged.find((a) => a.id === BUILTIN_PATTERNS[0].id)?.removed).toBeUndefined();
  });

  it('combines source, category, name and tag filters and handles empty results', () => {
    expect(filterAssets(BUILTIN_PATTERNS, '青玉')).toHaveLength(1);
    expect(filterAssets(BUILTIN_PATTERNS, '  金色  菱形 ', 'builtin').map((a) => a.id)).toContain('builtin-gold-diamond');
    expect(filterAssets(BUILTIN_PATTERNS, '', 'upload')).toEqual([]);
    expect(filterAssets(BUILTIN_PATTERNS, '', 'builtin', '中式纹样').every((a) => a.category === '中式纹样')).toBe(true);
    expect(filterAssets(BUILTIN_PATTERNS, '不存在的纹样')).toEqual([]);
  });

  it('filters stickers independently and searches within their categories', () => {
    expect(filterAssets(BUILTIN_ASSETS, '', 'all', 'all', 'pattern')).toEqual(BUILTIN_PATTERNS);
    expect(filterAssets(BUILTIN_ASSETS, '', 'all', 'all', 'sticker')).toEqual(BUILTIN_STICKERS);
    expect(filterAssets(BUILTIN_ASSETS, '招财', 'builtin', '动物萌趣', 'sticker').map((a) => a.id)).toEqual(['builtin-s-lucky-cat']);
    expect(builtinCategories('sticker')).toEqual(['台球运动', '动物萌趣', '潮流徽饰']);
    expect(filterAssets(BUILTIN_ASSETS, '', 'builtin', '中式纹样', 'sticker')).toEqual([]);
  });

  it.each(['pattern', 'sticker'] as const)('applies a bundled %s with one undoable design change', (kind) => {
    const previous = useStore.getState().design;
    const scope = createArtworkScope(resolveTemplate(previous.cueTemplateId), previous, 'linked', ['butt-forearm', 'butt-cap'], 'decal');
    const asset = (kind === 'pattern' ? BUILTIN_PATTERNS : BUILTIN_STICKERS)[0];
    let i = 0;
    const next = applyArtworkToDesign(previous, scope, { id: 'builtin', partAssets: scope.parts.map((p) => ({ partId: p.id, assetId: asset.id })) }, BUILTIN_ASSETS, { replace: true }, () => `test-${++i}`);
    useStore.setState({ design: previous, past: [], future: [] });
    useStore.getState().pushHistory();
    useStore.getState().set({ design: next });
    expect(next.stickers).toHaveLength(2);
    expect(next.stickers.every((s) => s.assetId === asset.id)).toBe(true);
    useStore.getState().undo();
    expect(useStore.getState().design).toEqual(previous);
  });

  it('loads bundled files without a generation service and retries failed downloads', async () => {
    const { getBlob } = await import('../state/imageStore');
    const asset = BUILTIN_PATTERNS[1];
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('missing', { status: 404 }))
      .mockResolvedValue(new Response(new Blob(['pattern'], { type: 'image/png' }), { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(getBlob(asset.blobKey)).rejects.toThrow('内置纹样未能加载');
    const [a, b] = await Promise.all([getBlob(asset.blobKey), getBlob(asset.blobKey)]);
    expect(a).toBe(b);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith(builtinPatternUrl(asset.blobKey));
  });
});
