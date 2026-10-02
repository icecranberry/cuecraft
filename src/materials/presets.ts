import type { FinishId } from '../core/types';

// 底材预设（plan.md §5.2）。颜色与纹理为可调整预设，正式生产前依据工厂样杆校准（plan.md §5.3）。

export interface MaterialPreset {
  id: string;
  name: string;
  type: 'wood' | 'metal' | 'leather' | 'solid';
  color: string;
  grainColor?: string;
  grainScaleMm?: number;
  metalness?: number;
  roughness?: number;
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  { id: 'ash', name: '白蜡木', type: 'wood', color: '#d9c69c', grainColor: '#8f7350', grainScaleMm: 22 },
  { id: 'maple', name: '枫木', type: 'wood', color: '#e6d3ac', grainColor: '#c9ab7c', grainScaleMm: 18 },
  { id: 'ebony', name: '乌木（深色）', type: 'wood', color: '#2f271f', grainColor: '#171009', grainScaleMm: 26 },
  { id: 'rosewood', name: '红木', type: 'wood', color: '#6b3a26', grainColor: '#4a2417', grainScaleMm: 24 },
  { id: 'stainless', name: '不锈钢', type: 'metal', color: '#c9ccd2', metalness: 1, roughness: 0.3 },
  { id: 'brass', name: '黄铜', type: 'metal', color: '#c8a44e', metalness: 1, roughness: 0.32 },
  { id: 'blackmetal', name: '黑金（电镀）', type: 'metal', color: '#2a2a2e', metalness: 1, roughness: 0.22 },
  { id: 'leather', name: '皮革握把', type: 'leather', color: '#4a3327', roughness: 0.72 },
  { id: 'irishWrap', name: '亚麻缠线', type: 'leather', color: '#7a6a54', roughness: 0.8 },
  { id: 'ivory', name: '尼龙白（先角）', type: 'solid', color: '#efe9dc', roughness: 0.25 },
  { id: 'tipLeather', name: '皮头（蓝）', type: 'leather', color: '#3d5aa8', roughness: 0.85 },
  { id: 'whiteSolid', name: '纯色（白）', type: 'solid', color: '#f2f2ee', roughness: 0.3 },
  { id: 'redSolid', name: '纯色（酒红）', type: 'solid', color: '#7c2230', roughness: 0.3 },
  { id: 'blackSolid', name: '纯色（黑）', type: 'solid', color: '#141414', roughness: 0.3 }
];

export function presetById(id: string): MaterialPreset {
  return MATERIAL_PRESETS.find((p) => p.id === id) ?? MATERIAL_PRESETS[0];
}

export interface FinishPreset {
  id: FinishId;
  name: string;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
}

// 漆面预设（plan.md §5.3）：切换漆面只改反射表现，不触发生图、不改印刷内容。
export const FINISHES: FinishPreset[] = [
  { id: 'gloss', name: '亮光清漆', roughness: 0.2, clearcoat: 0.9, clearcoatRoughness: 0.12 },
  { id: 'semi', name: '半哑光清漆', roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.36 },
  { id: 'matte', name: '哑光清漆', roughness: 0.62, clearcoat: 0.08, clearcoatRoughness: 0.62 }
];

export function finishById(id: FinishId): FinishPreset {
  return FINISHES.find((f) => f.id === id) ?? FINISHES[0];
}
