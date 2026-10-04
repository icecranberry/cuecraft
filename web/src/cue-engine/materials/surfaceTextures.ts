import * as THREE from 'three';
import type { MaterialPreset } from './presets';

type SurfaceKind = NonNullable<MaterialPreset['surfaceTexture']>['kind'];
const TAU = Math.PI * 2;

function hash(x: number, y: number, period: number) {
  const xx = ((x % period) + period) % period;
  const yy = ((y % period) + period) % period;
  let n = Math.imul(xx + 19, 374761393) ^ Math.imul(yy + 71, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/** Periodic value noise: color, height and roughness share the same features. */
function noise(u: number, v: number, cells: number) {
  const x = u * cells, y = v * cells;
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const bottom = THREE.MathUtils.lerp(hash(ix, iy, cells), hash(ix + 1, iy, cells), sx);
  const top = THREE.MathUtils.lerp(hash(ix, iy + 1, cells), hash(ix + 1, iy + 1, cells), sx);
  return THREE.MathUtils.lerp(bottom, top, sy);
}

function rgba(data: Uint8Array, index: number, r: number, g = r, b = r) {
  data[index] = Math.round(THREE.MathUtils.clamp(r, 0, 1) * 255);
  data[index + 1] = Math.round(THREE.MathUtils.clamp(g, 0, 1) * 255);
  data[index + 2] = Math.round(THREE.MathUtils.clamp(b, 0, 1) * 255);
  data[index + 3] = 255;
}

/** Neutral albedo modulation; the material holds the preset color and any user tint. */
export function generateSurfaceTile(kind: SurfaceKind, size = 512) {
  const color = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const grain = noise(u, v, 32), fine = noise(u, v, 128);
      let h: number, shade: number, rough: number;
      if (kind === 'linen') {
        // Circumferential yarns with a slight helical lay and finer twisted fibers.
        const yarn = 0.5 + 0.5 * Math.cos(TAU * (24 * v + u));
        const fiber = Math.sin(TAU * (192 * u + 12 * v));
        h = 0.35 + 0.25 * yarn + 0.035 * fiber + 0.025 * fine;
        shade = 0.82 + 0.14 * yarn + 0.04 * fine;
        rough = 0.9 + 0.1 * grain;
      } else if (kind === 'turned-metal') {
        const tool = 0.5 + 0.5 * Math.cos(TAU * (64 * v + 0.04 * Math.sin(TAU * u)));
        h = 0.48 + 0.045 * tool + 0.01 * fine;
        shade = 1;
        rough = 0.84 + 0.16 * tool;
      } else if (kind === 'tip') {
        h = 0.46 + 0.12 * fine + 0.035 * grain;
        shade = 0.87 + 0.09 * fine + 0.04 * grain;
        rough = 0.96 + 0.04 * grain;
      } else {
        // Soft irregular grain, without the old repeated round crater pattern.
        h = 0.43 + 0.16 * grain + 0.055 * fine;
        shade = 0.88 + 0.09 * grain + 0.03 * fine;
        rough = 0.86 + 0.14 * grain;
      }
      const index = (y * size + x) * 4;
      height[y * size + x] = h;
      rgba(color, index, shade);
      rgba(roughness, index, rough);
    }
  }
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.4;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.4;
      const len = Math.hypot(dx, dy, 1);
      rgba(normal, (y * size + x) * 4, 0.5 - dx / len * 0.5, 0.5 - dy / len * 0.5, 0.5 + 0.5 / len);
    }
  }
  return { color, normal, roughness, size };
}

function dataTexture(data: ReturnType<typeof generateSurfaceTile>['color'], size: number, colorSpace: THREE.ColorSpace = THREE.NoColorSpace) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = colorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function createSurfaceTextures(kind: SurfaceKind) {
  const tile = generateSurfaceTile(kind);
  return {
    map: kind === 'turned-metal' ? undefined : dataTexture(tile.color, tile.size, THREE.SRGBColorSpace),
    normalMap: dataTexture(tile.normal, tile.size),
    roughnessMap: dataTexture(tile.roughness, tile.size)
  };
}
