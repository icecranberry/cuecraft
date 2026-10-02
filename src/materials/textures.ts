import * as THREE from 'three';
import type { MaterialPreset } from './presets';

// 程序化底材纹理：木材／皮革平铺贴片，环绕与轴向双方向无缝（周期化噪声）。
// 颜色贴图 sRGB，法线为数据贴图（plan.md §5.4 颜色管理）。

const TILE = 512;

function makeCanvas(size = TILE) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/** 双向周期化值噪声：px/py 为整格周期 */
function periodicNoise(seed: number, px: number, py: number) {
  const perm = new Uint8Array(512);
  let s = (seed >>> 0) || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  const g = (ix: number, iy: number) => {
    const x = ((ix % px) + px) % px;
    const y = ((iy % py) + py) % py;
    return perm[(perm[x & 255] + y) & 255] / 255;
  };
  const fade = (t: number) => t * t * (3 - 2 * t);
  // 归一化：u,v ∈ [0,1) 映射到格点周期
  return (u: number, v: number) => {
    const x = u * px;
    const y = v * py;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const a = g(xi, yi);
    const b = g(xi + 1, yi);
    const c = g(xi, yi + 1);
    const d = g(xi + 1, yi + 1);
    const uu = fade(xf);
    const vv = fade(yf);
    return a + (b - a) * uu + (c - a) * vv + (a - b - c + d) * uu * vv;
  };
}

function hexToRgb(hex: string) {
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** 木材贴片：底色＋环绕方向木纹条带＋轴向延伸细纹（双向无缝） */
function woodCanvas(preset: MaterialPreset): { color: HTMLCanvasElement; height: HTMLCanvasElement } {
  const color = makeCanvas();
  const height = makeCanvas();
  const ctx = color.getContext('2d')!;
  const hctx = height.getContext('2d')!;
  const img = ctx.createImageData(TILE, TILE);
  const him = hctx.createImageData(TILE, TILE);
  const base = hexToRgb(preset.color);
  const streak = hexToRgb(preset.grainColor ?? '#000000');
  const warpN = periodicNoise(7, 4, 3);
  const fineN = periodicNoise(23, 90, 2);
  const blotchN = periodicNoise(51, 3, 6);
  const BANDS = 13; // 每贴片环绕方向条带数（整数保证无缝）
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const u = x / TILE;
      const v = y / TILE;
      const warp = (warpN(u, v) - 0.5) * 0.16;
      const bandPos = u * BANDS + warp;
      const bands = 0.5 + 0.5 * Math.sin(bandPos * Math.PI * 2);
      const bandSharp = Math.pow(bands, 1.8);
      const fine = fineN(u, v);
      const blotch = (blotchN(u, v) - 0.5) * 0.1;
      const t = Math.min(1, Math.max(0, bandSharp * 0.68 + fine * 0.34 + blotch));
      const i = (y * TILE + x) * 4;
      img.data[i] = base.r + (streak.r - base.r) * t;
      img.data[i + 1] = base.g + (streak.g - base.g) * t;
      img.data[i + 2] = base.b + (streak.b - base.b) * t;
      img.data[i + 3] = 255;
      const h = 130 + t * 80 + fine * 45;
      him.data[i] = him.data[i + 1] = him.data[i + 2] = h;
      him.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  hctx.putImageData(him, 0, 0);
  return { color, height };
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
}

const cache = new Map<string, PresetTextures>();

/** 获取底材平铺贴片（缓存）。repeat 由材质工厂按毫米尺寸设置（clone 共享图像）。 */
export function presetTextures(preset: MaterialPreset): PresetTextures {
  const hit = cache.get(preset.id);
  if (hit) return hit;
  let tex: PresetTextures = {};
  if (preset.type === 'wood') {
    const { color, height } = woodCanvas(preset);
    tex = { map: toTex(color), normalMap: toTex(normalFromHeight(height, 1.1)) };
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
