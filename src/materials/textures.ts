import * as THREE from 'three';
import type { MaterialPreset } from './presets';

// 木材使用本地 CC0 扫描素材，皮革保留程序化贴片。
// 颜色贴图 sRGB，法线为数据贴图（plan.md §5.4 颜色管理）。

const TILE = 512;

function makeCanvas(size = TILE) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/** 皮革贴片：颗粒压痕（点以 3×3 平铺复制保证周期） */
function leatherCanvas(preset: MaterialPreset): { color: HTMLCanvasElement; height: HTMLCanvasElement } {
  const color = makeCanvas();
  const height = makeCanvas();
  const ctx = color.getContext('2d')!;
  const hctx = height.getContext('2d')!;
  ctx.fillStyle = preset.color;
  ctx.fillRect(0, 0, TILE, TILE);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, TILE, TILE);
  let s = 424242;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * TILE;
    const y = rnd() * TILE;
    const r = 1.2 + rnd() * 3.2;
    for (const ox of [-TILE, 0, TILE]) {
      for (const oy of [-TILE, 0, TILE]) {
        ctx.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.06})`;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
        hctx.fillStyle = 'rgba(40,40,40,0.5)';
        hctx.beginPath();
        hctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        hctx.fill();
      }
    }
  }
  return { color, height };
}

/** 由高度图生成法线贴图（数据贴图，不参与 sRGB） */
function normalFromHeight(height: HTMLCanvasElement, strength = 1.4): HTMLCanvasElement {
  const size = height.width;
  const hctx = height.getContext('2d')!;
  const src = hctx.getImageData(0, 0, size, size).data;
  const out = makeCanvas(size);
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(size, size);
  const at = (x: number, y: number) => {
    const xi = (x + size) % size;
    const yi = (y + size) % size;
    return src[(yi * size + xi) * 4] / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

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
  } else if (preset.type === 'leather') {
    const { color, height } = leatherCanvas(preset);
    tex = { map: toTex(color), normalMap: toTex(normalFromHeight(height, 2.4)) };
  }
  cache.set(preset.id, tex);
  return tex;
}

function toTex(c: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
