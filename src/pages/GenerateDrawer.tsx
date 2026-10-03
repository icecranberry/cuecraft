import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ImagePlus, Loader2, Scissors, Sparkles, Upload, X } from 'lucide-react';
import type { ArtworkCandidate, ArtworkScope, GenerationJob } from '../core/types';
import { isDecorativeRing, resolveTemplate } from '../cue/templates';
import { ARTWORK_PRESETS, applyArtworkToDesign, artworkParts, createArtworkScope } from '../cue/artwork';
import { STATUS_LABEL, cancelJob, getApiKey, startGeneration } from '../ai/client';
import { activeAssets, nextStickerId, useStore } from '../state/store';
import { saveCurrentProduct, uploadDesignImages } from '../state/designActions';
import { openCutoutForAsset } from '../editor/CutoutEditor';
import { AssetThumb } from './panels';
import { Button, Field, Select, TextInput, Toggle } from '../ui/components';
import { CueMiniature } from '../ui/DesignIllustrations';
import { transitionUI } from '../ui/motion';
import { SlidingIndicator } from '../ui/SlidingIndicator';
import { PatternPicker } from './PatternPicker';
import { letteringRequest } from '../ai/lettering';
import { getBlob } from '../state/imageStore';

const STYLES = [
  { id: 'jade', name: '青绿贝母', note: '温润 · 经典', subject: '青绿色贝母长尖插花，前后呼应的菱形花纹和细银边', style: '经典台球杆镶嵌纹样，精致、对称', palette: '青绿、银白' },
  { id: 'gold', name: '经典黑金', note: '沉稳 · 精致', subject: '金色长线条与对称几何插花，尾段呼应主纹样', style: '简洁复古，细线镶嵌', palette: '金色、黑色' },
  { id: 'silver', name: '极简银线', note: '利落 · 现代', subject: '银白细长线条，少量菱形，保留大面积留白', style: '现代极简', palette: '银白、深灰' }
];
type Draft = { textureMode: 'decal' | 'wrap'; step: number; mode: ArtworkScope['mode']; ids: string[]; subject: string; style: string; palette: string; keep: string; avoid: string; n: number; refs: string[]; removeWhite: boolean; replace: boolean; source: 'builtin' | 'ai' | 'lettering' | 'upload'; letteringText: string; letteringStyle: string; patternId: string; uploadId: string; jobId: string | null; styleId: string | null };
const initialDraft: Draft = { textureMode: 'decal', step: 0, mode: 'linked', ids: ARTWORK_PRESETS[0].ids, subject: '', style: '', palette: '', keep: '', avoid: '', n: 1, refs: [], removeWhite: true, replace: true, source: 'builtin', letteringText: '', letteringStyle: '', patternId: '', uploadId: '', jobId: null, styleId: null };
const SOURCES = [{ id: 'builtin', label: '纹样选料' }, { id: 'ai', label: 'AI 设计' }, { id: 'lettering', label: '纹字' }, { id: 'upload', label: '我的图片' }] as const;
function readDraft(): Draft {
  try { const value = JSON.parse(sessionStorage.getItem('cue:design-wizard:v1') || 'null'); return value && Array.isArray(value.ids) && Array.isArray(value.refs) ? { ...initialDraft, ...value, ids: value.ids.filter((id: string) => !isDecorativeRing(id)).length ? value.ids.filter((id: string) => !isDecorativeRing(id)) : initialDraft.ids, step: Math.max(0, Math.min(2, Number(value.step) || 0)) } : initialDraft; } catch { return initialDraft; }
}
const shortName = (name: string) => name.replace(/（.*?）/g, '');

