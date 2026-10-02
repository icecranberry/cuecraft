import type { ArtworkCandidate, ArtworkPart, ArtworkScope, Asset, CueTemplate, DesignSnapshot, StickerInstance } from '../core/types';
import { expandedSegments, resolveTemplate } from './templates';
import { presetById } from '../materials/presets';

export const ARTWORK_PRESETS = [
  { name: '前臂 + 尾段', ids: ['butt-forearm', 'butt-cap'], note: '主纹样前后呼应，保留握把' },
  { name: '主纹样 + 装饰环', ids: ['butt-forearm', 'butt-cap', 'ring-joint', 'ring-deco'], note: '纹样、配色与环线成套搭配' },
  { name: '后把通体', ids: ['butt-forearm', 'grip', 'butt-cap', 'ring-joint', 'ring-deco'], note: '适合无缠面或希望握把也有图案的方案' }
];

export function artworkParts(tpl: CueTemplate, design: DesignSnapshot): ArtworkPart[] {
  const material = (id: string, defaultPreset: string) => {
    const override = design.partOverrides[id];
    return `${presetById(override?.matPreset ?? defaultPreset).name}${override?.color ? `，底色 ${override.color}` : ''}`;
  };
  const role = (id: string) => {
    if (id === 'butt-forearm') return '前臂主纹样：沿杆轴纵向的长尖插花、长线条或对称镶嵌图案';
    if (id === 'butt-cap') return '尾段呼应纹样：提取前臂的同一主元素，形成更短、更紧凑的徽饰或插花';
    if (id === 'grip') return '握把辅助纹样：低密度细线、菱格或留白，延续主配色，兼顾握持区域';
    if (id.startsWith('ring-')) return '装饰环：与其他环重复同一环线、菱形或边框元素，图案沿横向环绕一周';
    if (id === 'shaft') return '前节：疏朗的小标记或细长线条，保留木纹与大面积留白';
    if (id === 'ferrule') return '先角：简洁的小型环线或标记';
    return '独立部位纹样';
  };
  return [
    ...expandedSegments(tpl).filter((s) => s.printEnabled).map((s): ArtworkPart => ({
      id: s.id, name: s.name, kind: 'lathe',
      wMm: 2 * Math.PI * (s.r0 + s.r1) / 2, hMm: s.a1 - s.a0,
      role: role(s.id), material: material(s.id, s.matPreset)
    })),
    ...tpl.faces.filter((f) => f.printEnabled).map((f): ArtworkPart => ({
      id: f.id, name: f.name, kind: 'face', wMm: f.radius * 2, hMm: f.radius * 2,
      role: '后把底部端面：圆形徽饰，与尾段的主元素和配色呼应', material: material(f.id, f.matPreset)
    }))
  ];
}

export function createArtworkScope(tpl: CueTemplate, design: DesignSnapshot, mode: ArtworkScope['mode'], ids: string[], textureMode: ArtworkScope['textureMode'] = 'decal'): ArtworkScope {
  const available = artworkParts(tpl, design);
  const parts = available.filter((p) => ids.includes(p.id));
  if (mode === 'single' && parts.length !== 1) throw new Error('请选择一个可印刷部位');
  if (mode === 'linked' && parts.length < 2) throw new Error('联动生成至少选择两个部位');
  return { mode, textureMode, cueTemplateId: tpl.id, cueTemplateName: tpl.name, parts };
}

