import type { CueTemplate, SegmentSpec } from '../core/types';

const TOTAL_LEN = 1474;
const HALF_LEN = 737;
const TIP_DIAMETER = 13;
const JOINT_DIAMETER = 21.4;
const BUTT_DIAMETER = 31.4;
// 皮头厚度、先角长度及后把内部材质分段沿用展示值。
const TIP_LEN = 5;
const FERRULE_LEN = 24;
const buttRadius = (a: number) =>
  JOINT_DIAMETER / 2 + ((a - HALF_LEN) / HALF_LEN) * ((BUTT_DIAMETER - JOINT_DIAMETER) / 2);

export const CUE_TEMPLATES: CueTemplate[] = [
  {
    id: 'nineball',
    name: '大头杆',
    family: '九球杆／花式杆／大头杆',
    tipDiameterMm: TIP_DIAMETER,
    lengthMm: TOTAL_LEN,
    shaftLengthMm: HALF_LEN,
    buttLengthMm: HALF_LEN,
    jointDiameterMm: JOINT_DIAMETER,
    buttDiameterMm: BUTT_DIAMETER,
    sizeStatus: '用户指定尺寸',
    sizeSource: '总长 1474 mm，前支／后把各 737 mm；中轮直径 21.4 mm，大轮直径 31.4 mm，先角直径 13 mm。杆身按这些尺寸连续渐变；皮头厚度、先角长度及后把内部材质分段沿用展示值。',
    segments: [
      { id: 'shaft', kind: 'shaft', name: '前支（枫木）', a0: TIP_LEN + FERRULE_LEN, a1: HALF_LEN, r0: TIP_DIAMETER / 2, r1: JOINT_DIAMETER / 2, matPreset: 'maple', printEnabled: true },
      { id: 'joint', kind: 'joint', name: '接头（中轮）', a0: HALF_LEN, a1: 750, r0: buttRadius(HALF_LEN), r1: buttRadius(750), matPreset: 'stainless', printEnabled: true },
      { id: 'ring-joint', kind: 'ring', name: '接头装饰环', a0: 750, a1: 758, r0: buttRadius(750), r1: buttRadius(758), matPreset: 'brass', printEnabled: true },
      { id: 'butt-forearm', kind: 'butt', name: '后把前臂', a0: 758, a1: 1142, r0: buttRadius(758), r1: buttRadius(1142), matPreset: 'maple', printEnabled: true },
      { id: 'ring-deco', kind: 'ring', name: '握把前装饰环', a0: 1142, a1: 1150, r0: buttRadius(1142), r1: buttRadius(1150), matPreset: 'brass', printEnabled: true },
      { id: 'grip', kind: 'grip', name: '握把（皮革缠面）', a0: 1150, a1: 1352, r0: buttRadius(1150), r1: buttRadius(1352), matPreset: 'leather', printEnabled: true },
      { id: 'butt-cap', kind: 'butt', name: '后把尾段（大轮）', a0: 1352, a1: TOTAL_LEN, r0: buttRadius(1352), r1: BUTT_DIAMETER / 2, matPreset: 'ebony', printEnabled: true }
    ],
    faces: [
      { id: 'face-tip', name: '皮头端面', a: 0, radius: TIP_DIAMETER / 2, normalSign: -1, matPreset: 'tipLeather', printEnabled: false },
      { id: 'face-butt', name: '端面（后把底）', a: TOTAL_LEN, radius: BUTT_DIAMETER / 2, normalSign: 1, matPreset: 'ebony', printEnabled: true }
    ]
  }
];

/** 展开为实际几何部件序列，轴向位置连续。 */
export function expandedSegments(t: CueTemplate): SegmentSpec[] {
  const tipR = t.tipDiameterMm / 2;
  const front: SegmentSpec[] = [
    { id: 'tip', kind: 'tip', name: '皮头', a0: 0, a1: TIP_LEN, r0: tipR, r1: tipR, matPreset: 'tipLeather', printEnabled: false },
    { id: 'ferrule', kind: 'ring', name: '先角', a0: TIP_LEN, a1: TIP_LEN + FERRULE_LEN, r0: tipR, r1: tipR, matPreset: 'ivory', printEnabled: true }
  ];
  return [...front, ...t.segments].sort((a, b) => a.a0 - b.a0);
}

/** 杆轴某位置的外半径（线性锥度插值） */
export function radiusAt(t: CueTemplate, a: number): number {
  const segs = expandedSegments(t);
  if (a <= segs[0].a0) return segs[0].r0;
  for (const s of segs) {
    if (a >= s.a0 && a <= s.a1) {
      const f = s.a1 === s.a0 ? 0 : (a - s.a0) / (s.a1 - s.a0);
      return s.r0 + (s.r1 - s.r0) * f;
    }
  }
  return segs[segs.length - 1].r1;
}

export function segmentById(t: CueTemplate, id: string): SegmentSpec | undefined {
  return expandedSegments(t).find((s) => s.id === id);
}

export function faceById(t: CueTemplate, id: string) {
  return t.faces.find((f) => f.id === id);
}

export function resolveTemplate(id: string): CueTemplate {
  // 兼容已保存的旧杆型，统一使用当前唯一尺寸。
  const normalizedId = id === 'snooker' || id === 'chinese8' ? 'nineball' : id;
  const t = CUE_TEMPLATES.find((x) => x.id === normalizedId);
  if (!t) throw new Error(`未知杆型模板: ${id}`);
  return t;
}
