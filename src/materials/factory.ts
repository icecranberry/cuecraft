import * as THREE from 'three';
import type { FinishId } from '../core/types';
import type { MaterialPreset } from './presets';
import { finishById } from './presets';
import { presetTextures } from './textures';
import { woodFragmentShader, woodTransform } from './woodMapping';

// 部件材质工厂：底材平铺贴片（毫米重复）＋ 印刷层透明叠加。
// 印刷层通过着色器混入漫反射色，透明处露出底材（plan.md §5.1），
// 与导出合成的印刷内容来自同一份贴纸数据（plan.md §4.3）。

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
  axialOriginMm?: number;
  surface?: 'lathe' | 'face';
}

export function createCueMaterial(params: CueMaterialParams): CueMaterialHandle {
  const p = params.preset;
  let disposed = false;
  const finish = finishById(params.finishId);
  const wood = p.woodTexture;
  const woodUv = wood ? woodTransform(wood, params.circMm, params.lenMm, params.axialOriginMm) : undefined;
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
    const base = presetTextures(p);
    const cloneMap = (source: THREE.Texture) => {
      const map = source.clone();
      if (woodUv) {
        map.rotation = woodUv.rotation;
        map.repeat.copy(woodUv.repeat);
        map.offset.copy(woodUv.offset);
      } else {
        map.repeat.set(Math.max(1, Math.round(params.circMm / LEATHER_TILE_MM)), Math.max(1, Math.round(params.lenMm / LEATHER_TILE_MM)));
      }
      map.needsUpdate = true;
      return map;
    };
    const applyMaps = () => {
      // The user may already have selected another material while images loaded.
      if (disposed || !base.map) return;
      mat.map = cloneMap(base.map);
      mat.map.colorSpace = THREE.SRGBColorSpace;
      if (base.normalMap) {
        mat.normalMap = cloneMap(base.normalMap);
        const strength = wood?.normalStrength ?? 0.42;
        mat.normalScale.set(strength, strength);
        if (wood) {
          // The lacquer follows only a small fraction of the underlying pores.
          mat.clearcoatNormalMap = cloneMap(base.normalMap);
          mat.clearcoatNormalScale.setScalar(wood.coatNormalStrength);
        }
      }
      if (base.roughnessMap) {
        mat.roughnessMap = cloneMap(base.roughnessMap);
        if (wood) mat.clearcoatRoughnessMap = cloneMap(base.roughnessMap);
      }
      mat.color.set(wood?.tint ?? '#ffffff');
      if (params.colorOverride) mat.color.multiply(new THREE.Color(params.colorOverride));
      mat.needsUpdate = true;
    };
    if (base.ready) {
      mat.color.set(p.color);
      if (params.colorOverride) mat.color.multiply(new THREE.Color(params.colorOverride));
      if (base.map) applyMaps();
      else void base.ready.then(applyMaps);
    } else applyMaps();
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
    if (woodUv) {
      shader.uniforms.woodSeamDelta = { value: woodUv.seamDelta };
      shader.uniforms.woodSeamEnabled = { value: params.surface === 'face' ? 0 : 1 };
      shader.fragmentShader = woodFragmentShader(shader.fragmentShader);
    }
  };
  mat.customProgramCacheKey = () => woodUv ? 'cue-print-overlay-wood-pbr-v2' : 'cue-print-overlay';

  return {
    material: mat,
    setPrintMap(tex) {
      printUniform.value = tex ?? placeholder();
    },
    dispose() {
      disposed = true;
      mat.map?.dispose();
      mat.normalMap?.dispose();
      mat.roughnessMap?.dispose();
      mat.clearcoatNormalMap?.dispose();
      mat.clearcoatRoughnessMap?.dispose();
      mat.dispose();
    }
  };
}