export function buildArtworkPrompt(scope: ArtworkScope, part?: ArtworkPart): string {
  const selection = scope.parts.map((p) => p.name).join('、');
  const wrap = scope.textureMode === 'wrap';
  const shared = `球杆定制转印图案，杆型：${scope.cueTemplateName}。${scope.mode === 'linked' ? `联动部位：${selection}。所有部位统一主题、色板、线条粗细和主纹样，前臂与尾段呼应，装饰环重复同一边框元素；各部位根据用途重新构图，不把同一张图机械拉伸复制` : `仅设计${selection}，其他部位不修改`}。`;
  if (!part) return `${shared}${wrap ? '整圈包覆模式：主纹样与辅助元素横向连续分布，形成绕杆一周的完整纹理，不是居中的单条细长贴花。' : '细长装饰模式：独立纵向贴花，周围露出底材。'}先绘制这套设计的风格母稿，明确主纹样及配套边框、辅助元素。只画平面图案，不画球杆实物，不画产品照片，不含品牌标识或部位标签。`;
  const ratio = (part.wMm / part.hMm).toFixed(3);
  if (wrap && part.kind === 'lathe') return `${shared}整圈包覆模式。本张只输出「${part.name}」的完整矩形平面展开贴图。实际展开宽 ${part.wMm.toFixed(1)} mm × 高 ${part.hMm.toFixed(1)} mm，目标宽高比 ${ratio}。横向覆盖完整 360 度，纵向覆盖整个部位；左右边缘的颜色、线条与纹样必须无缝衔接，花纹分布到整个宽度，不要只在中央画一条细长装饰。整个输出画布就是贴图区域，满版延伸到四边，不加白色留白、外框或透明边距；若输出画布比例不同，请按目标展开比例预补偿构图，上杆时整张图会映射到上述尺寸。纵向上方朝杆头、下方朝杆尾。底材为${part.material}，可按用户配色设计完整底色与纹样。${scope.mode === 'linked' ? '使用参考母稿的相同主元素、色板与边框，保持整套设计一致。' : ''}只输出平面纹理，不画球杆实物、圆柱、透视、阴影、标签、尺寸线或水印。`;
  return `${shared}本张只输出「${part.name}」的平面图案。${part.role}。底材为${part.material}，请考虑图案在该底材上的对比度，但不要把底材纹理画入印刷图。实际展开宽 ${part.wMm.toFixed(1)} mm × 高 ${part.hMm.toFixed(1)} mm，主体宽高比约 ${ratio}，按此比例构图，用白色留白适配画布；纵向上方朝杆头、下方朝杆尾。${part.kind === 'face' ? '主体置于圆形安全区内。' : '细长装饰模式：主体为独立贴花，居中构图，周围留白以露出原有底材，图案不要超出部位；装饰环可使用横向环绕的细线。'}${scope.mode === 'linked' ? '使用参考母稿的相同主元素、色板与边框，保持整套设计一致。' : ''}只输出一个部位，不画球杆、透视、三维材质、标签、尺寸线或产品背景。`;
}

/** 一次生成方案作为一次设计编辑；仅替换任务快照中指定的部位。 */
export function applyArtworkToDesign(
  design: DesignSnapshot, scope: ArtworkScope, candidate: ArtworkCandidate, assets: Asset[],
  options: { replace: boolean; onlyPartId?: string }, makeId: () => string
): DesignSnapshot {
  if (design.cueTemplateId !== scope.cueTemplateId) throw new Error('当前杆型与生成方案不同，请先切换回生成时的杆型');
  const parts = scope.parts.filter((p) => !options.onlyPartId || p.id === options.onlyPartId);
  if (!parts.length) throw new Error('方案中没有该部位');
  const replacements = parts.map((part) => {
    const ref = candidate.partAssets.find((a) => a.partId === part.id);
    const asset = assets.find((a) => a.id === ref?.assetId);
    if (!asset) throw new Error(`「${part.name}」图案尚未就绪`);
    return { part, asset };
  });
  const selectedIds = new Set(parts.map((p) => p.id));
  const kept = design.stickers.filter((s) => !options.replace || s.locked || !selectedIds.has(s.target.kind === 'lathe' ? s.target.segId : s.target.faceId));
  const tplSegments = expandedSegments(resolveTemplate(design.cueTemplateId));
  const maxZ = Math.max(0, ...kept.map((s) => s.z));
  const added: StickerInstance[] = replacements.map(({ part, asset }, i) => {
    // 保持像素比例，在展开区域内留出余量，避免将环线或插花压扁。
    const safe = part.kind === 'face' ? 0.66 : 0.96;
    const wrap = scope.textureMode === 'wrap' && part.kind === 'lathe';
    const w = wrap ? part.wMm : Math.min(part.wMm * safe, part.hMm * safe * asset.w / asset.h);
    const h = wrap ? part.hMm : w * asset.h / asset.w;
    const seg = tplSegments.find((s) => s.id === part.id);
    return {
      id: makeId(), name: asset.name, assetId: asset.id, processedRev: 0,
      target: part.kind === 'face' ? { kind: 'face', faceId: part.id, fx: 0, fz: 0 }
        : { kind: 'lathe', segId: part.id, a: (seg!.a0 + seg!.a1) / 2, angDeg: 70 },
      w, h, rotDeg: 0, flipX: false, flipY: false, opacity: 1, z: maxZ + i + 1, hidden: false, locked: false
    };
  });
  return { ...design, stickers: [...kept, ...added] };
}

