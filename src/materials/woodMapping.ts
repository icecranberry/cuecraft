import * as THREE from 'three';
import type { MaterialPreset } from './presets';

type Wood = NonNullable<MaterialPreset['woodTexture']>;

/** Crop the square scan at equal mm/texel in both directions, including narrow parts. */
export function woodTransform(wood: Wood, widthMm: number, lengthMm: number, axialOriginMm = 0) {
  const around = widthMm / wood.sizeMm;
  const along = lengthMm / wood.sizeMm;
  const phase = axialOriginMm / wood.sizeMm;
  return {
    rotation: wood.horizontal ? Math.PI / 2 : 0,
    repeat: new THREE.Vector2(wood.horizontal ? along : around, wood.horizontal ? around : along),
    // Sample a central strip instead of squeezing the entire scan onto the cue.
    offset: new THREE.Vector2(wood.horizontal ? phase : 0.42, wood.horizontal ? 0.42 : phase),
    seamDelta: new THREE.Vector2(wood.horizontal ? 0 : around, wood.horizontal ? -around : 0)
  };
}

/** Blend only the last 8% of the circumference into its starting edge, on all PBR channels. */
export function woodFragmentShader(fragment: string) {
  let result = fragment.replace('#include <common>', `#include <common>
    uniform vec2 woodSeamDelta;
    uniform float woodSeamEnabled;
    vec4 sampleWood(sampler2D tex, vec2 coord, float around) {
      vec4 a = texture2D(tex, coord);
      if (woodSeamEnabled < 0.5) return a;
      vec4 b = texture2D(tex, coord - woodSeamDelta);
      return mix(a, b, smoothstep(0.92, 1.0, around));
    }
  `);
  const chunks = [
    ['map_fragment', 'map', 'vMapUv'],
    ['normal_fragment_maps', 'normalMap', 'vNormalMapUv'],
    ['clearcoat_normal_fragment_maps', 'clearcoatNormalMap', 'vClearcoatNormalMapUv']
  ] as const;
  for (const [chunk, sampler, uv] of chunks) {
    result = result.replace(`#include <${chunk}>`, THREE.ShaderChunk[chunk].replaceAll(
      `texture2D( ${sampler}, ${uv} )`, `sampleWood(${sampler}, ${uv}, vPrintUv.x)`
    ));
  }
  result = result.replace('#include <roughnessmap_fragment>', `
    float roughnessFactor = roughness;
    #ifdef USE_ROUGHNESSMAP
      roughnessFactor = clamp(roughness * mix(0.72, 1.28,
        sampleWood(roughnessMap, vRoughnessMapUv, vPrintUv.x).g), 0.04, 1.0);
    #endif
  `);
  return result.replace('#include <lights_physical_fragment>', THREE.ShaderChunk.lights_physical_fragment.replace(
    'texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y',
    'mix(0.85, 1.15, sampleWood(clearcoatRoughnessMap, vClearcoatRoughnessMapUv, vPrintUv.x).g)'
  ));
}
