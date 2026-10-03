import { isMetalRing, ringOverride } from '../cue/ringColors';
import { useLayoutEffect, useRef, useState } from 'react';
import { Checkbox, Select } from '../ui/components';
import { Copy, Eye, EyeOff, Lock, LockOpen, Scissors, Trash2 } from 'lucide-react';
import type { CueTemplate, FinishId, PartOverride, StickerInstance } from '../core/types';
import { expandedSegments, isDecorativeRing, resolveTemplate } from '../cue/templates';
import { useStore } from '../state/store';
import { MATERIAL_PRESETS, presetById, supportsLacquer } from '../materials/presets';
import { openCutoutForSticker } from '../editor/CutoutEditor';

const finishes = [{ id: 'gloss', name: '亮光' }, { id: 'semi', name: '柔光' }, { id: 'matte', name: '哑光' }] as const;
const bases = [{ id: 'maple', name: '原木', color: '#c4a77d' }, { id: 'blackSolid', name: '墨黑', color: '#263329' }, { id: 'whiteSolid', name: '暖白', color: '#f7f2e7' }, { id: 'rosewood', name: '红木', color: '#794b3c' }];

/** Bottom controls are purpose-built for a shallow horizontal strip. */
export function PreviewTools({ tpl }: { tpl: CueTemplate }) {
  const design = useStore((s) => s.design), selection = useStore((s) => s.selection), view = useStore((s) => s.view);
  const watching = useStore((s) => s.interactionMode === 'watch');
  const sticker = selection.kind === 'sticker' ? design.stickers.find((s) => s.id === selection.id) : undefined;
  const part = selection.kind === 'part' ? [...expandedSegments(tpl), ...expandedSegments(resolveTemplate(tpl.id)), ...tpl.faces].find((p) => p.id === selection.id) : undefined;
  const metalRing = part ? isMetalRing(part.id) : false;
  const partMaterial = part ? presetById(ringOverride(part.id, design.partOverrides)?.matPreset ?? part.matPreset) : undefined;
  const whole = !sticker && !part && view === 'whole';
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  const contextKey = sticker ? `sticker:${sticker.id}` : part ? `part:${part.id}` : whole ? 'whole' : 'idle';
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      const nextHeight = content.getBoundingClientRect().height;
      setHeight(nextHeight);
      sectionRef.current?.parentElement?.style.setProperty('--preview-tools-height', `${nextHeight}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return <section {...(watching ? { inert: '' } : {})} aria-disabled={watching} ref={sectionRef} className="preview-customize preview-tools" style={{ height }} aria-label="预览调整工具">
    <div ref={contentRef} className="preview-tools-content">
    <div className="preview-tools-context">
      <strong>{sticker ? '图案调整' : part ? part.name.replace(/（.*?）/g, '') : whole ? '整体外观' : '精细调整'}</strong>
      <button className="tools-unfold" onClick={() => useStore.getState().set({ exportOpen: 'check' })}>查看展开图</button>
    </div>
    <div key={contextKey} className="preview-tools-body">
    {sticker ? <StickerTools key={sticker.id} sticker={sticker} tpl={tpl} /> : part ? <div className="preview-tools-row">
      {metalRing ? <label className="tool-field tool-material"><span>装饰环颜色</span><Select aria-label="装饰环颜色" value={partMaterial?.id} onChange={(e) => changePart(part.id, { matPreset: e.target.value, color: undefined })}><option value="brass">金色</option><option value="stainless">银色</option></Select></label> : <>
      <label className="tool-field tool-material"><span>底材</span><Select aria-label="部位底材" value={design.partOverrides[part.id]?.matPreset ?? part.matPreset} onChange={(e) => changePart(part.id, { matPreset: e.target.value })}>{MATERIAL_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>
      <label className="tool-field tool-color"><span>叠色</span><input aria-label="部位叠色" type="color" value={design.partOverrides[part.id]?.color ?? '#ffffff'} onChange={(e) => changePart(part.id, { color: e.target.value })} /></label>
      {design.partOverrides[part.id]?.color && <button onClick={() => changePart(part.id, { color: undefined })}>清除叠色</button>}
      </>}
      {partMaterial && supportsLacquer(partMaterial) ? <label className="tool-field"><span>漆面</span><Select aria-label="部位漆面" value={design.partOverrides[part.id]?.finish ?? ''} onChange={(e) => changePart(part.id, { finish: (e.target.value || undefined) as FinishId | undefined })}><option value="">跟随整体</option>{finishes.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></label> : <div className="tool-field"><span>表面</span><span>{partMaterial?.surfaceName ?? '自然表面'}</span></div>}
      {isDecorativeRing(part.id) && <div className="tool-field tool-ring-option"><span>装饰环</span><Checkbox label="保留装饰环" checked={design.partOverrides[part.id]?.ringEnabled ?? design.decorativeRings ?? true} onChange={(e) => changePart(part.id, { ringEnabled: e.target.checked })} /></div>}
    </div> : whole ? <div className="preview-tools-row">
      <div className="tool-field"><span>后把底色</span><div className="tool-swatches">{bases.map((base) => <button key={base.id} title={base.name} aria-label={`底色：${base.name}`} aria-pressed={design.partOverrides['butt-forearm']?.matPreset === base.id} style={{ backgroundColor: base.color }} onClick={() => {
        const st = useStore.getState(); st.pushHistory();
        for (const id of ['butt-forearm', 'butt-cap']) st.setPartOverride(id, { matPreset: base.id, color: undefined });
      }} />)}</div></div>
      <div className="tool-field"><span>整体漆面</span><div className="tool-segments">{finishes.map((f) => <button key={f.id} aria-pressed={design.globalFinish === f.id} onClick={() => useStore.getState().applyFinishAll(f.id)}>{f.name}</button>)}</div></div>
    </div> : <p className="tools-hint">选中部位调整材质，选中图案调整位置和尺寸。</p>}
    </div>
    </div>
  </section>;
}

function changePart(id: string, patch: PartOverride) {
  const st = useStore.getState(); st.pushHistory(); st.setPartOverride(id, patch);
}

function NumericTool({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void }) {
  return <label className="tool-field tool-number"><span>{label}</span><input type="number" aria-label={label} value={Number(value.toFixed(1))} min={min} max={max} step={step} onChange={(e) => {
    if (e.target.value === '') return;
    const next = e.target.valueAsNumber;
    if (Number.isFinite(next)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next)));
  }} /></label>;
}

function StickerTools({ sticker: s, tpl }: { sticker: StickerInstance; tpl: CueTemplate }) {
  const [linked, setLinked] = useState(true);
  const update = (patch: Partial<StickerInstance>) => useStore.getState().updateSticker(s.id, patch);
  const target = s.target;
  const seg = target.kind === 'lathe' ? expandedSegments(tpl).find((p) => p.id === target.segId) : undefined;
  return <>
    <fieldset className="preview-tools-row" disabled={s.locked} aria-label="图案位置与尺寸">
      {target.kind === 'lathe' ? <>
        <NumericTool label="沿杆 mm" value={target.a} min={seg?.a0} max={seg?.a1} onChange={(a) => update({ target: { ...target, a } })} />
        <NumericTool label="环绕 °" value={target.angDeg} min={0} max={360} onChange={(angDeg) => update({ target: { ...target, angDeg } })} />
      </> : <>
        <NumericTool label="水平 mm" value={target.fx} onChange={(fx) => update({ target: { ...target, fx } })} />
        <NumericTool label="垂直 mm" value={target.fz} onChange={(fz) => update({ target: { ...target, fz } })} />
      </>}
      <NumericTool label="宽 mm" value={s.w} min={1} step={0.5} onChange={(w) => update(linked ? { w, h: w * s.h / s.w } : { w })} />
      <NumericTool label="高 mm" value={s.h} min={1} step={0.5} onChange={(h) => update(linked ? { h, w: h * s.w / s.h } : { h })} />
      <button aria-pressed={linked} onClick={() => setLinked(!linked)} title="锁定当前宽高比例">{linked ? <Lock size={13} /> : <LockOpen size={13} />}等比</button>
      <NumericTool label="旋转 °" value={s.rotDeg} step={5} onChange={(rotDeg) => update({ rotDeg })} />
      <NumericTool label="不透明 %" value={s.opacity * 100} min={5} max={100} onChange={(opacity) => update({ opacity: opacity / 100 })} />
    </fieldset>
    <div className="preview-tools-row tool-actions">
      <button disabled={s.locked} onClick={() => openCutoutForSticker(s)}><Scissors size={13} />剪切</button>
      <button disabled={s.locked} aria-pressed={s.flipX} onClick={() => update({ flipX: !s.flipX })}>水平翻转</button>
      <button disabled={s.locked} aria-pressed={s.flipY} onClick={() => update({ flipY: !s.flipY })}>垂直翻转</button>
      <button disabled={s.locked} onClick={() => useStore.getState().reorderSticker(s.id, 1)}>上移</button>
      <button disabled={s.locked} onClick={() => useStore.getState().reorderSticker(s.id, -1)}>下移</button>
      <button onClick={() => update({ hidden: !s.hidden })}>{s.hidden ? <EyeOff size={13} /> : <Eye size={13} />}{s.hidden ? '已隐藏' : '显示中'}</button>
      <button onClick={() => update({ locked: !s.locked })}>{s.locked ? <Lock size={13} /> : <LockOpen size={13} />}{s.locked ? '解锁' : '锁定'}</button>
      <button aria-label="复制图案" title="复制图案" onClick={() => useStore.getState().duplicateSticker(s.id)}><Copy size={13} /></button>
      <button disabled={s.locked} aria-label="删除图案" title="删除图案" onClick={() => useStore.getState().removeSticker(s.id)}><Trash2 size={13} /></button>
    </div>
  </>;
}
