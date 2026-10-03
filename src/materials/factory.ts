import * as THREE from 'three';
import type { FinishId, PartKind } from '../core/types';
import type { MaterialPreset } from './presets';
import { finishById, supportsLacquer } from './presets';
import { presetTextures } from './textures';
import { woodFragmentShader, woodTransform } from './woodMapping';

// 部件材质工厂：底材平铺贴片（毫米重复）＋ 印刷层透明叠加。
// 印刷层通过着色器混入漫反射色，透明处露出底材（plan.md §5.1），
// 与导出合成的印刷内容来自同一份贴纸数据（plan.md §4.3）。

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
  ready: Promise<void>;
  setPrintMap(tex: THREE.Texture | null): void;
  setContinuationMap(tex: THREE.Texture | null): void;
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
  partKind?: PartKind;
}

export function createCueMaterial(params: CueMaterialParams): CueMaterialHandle {
  const p = params.preset;
  let disposed = false;
  let ready = Promise.resolve();
  const finish = finishById(params.finishId);
  const wood = p.woodTexture;
  const woodUv = wood ? woodTransform(wood, params.circMm, params.lenMm, params.axialOriginMm) : undefined;
  const lacquer = supportsLacquer(p);
  const shaft = p.type === 'wood' && params.partKind === 'shaft';
  const woodFace = p.type === 'wood' && params.surface === 'face' && params.partKind !== 'butt';
  const tintedTexture = p.type === 'wood' || p.type === 'leather';
  // Preserve saved overrides: wood/leather use a tint, metals/solids use the chosen color.
  const baseColor = new THREE.Color(tintedTexture ? p.color : params.colorOverride ?? p.color);
  if (tintedTexture && params.colorOverride) baseColor.multiply(new THREE.Color(params.colorOverride));
  // 深色底材提高环境反射，保证近景下轮廓与细节可辨
  const c = hexToRgb(p.color);
  const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  const envIntensity = p.type === 'metal' ? 1.2 : lum < 0.22 ? 1.05 : 0.72;
  const mat = new THREE.MeshPhysicalMaterial({
    color: baseColor,
    metalness: p.metalness ?? (p.type === 'metal' ? 1 : 0),
    roughness: lacquer ? Math.max(finish.roughness, shaft ? 0.46 : woodFace ? 0.5 : 0) : p.roughness ?? 0.5,
    clearcoat: lacquer ? finish.clearcoat * (shaft ? 0.16 : woodFace ? 0.45 : 1) : 0,
    clearcoatRoughness: shaft ? Math.max(0.32, finish.clearcoatRoughness) : finish.clearcoatRoughness,
    anisotropy: params.surface === 'face' ? 0 : p.anisotropy ?? 0,
    envMapIntensity: p.type === 'leather' ? 0.65 : envIntensity
  });

  if (wood || p.surfaceTexture) {
    const base = presetTextures(p);
    const cloneMap = (source: THREE.Texture) => {
      const map = source.clone();
      if (woodUv) {
        map.rotation = woodUv.rotation;
        map.repeat.copy(woodUv.repeat);
        map.offset.copy(woodUv.offset);
      } else {
        const tileMm = p.surfaceTexture!.tileMm;
        // Close the circumference; keep axial density independent of part length.
        map.repeat.set(Math.max(1, Math.round(params.circMm / tileMm)), params.lenMm / tileMm);
        map.offset.y = (params.axialOriginMm ?? 0) / tileMm;
      }
      map.needsUpdate = true;
      return map;
    };
    const applyMaps = () => {
      // The user may already have selected another material while images loaded.
      if (disposed) return;
      if (base.map) {
        mat.map = cloneMap(base.map);
        mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.color.copy(wood ? new THREE.Color(wood.tint ?? '#ffffff') : new THREE.Color(p.color));
        // End grain needs a restrained satin response, rather than a dark lacquer mirror.
        if (woodFace) mat.color.multiplyScalar(1.8);
        if (params.colorOverride) mat.color.multiply(new THREE.Color(params.colorOverride));
      }
      if (base.normalMap) {
        mat.normalMap = cloneMap(base.normalMap);
        const strength = wood?.normalStrength ?? p.surfaceTexture?.normalStrength ?? 0.42;
        mat.normalScale.setScalar(strength * (woodFace ? 0.35 : 1));
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
      mat.needsUpdate = true;
    };
    if (base.ready) {
      if (base.map) applyMaps();
      else ready = base.ready.then(applyMaps);
    } else applyMaps();
  }

  // 印刷层叠加着色器
  let printUniform = { value: placeholder() as THREE.Texture };
  const continuationUniform = { value: placeholder() as THREE.Texture };
  const tail = params.surface === 'face' && params.partKind === 'butt';
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
    if (tail) {
      shader.uniforms.tailPrintMap = continuationUniform;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 uvTail;\nvarying vec2 vTailPrintUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvTailPrintUv = uvTail;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tailPrintMap;\nvarying vec2 vTailPrintUv;').replace('vec4 printTex = texture2D(printMap, vPrintUv);', 'vec4 tailTex = texture2D(tailPrintMap, vTailPrintUv);\ndiffuseColor.rgb = mix(diffuseColor.rgb, tailTex.rgb, tailTex.a);\nvec4 printTex = texture2D(printMap, vPrintUv);');
    }
    if (woodUv) {
      shader.uniforms.woodSeamDelta = { value: woodUv.seamDelta };
      shader.uniforms.woodSeamEnabled = { value: params.surface === 'face' ? 0 : 1 };
      shader.fragmentShader = woodFragmentShader(shader.fragmentShader);
    }
  };
  mat.customProgramCacheKey = () => (woodUv ? 'cue-print-overlay-wood-pbr-v2' : 'cue-print-overlay') + (tail ? '-tail-wrap-v1' : '');

  return {
    material: mat,
    ready,
    setPrintMap(tex) {
      printUniform.value = tex ?? placeholder();
    },
    setContinuationMap(tex) {
      continuationUniform.value = tex ?? placeholder();
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
