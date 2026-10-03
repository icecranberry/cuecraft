import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { StickerInstance } from '../core/types';
import { tailPrintSegment } from '../cue/tailPrint';
import { expandedSegments, resolveTemplate } from '../cue/templates';
import { buildDisplayFaceGeometry } from '../cue/displayGeometry';
import { stickerOverlapsSegment } from '../cue/mapping';
import { composeSegmentPrint, getStickerImage } from '../stickers/composite';
import { createCueMaterial } from '../materials/factory';
import { presetById } from '../materials/presets';

vi.mock('../state/imageStore', () => ({ blobToCanvas: vi.fn(async () => ({ width: 2, height: 2, getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(16).fill(255) }) }) })) }));
afterEach(() => vi.unstubAllGlobals());

describe('tail artwork continuation', () => {
  const template = resolveTemplate('nineball');
  const strip = tailPrintSegment(template)!;
  const sticker: StickerInstance = { id: 'tail', name: 'tail', assetId: 'tail', processedRev: 0, target: { kind: 'lathe', segId: 'butt-cap', a: template.lengthMm - 5, angDeg: 180 }, w: 20, h: 70, rotDeg: 0, flipX: false, flipY: false, opacity: 0.6, z: 1, hidden: false, locked: false };
  it('continues along the cap arc, matching circumference and angle at the join', () => {
    const face = template.faces.find((part) => part.id === 'face-butt')!;
    expect(strip.a0).toBe(face.a);
    expect(strip.a1 - strip.a0).toBeCloseTo(face.radius * Math.PI / 2);
    const geometry = buildDisplayFaceGeometry(face);
    const uv = geometry.getAttribute('uvTail');
    expect(uv.getY(0)).toBe(1);
    expect(uv.getX(32 * 97 + 48)).toBe(0.5);
    expect(uv.getY(32 * 97 + 48)).toBe(0);
    geometry.dispose();
    expect(stickerOverlapsSegment(sticker, strip)).toBe(true);
    expect(stickerOverlapsSegment({ ...sticker, hidden: true }, strip)).toBe(false);
    expect(stickerOverlapsSegment({ ...sticker, h: 4 }, strip)).toBe(false);
  });
  it('draws the original source beyond the barrel edge, preserving opacity and rotation', async () => {
    await getStickerImage(sticker);
    const ctx = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), globalAlpha: 1 };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
    composeSegmentPrint(strip, [sticker], 4, 4096, expandedSegments(template));
    expect(ctx.translate).toHaveBeenCalledWith(expect.any(Number), -20);
    expect(ctx.drawImage).toHaveBeenCalledOnce();
    expect(ctx.globalAlpha).toBe(0.6);
    expect(ctx.rotate).toHaveBeenCalledWith(0);
  });
  it('keeps continuation and independent legacy face artwork in separate shader layers', () => {
    const cap = createCueMaterial({ preset: presetById('redSolid'), finishId: 'semi', surface: 'face', partKind: 'butt', circMm: 31.4, lenMm: 31.4 });
    const body = createCueMaterial({ preset: presetById('redSolid'), finishId: 'semi', partKind: 'butt', circMm: 98, lenMm: 122 });
    const texture = new THREE.Texture();
    cap.setContinuationMap(texture);
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <uv_vertex>', fragmentShader: '#include <common>\n#include <map_fragment>' } as unknown as Parameters<typeof cap.material.onBeforeCompile>[0];
    cap.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.tailPrintMap.value).toBe(texture);
    expect(shader.vertexShader).toContain('attribute vec2 uvTail');
    expect(shader.fragmentShader.indexOf('vec4 tailTex')).toBeLessThan(shader.fragmentShader.indexOf('vec4 printTex'));
    expect(cap.material.customProgramCacheKey()).not.toBe(body.material.customProgramCacheKey());
    cap.setContinuationMap(null);
    expect(shader.uniforms.tailPrintMap.value).not.toBe(texture);
    cap.dispose(); body.dispose(); texture.dispose();
  });
});
