import * as THREE from 'three';
import type { MaterialPreset } from './presets';
import { createSurfaceTextures } from './surfaceTextures';

// 木材使用本地 CC0 扫描素材，其余表面使用按加工工艺区分的程序化贴片。
// 颜色贴图 sRGB，法线为数据贴图（plan.md §5.4 颜色管理）。

export interface PresetTextures {
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  ready?: Promise<void>;
}

const cache = new Map<string, PresetTextures>();

/** 获取底材平铺贴片（缓存）。repeat 由材质工厂按毫米尺寸设置（clone 共享图像）。 */
export function presetTextures(preset: MaterialPreset): PresetTextures {
  const hit = cache.get(preset.id);
  if (hit) return hit;
  let tex: PresetTextures = {};
  if (preset.type === 'wood' && preset.woodTexture) {
    const id = preset.woodTexture.id;
    const loader = new THREE.TextureLoader();
    const load = async (kind: string, colorSpace: THREE.ColorSpace = THREE.NoColorSpace) => {
      const t = await loader.loadAsync(`${import.meta.env.BASE_URL}textures/wood/${id}-${kind}.jpg`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.colorSpace = colorSpace;
      return t;
    };
    // Resolve even on failure: keep the solid fallback and allow a later retry.
    // allSettled ensures successful members can be released if one map fails.
    tex.ready = Promise.allSettled([
      load('color', THREE.SRGBColorSpace), load('normal'), load('roughness')
    ]).then((results) => {
      if (results.some((r) => r.status === 'rejected')) {
        results.forEach((r) => { if (r.status === 'fulfilled') r.value.dispose(); });
        cache.delete(preset.id);
        console.warn(`木材贴图加载失败：${preset.name}，暂用底色。`);
        return;
      }
      const maps = results.map((r) => (r as PromiseFulfilledResult<THREE.Texture>).value);
      [tex.map, tex.normalMap, tex.roughnessMap] = maps;
    });
  } else if (preset.surfaceTexture) {
    tex = createSurfaceTextures(preset.surfaceTexture.kind);
  }
  cache.set(preset.id, tex);
  return tex;
}