export function GenerateDrawer({ embedded = false }: { embedded?: boolean }) {
  const open = useStore((s) => s.generateOpen), design = useStore((s) => s.design), jobs = useStore((s) => s.jobs), assets = useStore((s) => s.assets), request = useStore((s) => s.generationRequest);
  const tpl = useMemo(() => resolveTemplate(design.cueTemplateId, design.decorativeRings, design.partOverrides), [design.cueTemplateId, design.decorativeRings, design.partOverrides['ring-joint']?.ringEnabled, design.partOverrides['ring-deco']?.ringEnabled]);
  const parts = artworkParts(tpl, design);
  const [draft, setDraft] = useState<Draft>(readDraft);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const applyRequest = useRef(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [needSetup, setNeedSetup] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null), headingRef = useRef<HTMLHeadingElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const requestedSource = useRef(draft.source);
  const requestedStep = useRef(draft.step);
  const patch = (change: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...change }));
  const switchSource = (source: Draft['source']) => {
    const previous = requestedSource.current;
    if (source === previous) return;
    requestedSource.current = source;
    transitionUI(() => [sourceRef.current, footerRef.current], SOURCES.findIndex((s) => s.id === source) - SOURCES.findIndex((s) => s.id === previous), () => { patch({ source }); setError(''); setNeedSetup(false); });
  };
  const go = (step: number) => {
    const previous = requestedStep.current;
    if (step === previous) return;
    requestedStep.current = step;
    transitionUI(() => [bodyRef.current, footerRef.current], step - previous, () => { patch({ step }); setError(''); }, () => {
      bodyRef.current?.scrollTo({ top: 0, behavior: 'instant' });
      headingRef.current?.focus({ preventScroll: true });
    });
  };
  useEffect(() => { try { sessionStorage.setItem('cue:design-wizard:v1', JSON.stringify(draft)); } catch { /* The current draft still works when storage is full. */ } }, [draft]);
  useEffect(() => {
    if (!request) return;
    requestedStep.current = 0;
    const st = useStore.getState(), available = artworkParts(tpl, st.design);
    const id = available.some((p) => p.id === request.partId) ? request.partId! : 'butt-forearm';
    const sticker = [...st.design.stickers].reverse().find((s) => (s.target.kind === 'lathe' ? s.target.segId : s.target.faceId) === id);
    setDraft((previous) => ({ ...previous, step: 0, mode: request.mode, ids: request.mode === 'single' ? [id] : [...new Set([...ARTWORK_PRESETS[0].ids, id])], refs: request.mode === 'single' && sticker ? [sticker.assetId] : previous.refs }));
    useStore.getState().set({ generationRequest: null }); setError('');
  }, [request, tpl]);
  if (!embedded && !open) return null;
  const selected = parts.filter((p) => draft.ids.includes(p.id));
  const valid = draft.mode === 'single' ? selected.length === 1 : selected.length >= 2;
  const currentJob = jobs.find((j) => j.id === draft.jobId);
  const running = currentJob?.status === 'queued' || currentJob?.status === 'running';
  const images = activeAssets(assets), uploaded = images.find((a) => a.id === (draft.source === 'builtin' ? draft.patternId : draft.uploadId));
  const textureMode = draft.source === 'builtin' ? 'decal' : draft.textureMode;
  const isApplied = (candidate: ArtworkCandidate) => candidate.partAssets.length > 0 && candidate.partAssets.every((ref) => design.stickers.some((s) => s.assetId === ref.assetId && (s.target.kind === 'lathe' ? s.target.segId : s.target.faceId) === ref.partId));
  const uploadCandidate: ArtworkCandidate = { id: 'upload', partAssets: selected.map((p) => ({ partId: p.id, assetId: uploaded?.id ?? '' })) };
  const isGeneration = draft.source === 'ai' || draft.source === 'lettering';
  const generationReady = draft.source === 'lettering' ? !!draft.letteringText.trim() && !!draft.letteringStyle.trim() : !!draft.subject.trim();
  const applied = !isGeneration ? !!uploaded && isApplied(uploadCandidate) : !!currentJob?.candidates?.some(isApplied);
  const applyScope = (scope: ArtworkScope, candidate: ArtworkCandidate, onlyPartId?: string) => {
    const st = useStore.getState();
    const next = applyArtworkToDesign(st.design, scope, candidate, st.assets, { replace: draft.replace, onlyPartId }, nextStickerId);
    st.pushHistory(); st.set({ design: next, placementAssetId: null, selection: { kind: 'global' }, view: 'butt', focusPartId: null, viewNonce: st.viewNonce + 1 });
    st.showToast(onlyPartId ? '这个部位已更新，可以撤销' : '图案已放上球杆，可以拖动查看'); setError('');
  };
  const apply = (job: GenerationJob, candidate: ArtworkCandidate, onlyPartId?: string) => {
    try { if (job.input.scope) applyScope(job.input.scope, candidate, onlyPartId); } catch (e) { setError((e as Error).message); }
  };
  const applyUpload = async () => {
    if (!uploaded || !valid) return;
    const requestId = ++applyRequest.current;
    setError('');
    try {
      if (!await getBlob(uploaded.blobKey)) throw new Error('图案尚未就绪，请重试');
      const latest = latestDraft.current;
      if (requestId !== applyRequest.current || latest.source !== draft.source || latest.step !== draft.step ||
        latest.patternId !== draft.patternId || latest.uploadId !== draft.uploadId || latest.mode !== draft.mode ||
        latest.textureMode !== draft.textureMode || latest.replace !== draft.replace || latest.ids.join() !== draft.ids.join()) return;
      // Read the latest design after loading so concurrent edits are preserved.
      applyScope(createArtworkScope(tpl, useStore.getState().design, draft.mode, draft.ids, textureMode), uploadCandidate);
      go(2);
    } catch (e) { setError((e as Error).message); }
  };
  const generate = async () => {
    setError(''); setNeedSetup(false);
    if (!generationReady || !valid || busy || running) return;
    if (!await getApiKey()) { setNeedSetup(true); setError('先连接图片生成服务，就可以开始 AI 设计。你的想法已保留，也可以选择使用自己的图片。'); return; }
    setBusy(true);
    try {
      const scope = createArtworkScope(tpl, design, draft.mode, draft.ids, draft.textureMode);
      const refs = (draft.source === 'lettering' ? [] : draft.refs).filter((id) => images.some((a) => a.id === id));
      const job = await startGeneration({ ...(draft.source === 'lettering' ? letteringRequest(draft.letteringText, draft.letteringStyle) : { subject: draft.subject, style: draft.style, palette: draft.palette, keep: draft.keep, avoid: draft.avoid }), n: draft.n, refAssetIds: refs, scope, removeWhite: draft.removeWhite }, refs.length ? 'edit' : 'generate');
      patch({ jobId: job.id }); go(2);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const upload = async (files: File[], reference: boolean) => {
    if (!files.length) return;
    setBusy(true); setError('');
    try { const added = await uploadDesignImages(files); patch(reference ? { refs: [...new Set([...draft.refs, ...added.map((a) => a.id)])] } : { uploadId: added[0].id }); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const setPreset = (index: number) => patch({ mode: 'linked', ids: ARTWORK_PRESETS[index].ids });
  const matchesPreset = (index: number) => draft.mode === 'linked' && draft.ids.length === ARTWORK_PRESETS[index].ids.length && ARTWORK_PRESETS[index].ids.every((id) => draft.ids.includes(id));
  return <section className={`design-wizard ${embedded ? '' : 'wizard-floating'}`}>
    <header className="wizard-heading"><div><span className="eyebrow">LET’S MAKE IT YOURS</span><h2>三步，做出你的风格</h2></div>{!embedded && <Button size="icon" variant="ghost" aria-label="关闭设计向导" onClick={() => useStore.getState().set({ generateOpen: false })}><X size={18} /></Button>}</header>
    <nav className="wizard-steps" aria-label="设计步骤"><SlidingIndicator activeKey={draft.step} selector="button[aria-current=step]" underline />{['选部位', '选纹样', '看效果'].map((label, index) => <button key={label} aria-current={draft.step === index ? 'step' : undefined} disabled={index > 0 && !valid} onClick={() => go(index)}><span>{index < draft.step ? <Check size={13} /> : `0${index + 1}`}</span>{label}</button>)}</nav>
    <div className="wizard-body" ref={bodyRef}>
      <div className="step-intro"><h3 tabIndex={-1} ref={headingRef}>{['想设计哪些地方？', '你喜欢什么样的风格？', '看看你的设计'][draft.step]}</h3><p>{['先选一个范围，图案会自动适配所选部位。', '挑选内置纹样或贴纸，也可以生成或上传自己的图案。', '满意的方案点一下就能上杆，再拖动球杆查看。'][draft.step]}</p></div>
      {draft.step === 0 && <>
        <div className="scope-options">
          <button className={`scope-card ${matchesPreset(0) ? 'selected' : ''}`} aria-pressed={matchesPreset(0)} onClick={() => setPreset(0)}><div><strong>前后呼应</strong><span className="recommend-tag">推荐新手</span><span className="choice-dot">{matchesPreset(0) && <Check size={12} />}</span></div><CueMiniature ringIds={tpl.segments.map((s) => s.id)} selected={ARTWORK_PRESETS[0].ids} /><p>前臂和尾段成套设计，保留握把原有质感。</p></button>
          <button className={`scope-card ${matchesPreset(1) ? 'selected' : ''}`} aria-pressed={matchesPreset(1)} onClick={() => setPreset(1)}><div><strong>后把通体</strong><span className="choice-dot">{matchesPreset(1) && <Check size={12} />}</span></div><CueMiniature ringIds={tpl.segments.map((s) => s.id)} selected={ARTWORK_PRESETS[1].ids} /><p>前臂、握把和尾段统一设计，装饰环不贴图。</p></button>
          <button className={`scope-card compact ${draft.mode === 'single' ? 'selected' : ''}`} aria-pressed={draft.mode === 'single'} onClick={() => patch({ mode: 'single', ids: [draft.ids[0] || 'butt-forearm'] })}><div><strong>只改一处</strong><span>单独设计一个部位</span><span className="choice-dot">{draft.mode === 'single' && <Check size={12} />}</span></div></button>
        </div>
        {draft.mode === 'single' ? <Field label="选择一个部位"><Select aria-label="选择一个部位" value={draft.ids[0]} onChange={(e) => { patch({ ids: [e.target.value] }); useStore.getState().focusPart(e.target.value); }}>{parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field> : <details className="quiet-details"><summary>自己选择联动部位</summary><div className="custom-parts">{parts.map((p) => <label key={p.id}><input type="checkbox" checked={draft.ids.includes(p.id)} onChange={(e) => patch({ ids: e.target.checked ? [...draft.ids, p.id] : draft.ids.filter((id) => id !== p.id) })} /><span>{p.name}</span></label>)}</div></details>}
        <div className="selection-summary"><CheckCircle2 size={17} /><div><strong>已选 {selected.length} 个部位</strong><p>{selected.map((p) => shortName(p.name)).join(' · ') || '还没有选择部位'}</p></div></div>
        {!valid && <p className="form-error" role="alert">联动设计至少选择两个部位，或选择「只改一处」。</p>}
      </>}
      {draft.step === 1 && <>

        <div className="source-switch" role="tablist" aria-label="图案来源" onKeyDown={(e) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault();
          const index = SOURCES.findIndex((s) => s.id === requestedSource.current);
          const next = SOURCES[e.key === 'Home' ? 0 : e.key === 'End' ? SOURCES.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : SOURCES.length - 1)) % SOURCES.length].id;
          switchSource(next); document.getElementById(`source-tab-${next}`)?.focus();
        }}>
          <SlidingIndicator activeKey={draft.source} selector="button[aria-selected=true]" />
          {SOURCES.map((s) => <button key={s.id} id={`source-tab-${s.id}`} role="tab" aria-selected={draft.source === s.id} aria-controls={`source-panel-${s.id}`} tabIndex={draft.source === s.id ? 0 : -1} onClick={() => switchSource(s.id)}>{s.label}</button>)}
        </div>
        <div className="source-content" ref={sourceRef}>
        <fieldset className="texture-mode-picker" hidden={draft.source === 'builtin'}><legend>图案怎么贴？</legend><div className="texture-mode-options">
          <button type="button" aria-pressed={draft.textureMode === 'decal'} onClick={() => patch({ textureMode: 'decal' })}><span className="texture-swatch decal" aria-hidden="true" /><strong>细长装饰</strong><small>一条精致贴花，露出原有底材</small></button>
          <button type="button" aria-pressed={draft.textureMode === 'wrap'} onClick={() => patch({ textureMode: 'wrap' })}><span className="texture-swatch wrap" aria-hidden="true" /><strong>整圈包覆</strong><small>图案绕满一周，转到背面也有花纹</small></button>
        </div><p className="helper-text">{draft.textureMode === 'wrap' ? '所选杆身部位会铺满一周；端面仍按圆形适配。生成图保留底色与白色花纹。' : '图案等比例放置，适合长尖插花、细线和独立徽饰。'}</p></fieldset>
        <div id="source-panel-builtin" role="tabpanel" aria-labelledby="source-tab-builtin" hidden={draft.source !== 'builtin'}>
          <PatternPicker selectedId={draft.patternId} onSelect={(patternId) => patch({ patternId })} />
        </div>
        <div id="source-panel-ai" role="tabpanel" aria-labelledby="source-tab-ai" hidden={draft.source !== 'ai'}>
          <div className="style-options">{STYLES.map((style) => <button key={style.id} className={`style-card ${draft.styleId === style.id ? 'selected' : ''}`} aria-pressed={draft.styleId === style.id} onClick={() => patch({ styleId: style.id, subject: style.subject, style: style.style, palette: style.palette })}><div className={`style-art ${style.id}`}><CueMiniature tone={style.id} pattern /></div><strong>{style.name}</strong><small>{style.note}</small></button>)}</div>
          <p className="style-caption">风格示意 · 生成时会按你的想法重新设计</p>
          <div className="idea-field"><label htmlFor="design-idea">说说你的想法</label><textarea id="design-idea" rows={4} maxLength={1600} value={draft.subject} onChange={(e) => patch({ subject: e.target.value, styleId: null })} placeholder="例如：黑底配青绿色贝母，前后都有细长的菱形花纹，简洁一点。" /><p>一句话就可以，颜色、图案、感觉都能说。</p></div>
          <label className="upload-reference"><Upload size={16} /><span>{busy ? '正在读取图片…' : '加一张参考图'}<small>可选 · 实物照片或喜欢的图案</small></span><input type="file" accept="image/*" multiple disabled={busy} onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void upload(files, true); }} /></label>
          {draft.refs.length > 0 && <div className="selected-references">{draft.refs.map((id) => { const a = images.find((image) => image.id === id); return a && <div key={id}><AssetThumb blobKey={a.blobKey} className="h-full w-full object-contain" /><button aria-label={`移除参考图 ${a.name}`} onClick={() => patch({ refs: draft.refs.filter((r) => r !== id) })}><X size={13} /></button></div>; })}</div>}
        </div>
        <div id="source-panel-lettering" role="tabpanel" aria-labelledby="source-tab-lettering" hidden={draft.source !== 'lettering'}>
          <p className="helper-text">把名字、短句或喜欢的字做成球杆纹样。先填文字，再指定它的风格。</p>
          <Field label="想写什么字"><TextInput maxLength={100} value={draft.letteringText} onChange={(e) => patch({ letteringText: e.target.value })} placeholder="例如：一杆入魂" /></Field>
          <Field label="文字风格"><TextInput maxLength={500} value={draft.letteringStyle} onChange={(e) => patch({ letteringStyle: e.target.value })} placeholder="例如：行书，银白金属质感，青绿细边" /></Field>
          <p className="helper-text">文字和风格会一起用于生成图案。请填写这两项后，再点击「生成我的方案」。</p>
        </div>
        <div id="source-panel-upload" role="tabpanel" aria-labelledby="source-tab-upload" hidden={draft.source !== 'upload'}>
          <label className="upload-drop"><ImagePlus size={28} /><strong>{busy ? '正在读取…' : '选择你的图案'}</strong><span>支持 PNG、JPG 等图片，透明背景效果更好</span><input type="file" accept="image/*" disabled={busy} onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void upload(files, false); }} /></label>
          {uploaded && <div className="uploaded-selection"><AssetThumb blobKey={uploaded.blobKey} className="h-28 w-full object-contain" /><span>{uploaded.name}</span><Button variant="outline" onClick={() => openCutoutForAsset(uploaded)}><Scissors size={14} />剪切图片</Button></div>}
          <p className="helper-text">{draft.textureMode === 'wrap' ? '请使用左右边缘可衔接的展开图，整张图片会拉伸铺满所选部位。' : '图片会等比例放到选中的部位。'}上杆后可在「精细调整」中移动或缩放。</p>
        </div>
        </div>
        {(draft.source === 'ai' || draft.source === 'upload') && images.length > 0 && <details className="quiet-details"><summary>{draft.source === 'ai' ? '从素材库中选参考图' : '从素材库中选择'}</summary><div className="image-picker">{images.map((a) => <button key={a.id} title={a.name} aria-label={a.name} aria-pressed={draft.source === 'ai' ? draft.refs.includes(a.id) : draft.uploadId === a.id} onClick={() => patch(draft.source === 'ai' ? { refs: draft.refs.includes(a.id) ? draft.refs.filter((id) => id !== a.id) : [...draft.refs, a.id] } : { uploadId: a.id })}><AssetThumb blobKey={a.blobKey} className="h-full w-full object-contain" /></button>)}</div></details>}
        <details className="quiet-details"><summary>更多选项 <span>可跳过</span></summary><div className="advanced-options">{draft.source === 'ai' && <><Field label="风格"><TextInput value={draft.style} onChange={(e) => patch({ style: e.target.value })} /></Field><Field label="配色"><TextInput value={draft.palette} onChange={(e) => patch({ palette: e.target.value })} /></Field><Field label="想保留什么"><TextInput value={draft.keep} onChange={(e) => patch({ keep: e.target.value })} /></Field><Field label="不想出现什么"><TextInput value={draft.avoid} onChange={(e) => patch({ avoid: e.target.value })} /></Field></>}{isGeneration && <><Field label="生成几套方案"><Select aria-label="生成几套方案" value={draft.n} onChange={(e) => patch({ n: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} 套</option>)}</Select></Field>{draft.textureMode !== 'wrap' && <><Toggle checked={draft.removeWhite} onChange={(value) => patch({ removeWhite: value })} label="自动去掉白色背景" /><p className="helper-text">白色主体较多时建议关闭。原始生成图会保留。</p></>}</>}<Toggle checked={draft.replace} onChange={(value) => patch({ replace: value })} label="替换所选部位的原有图案" /><p className="helper-text">锁定图层会保留。关闭后，新图案会叠加在原图案上。</p></div></details>
      </>}
      {draft.step === 2 && <>
        <p className="helper-text">贴图模式：{(!isGeneration ? textureMode : currentJob?.input.scope?.textureMode) === 'wrap' ? '整圈包覆 · 绕满所选部位一周' : '细长装饰 · 等比例贴花'}</p>
        {applied && <div className="applied-banner"><CheckCircle2 size={20} /><div><strong>已经上杆，看看左侧效果</strong><p>可以撤销重选，满意后保存到我的作品。</p></div></div>}
        {!isGeneration && uploaded ? <div className="uploaded-selection"><AssetThumb blobKey={uploaded.blobKey} className="h-48 w-full object-contain" /><span>{uploaded.name}</span>{!applied && <Button variant="primary" onClick={applyUpload}>把图案放上球杆</Button>}</div> : isGeneration && currentJob ? <>
          {running && <div className="generation-progress" role="status"><Loader2 size={30} className="animate-spin" /><strong>正在为你设计图案</strong><p>通常需要几分钟，可以先调整左侧底色。</p>{currentJob.progress && <><progress value={currentJob.progress.done} max={currentJob.progress.total} /><small>{currentJob.progress.done} / {currentJob.progress.total} 张已完成</small></>}<Button variant="ghost" onClick={() => cancelJob(currentJob.id)}>停止生成</Button></div>}
          {['failed', 'cancelled', 'needs-review'].includes(currentJob.status) && <div className="job-error"><strong>{currentJob.status === 'cancelled' ? '生成已停止' : currentJob.status === 'needs-review' ? '这次生成需要检查' : '这次没能完成生成'}</strong><p>已经完成的方案仍可使用。检查服务设置后，可以返回修改想法并重新生成。</p>{currentJob.error && <details><summary>查看原因</summary><p>{currentJob.error}</p></details>}<a href="#/settings">查看服务设置 <ArrowRight size={14} /></a></div>}
          {currentJob.candidates?.map((candidate, index) => <article key={candidate.id} className={`candidate-card ${isApplied(candidate) ? 'is-applied' : ''}`}><header><strong>方案 {String(index + 1).padStart(2, '0')}</strong>{isApplied(candidate) && <span><Check size={14} />正在使用</span>}</header><div className="candidate-art">{candidate.partAssets.map((ref) => { const asset = images.find((a) => a.id === ref.assetId), part = currentJob.input.scope?.parts.find((p) => p.id === ref.partId); return asset && <div key={ref.partId}><AssetThumb blobKey={asset.blobKey} className="h-full w-full object-contain" /><small>{shortName(part?.name || '图案')}</small></div>; })}</div><Button variant={isApplied(candidate) ? 'outline' : 'primary'} className="w-full" onClick={() => apply(currentJob, candidate)}>{isApplied(candidate) ? '再次应用这套方案' : '用这套，看看上杆效果'}<ArrowRight size={16} /></Button><details className="quiet-details"><summary>单独使用或剪切某个部位</summary><div className="candidate-parts">{candidate.partAssets.map((ref) => { const asset = images.find((a) => a.id === ref.assetId), part = currentJob.input.scope?.parts.find((p) => p.id === ref.partId); return asset && <div key={ref.partId}><span>{shortName(part?.name || '图案')}</span><Button size="sm" variant="outline" onClick={() => apply(currentJob, candidate, ref.partId)}>仅用这里</Button><Button size="icon" variant="ghost" aria-label={`剪切 ${part?.name}`} onClick={() => openCutoutForAsset(asset)}><Scissors size={14} /></Button>{asset.processingWarning && <p>{asset.processingWarning}</p>}{asset.originalBlobKey && <details><summary>原始生成图</summary><AssetThumb blobKey={asset.originalBlobKey} className="h-28 w-full object-contain" /></details>}</div>; })}</div></details></article>)}
          {!currentJob.input.scope && currentJob.resultAssetIds.length > 0 && <div className="image-picker">{currentJob.resultAssetIds.map((id) => { const a = images.find((asset) => asset.id === id); return a && <button key={id} aria-label={`使用 ${a.name}`} onClick={() => { requestedSource.current = 'upload'; patch({ source: 'upload', uploadId: id }); }}><AssetThumb blobKey={a.blobKey} className="h-full w-full object-contain" /></button>; })}</div>}
        </> : <div className="empty-result"><Sparkles size={32} /><strong>你的第一套方案，从一个想法开始</strong><p>选一个风格，或上传自己的图片。</p><Button variant="outline" onClick={() => go(1)}>去选一个风格</Button></div>}
        {jobs.length > 0 && <details className="quiet-details job-history"><summary>之前生成的方案</summary>{jobs.slice(0, 12).map((job) => <button key={job.id} onClick={() => { requestedSource.current = 'ai'; patch({ jobId: job.id, source: 'ai' }); }}><span>{job.input.subject}</span><small>{STATUS_LABEL[job.status]}</small></button>)}</details>}
      </>}
      {error && <div className="form-error" role="alert"><p>{error}</p>{needSetup && <a href="#/settings">去连接服务 <ArrowRight size={14} /></a>}</div>}
    </div>
    <footer className="wizard-footer" ref={footerRef}>
      {draft.step === 0 && <><p>下一步：从纹样库选料，或设计自己的图案</p><Button variant="primary" className="w-full" disabled={!valid} onClick={() => go(1)}>选好了，下一步<ArrowRight size={17} /></Button></>}
      {draft.step === 1 && <><p>{isGeneration ? `生成 ${draft.n} 套 · 共 ${draft.n * (selected.length + (draft.mode === 'linked' ? 1 : 0))} 张图片，按所连接服务计费` : `图案将应用到 ${selected.length} 个部位，无需 AI 生成`}</p><div className="footer-actions"><Button variant="outline" aria-label="返回选择部位" onClick={() => go(0)}><ArrowLeft size={17} /></Button><Button variant="primary" className="flex-1" disabled={busy || !valid || (isGeneration ? !generationReady || running : !uploaded)} onClick={isGeneration ? generate : applyUpload}>{busy ? <Loader2 size={17} className="animate-spin" /> : isGeneration ? <Sparkles size={17} /> : <Check size={17} />}{busy ? '请稍候…' : isGeneration ? '生成我的方案' : '把图案放上球杆'}</Button></div></>}
      {draft.step === 2 && <><p>{applied ? '满意了就保存，下次还可以继续编辑。' : running ? '生成过程中请保持此页面打开。' : '先把喜欢的方案放上球杆，再保存设计。'}</p><div className="footer-actions"><Button variant="outline" onClick={() => go(1)}><ArrowLeft size={15} />修改想法</Button>{applied && <Button variant="primary" className="flex-1" onClick={saveCurrentProduct}>保存到我的作品</Button>}</div></>}
    </footer>
  </section>;
}
