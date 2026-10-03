import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createCueMaterial } from '../materials/factory';
import { MATERIAL_PRESETS, presetById } from '../materials/presets';
import { presetTextures, type PresetTextures } from '../materials/textures';
import { woodTransform } from '../materials/woodMapping';

afterEach(() => vi.restoreAllMocks());

describe('scanned wood materials', () => {
  it.each(['ash', 'maple', 'ebony', 'rosewood'])('%s keeps equal grain scale around and along the cue, with continuous axial sampling', (id) => {
    const wood = presetById(id).woodTexture!;
    const sample = (width: number, length: number, origin: number, u: number, v: number) => {
      const t = woodTransform(wood, width, length, origin);
      const matrix = new THREE.Matrix3().setUvTransform(t.offset.x, t.offset.y, t.repeat.x, t.repeat.y, t.rotation, 0, 0);
      return new THREE.Vector2(u, v).applyMatrix3(matrix);
    };
    for (const circumference of [41, 68, 98]) {
      const start = sample(circumference, 700, 10, 0, 0);
      const across5mm = sample(circumference, 700, 10, 5 / circumference, 0).distanceTo(start);
      const along5mm = sample(circumference, 700, 10, 0, 5 / 700).distanceTo(start);
      expect(across5mm).toBeCloseTo(along5mm, 10);
      // Only crop the narrow strip needed by this diameter, never force a whole tile.
      expect(sample(circumference, 700, 10, 1, 0).distanceTo(start)).toBeLessThan(0.2);
      expect(sample(circumference, 700, 10, 0.3, 1).distanceTo(sample(circumference, 5, 710, 0.3, 0))).toBeLessThan(1e-10);
      const end = sample(circumference, 700, 10, 1, 0);
      end.sub(woodTransform(wood, circumference, 700, 10).seamDelta);
      expect(end.distanceTo(start)).toBeLessThan(1e-10);
    }
  });

  it('all wood presets have bundled color, normal and roughness assets with verified hashes', async () => {
    const { readFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const root = new URL('../../public/textures/wood/', import.meta.url);
    const records = JSON.parse(readFileSync(new URL('provenance.json', root), 'utf8'));
    for (const preset of MATERIAL_PRESETS.filter((p) => p.type === 'wood')) {
      expect(preset.woodTexture).toBeDefined();
      for (const kind of ['color', 'normal', 'roughness']) {
        const file = `${preset.woodTexture!.id}-${kind}.jpg`;
        const record = records.find((r: { file: string }) => r.file === file);
        expect(record.license).toBe('CC0-1.0');
        expect(createHash('md5').update(readFileSync(new URL(file, root))).digest('hex')).toBe(record.md5);
      }
    }
  });

  it('shares loaded images, keeps independent UVs, and ignores disposed materials during loading', async () => {
    const pending: ((texture: THREE.Texture) => void)[] = [];
    const loader = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const preset = { ...presetById('ash'), id: 'test-async-ash' };
    const make = (lenMm: number) => createCueMaterial({ preset, finishId: 'matte', circMm: 80, lenMm });
    const old = make(700);
    const current = make(350);
    const ring = make(5);
    const colorBefore = current.material.color.getHexString();
    old.dispose();
    pending.forEach((resolve) => resolve(new THREE.Texture()));
    await presetTextures(preset).ready;
    expect(loader).toHaveBeenCalledTimes(3);
    expect(old.material.map).toBeNull();
    expect(current.material.map).not.toBeNull();
    expect(current.material.color.getHexString()).not.toBe(colorBefore);
    expect(current.material.map).not.toBe(ring.material.map);
    expect(current.material.map!.source).toBe(ring.material.map!.source);
    expect(current.material.map!.repeat.x / ring.material.map!.repeat.x).toBeCloseTo(70);
    expect(current.material.map!.rotation).toBeCloseTo(Math.PI / 2);
    expect(current.material.normalMap!.repeat.toArray()).toEqual(current.material.map!.repeat.toArray());
    expect(current.material.roughnessMap!.repeat.toArray()).toEqual(current.material.map!.repeat.toArray());
    expect(current.material.clearcoatNormalMap!.repeat.toArray()).toEqual(current.material.map!.repeat.toArray());
    expect(current.material.clearcoatRoughnessMap!.offset.toArray()).toEqual(current.material.map!.offset.toArray());
    expect(current.material.clearcoatNormalScale.x).toBeLessThan(current.material.normalScale.x);
    expect(current.material.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(current.material.normalMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(current.material.roughness).toBe(0.62);
    const sharedDispose = vi.spyOn(presetTextures(preset).map!, 'dispose');
    const localDispose = vi.spyOn(current.material.roughnessMap!, 'dispose');
    const coatDispose = vi.spyOn(current.material.clearcoatNormalMap!, 'dispose');
    current.dispose();
    expect(localDispose).toHaveBeenCalledOnce();
    expect(coatDispose).toHaveBeenCalledOnce();
    expect(sharedDispose).not.toHaveBeenCalled();
    ring.dispose();
  });

  it('retains base color on failure, releases partial loads and allows retry', async () => {
    const loaded = new THREE.Texture();
    const dispose = vi.spyOn(loaded, 'dispose');
    const loader = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync')
      .mockResolvedValueOnce(loaded).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new THREE.Texture());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const preset = { ...presetById('maple'), id: 'test-failed-maple' };
    const handle = createCueMaterial({ preset, finishId: 'gloss', circMm: 80, lenMm: 700 });
    const base: PresetTextures = presetTextures(preset);
    await base.ready;
    expect(handle.material.map).toBeNull();
    expect(handle.material.color.getHexString()).toBe(preset.color.slice(1));
    expect(dispose).toHaveBeenCalledOnce();
    loader.mockImplementation(async () => new THREE.Texture());
    const retry = presetTextures(preset);
    await retry.ready;
    expect(retry.map).toBeDefined();
    expect(retry).not.toBe(base);
    handle.dispose();
  });
});
