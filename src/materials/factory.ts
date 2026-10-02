import * as THREE from 'three';
import type { FinishId } from '../core/types';
import type { MaterialPreset } from './presets';
import { finishById } from './presets';
import { presetTextures } from './textures';

// 部件材质工厂：底材平铺贴片（毫米重复）＋ 印刷层透明叠加。
// 印刷层通过着色器混入漫反射色，透明处露出底材（plan.md §5.1），
// 与导出合成的印刷内容来自同一份贴纸数据（plan.md §4.3）。

const WOOD_TILE_MM = 34;
const LEATHER_TILE_MM = 30;

function hexToRgb(hex: string) {
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.split('').map((ch) => ch + ch).join('') : m;
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const placeholder = (() => {
  let tex: THREE.DataTexture | null = null;
  return () => {
    if (!tex) {
      const d = new Uint8Array([0, 0, 0, 0]);
      tex = new THREE.DataTexture(d, 1, 1);
      tex.needsUpdate = true;
    }
    return tex;
  };
})();

export interface CueMaterialHandle {
  material: THREE.MeshPhysicalMaterial;
  setPrintMap(tex: THREE.Texture | null): void;
  dispose(): void;
}

export interface CueMaterialParams {
  preset: MaterialPreset;
  finishId: FinishId;
  colorOverride?: string;
  /** 部件周长与长度（mm），用于底材平铺密度 */
  circMm: number;
  lenMm: number;
}

export function createCueMaterial(params: CueMaterialParams): CueMaterialHandle {
  const p = params.preset;
  const finish = finishById(params.finishId);
  // 深色底材提高环境反射，保证近景下轮廓与细节可辨
  const c = hexToRgb(p.color);
  const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  const envIntensity = p.type === 'metal' ? 1.2 : lum < 0.22 ? 1.05 : 0.72;
  const mat = new THREE.MeshPhysicalMaterial({
    color: params.colorOverride ?? '#ffffff',
    metalness: p.type === 'metal' ? 1 : 0.0,
    roughness: p.roughness ?? finish.roughness,
    clearcoat: p.type === 'metal' ? 0 : finish.clearcoat,
    clearcoatRoughness: finish.clearcoatRoughness,
    envMapIntensity: envIntensity
  });

  if (p.type === 'wood' || p.type === 'leather') {
    const tileMm = p.type === 'wood' ? WOOD_TILE_MM : LEATHER_TILE_MM;
    const base = presetTextures(p);
    const uTiles = Math.max(1, Math.round(params.circMm / tileMm));
    const vTiles = Math.max(1, Math.round(params.lenMm / tileMm));
    if (base.map) {
      const map = base.map.clone();
      map.needsUpdate = true;
      map.repeat.set(uTiles, vTiles);
      map.colorSpace = THREE.SRGBColorSpace;
      mat.map = map;
    }
    if (base.normalMap) {
      const nm = base.normalMap.clone();
      nm.needsUpdate = true;
      nm.repeat.set(uTiles, vTiles);
      mat.normalMap = nm;
      mat.normalScale = new THREE.Vector2(0.42, 0.42);
    }
  } else if (p.type === 'solid') {
    mat.roughness = p.roughness ?? 0.3;
  }

  // 印刷层叠加着色器
  let printUniform = { value: placeholder() as THREE.Texture };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.printMap = printUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPrintUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPrintUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vPrintUv;\nuniform sampler2D printMap;'
      )
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\nvec4 printTex = texture2D(printMap, vPrintUv);\nfloat printA = printTex.a;\ndiffuseColor.rgb = mix(diffuseColor.rgb, printTex.rgb, printA);'
      );
  };
  mat.customProgramCacheKey = () => 'cue-print-overlay';

  return {
    material: mat,
    setPrintMap(tex) {
      printUniform.value = tex ?? placeholder();
      mat.needsUpdate = false;
    },
    dispose() {
      mat.map?.dispose();
      mat.normalMap?.dispose();
      mat.dispose();
    }
  };
}
