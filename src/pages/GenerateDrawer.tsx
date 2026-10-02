import { useEffect, useMemo, useState } from 'react';
import { Link2, Scissors, Sparkles, Upload } from 'lucide-react';
import type { ArtworkCandidate, ArtworkScope, GenerationJob } from '../core/types';
import { resolveTemplate } from '../cue/templates';
import { ARTWORK_PRESETS, applyArtworkToDesign, artworkParts, createArtworkScope } from '../cue/artwork';
import { STATUS_LABEL, cancelJob, startGeneration } from '../ai/client';
import { activeAssets, nextStickerId, useStore } from '../state/store';
import { openCutoutForAsset } from '../editor/CutoutEditor';
import { handleUploadFiles } from './Workbench';
import { AssetThumb } from './panels';
import { Badge, Button, Field, Segmented, Select, TextInput, Toggle } from '../ui/components';

export function GenerateDrawer() {
  const open = useStore((s) => s.generateOpen);
  const design = useStore((s) => s.design);
  const jobs = useStore((s) => s.jobs);
  const assets = useStore((s) => s.assets);
  const request = useStore((s) => s.generationRequest);
  const tpl = useMemo(() => resolveTemplate(design.cueTemplateId), [design.cueTemplateId]);
  const parts = artworkParts(tpl, design);
  const [mode, setMode] = useState<ArtworkScope['mode']>('linked');
  const [ids, setIds] = useState<string[]>(ARTWORK_PRESETS[0].ids);
  const [form, setForm] = useState({ subject: '', style: '', palette: '', keep: '', avoid: '', n: 1 });
  const [refs, setRefs] = useState<string[]>([]);
  const [removeWhite, setRemoveWhite] = useState(true);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const st = useStore.getState();
    const sticker = st.design.stickers.find((s) => s.id === st.selection.id);
    const currentPart = request?.partId ?? (st.selection.kind === 'part' ? st.selection.id : sticker?.target.kind === 'lathe' ? sticker.target.segId : sticker?.target.faceId);
    const available = artworkParts(tpl, st.design);
    const isPrintable = available.some((p) => p.id === currentPart);
    const nextMode = request?.mode ?? (isPrintable ? 'single' : 'linked');
    setMode(nextMode);
    setIds(nextMode === 'single' ? [isPrintable ? currentPart! : 'butt-forearm']
      : [...new Set([...ARTWORK_PRESETS[0].ids, ...(isPrintable ? [currentPart!] : [])])].filter((id) => available.some((p) => p.id === id)));
    setError('');
    if (nextMode === 'single' && isPrintable) {
      const current = sticker ?? [...st.design.stickers].reverse().find((s) =>
        (s.target.kind === 'lathe' ? s.target.segId : s.target.faceId) === currentPart);
      if (current && st.assets.some((a) => a.id === current.assetId && !a.removed)) setRefs([current.assetId]);
    }
  }, [open, tpl.id, request]);

  if (!open) return null;
  const selected = parts.filter((p) => ids.includes(p.id));
  const valid = mode === 'single' ? selected.length === 1 : selected.length >= 2;
  const requestCount = form.n * (selected.length + (mode === 'linked' ? 1 : 0));
  const changeMode = (next: ArtworkScope['mode']) => {
    setMode(next);
    setIds(next === 'single' ? [ids[0] ?? 'butt-forearm'] : ids.length >= 2 ? ids : ARTWORK_PRESETS[0].ids);
    setError('');
  };
  const generate = async () => {
    setBusy(true); setError('');
    try {
      const scope = createArtworkScope(tpl, design, mode, ids);
      await startGeneration({ ...form, refAssetIds: refs, scope, removeWhite }, refs.length ? 'edit' : 'generate');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const apply = (job: GenerationJob, candidate: ArtworkCandidate, onlyPartId?: string) => {
    try {
      const st = useStore.getState();
      if (!job.input.scope) return;
      const next = applyArtworkToDesign(st.design, job.input.scope, candidate, st.assets, { replace, onlyPartId }, nextStickerId);
      st.pushHistory();
      st.set({ design: next, placementAssetId: null, selection: { kind: 'global' }, leftDrawerOpen: true, leftDrawerTab: 'layers', view: 'butt', focusPartId: null, viewNonce: st.viewNonce + 1 });
      st.showToast(onlyPartId ? '已应用该部位图案，可撤销' : '已应用整套联动图案，可一次撤销');
      setError('');
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-[380px] max-w-full flex-col border-l border-ink-700 bg-ink-900/95 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink-100"><Sparkles size={15} /> AI 定制图案</span>
        <Button size="icon" variant="ghost" aria-label="关闭 AI 定制" onClick={() => useStore.getState().set({ generateOpen: false })}>✕</Button>
      </div>
      <div className="flex-1 space-y-4 overflow-auto p-3">
        <div className="space-y-3 rounded-lg border border-ink-700 bg-ink-850 p-3">
          <Segmented value={mode} options={[{ value: 'linked', label: '多部位联动' }, { value: 'single', label: '单独调整部位' }]} onChange={changeMode} />
          {mode === 'linked' ? <>
            <div className="flex flex-wrap gap-1.5">
              {ARTWORK_PRESETS.map((p) => <Button key={p.name} size="sm" variant="outline" title={p.note} onClick={() => setIds(p.ids)}>{p.name}</Button>)}
            </div>
            <div className="space-y-1">
              {parts.map((p) => <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-xs text-ink-200 hover:bg-ink-750">
                <input type="checkbox" checked={ids.includes(p.id)} onChange={(e) => setIds(e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id))} className="accent-amber-500" />
                <span className="flex-1">{p.name}</span>
                <span className="text-xxs text-ink-500">{p.id === 'grip' ? '可选' : p.id.startsWith('ring-') ? '配套环线' : p.id.startsWith('butt-') ? '主纹样' : ''}</span>
              </label>)}
            </div>
            <p className="text-xxs leading-relaxed text-ink-400">前臂与尾段呼应主纹样，装饰环共享边框和配色。握把可保留缠面，也可勾选加入通体设计。</p>
          </> : <Field label="调整部位">
            <Select aria-label="调整部位" value={ids[0] ?? ''} onChange={(e) => setIds([e.target.value])}>
              {parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <p className="text-xxs leading-relaxed text-ink-400">只生成并应用到此部位。可选用已有图案作为参考，延续当前方案。</p>
          </Field>}
          <div className="flex items-start gap-1.5 text-xxs text-accent-400"><Link2 size={12} className="mt-0.5 shrink-0" /><span>{selected.length ? selected.map((p) => p.name).join(' / ') : '请选择部位'}</span></div>
          {!valid && <p className="text-xxs text-amber-300">{mode === 'linked' ? '至少勾选两个部位，或切换到单独调整。' : '请选择一个部位。'}</p>}
        </div>
        <Field label="主题（画什么）"><TextInput value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="例：青绿贝母长尖插花、银色边框" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="风格"><TextInput value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })} placeholder="经典镶嵌 / 极简线条" /></Field>
          <Field label="配色"><TextInput value={form.palette} onChange={(e) => setForm({ ...form, palette: e.target.value })} placeholder="青绿、银白、黑" /></Field>
        </div>
        <Field label="保留内容"><TextInput value={form.keep} onChange={(e) => setForm({ ...form, keep: e.target.value })} placeholder="例：沿用参考图的菱形环线" /></Field>
        <Field label="避免内容"><TextInput value={form.avoid} onChange={(e) => setForm({ ...form, avoid: e.target.value })} placeholder="例：品牌文字、复杂渐变" /></Field>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xxs text-ink-400"><span>参考图（实物或已有图案）</span>
            <label className="flex cursor-pointer items-center gap-1 text-accent-400"><Upload size={11} /> 上传
              <input type="file" accept="image/*" multiple hidden onChange={async (e) => {
                const files = e.target.files; if (!files?.length) return;
                const before = new Set(useStore.getState().assets.map((a) => a.id));
                try {
                  await handleUploadFiles(files);
                  e.target.value = '';
                  const added = useStore.getState().assets.filter((a) => !before.has(a.id)).map((a) => a.id);
                  setRefs((previous) => [...new Set([...previous, ...added])]);
                } catch { setError('参考图上传失败，请重试'); }
              }} />
            </label>
          </div>
          <div className="grid max-h-32 grid-cols-5 gap-1.5 overflow-auto rounded-md border border-ink-700 p-1.5">
            {activeAssets(assets).map((a) => <button key={a.id} title={a.name} aria-label={`参考图：${a.name}`} aria-pressed={refs.includes(a.id)} onClick={() => setRefs(refs.includes(a.id) ? refs.filter((r) => r !== a.id) : [...refs, a.id])} className={`aspect-square overflow-hidden rounded border ${refs.includes(a.id) ? 'border-accent-500 ring-1 ring-accent-500' : 'border-ink-600'}`}>
              <AssetThumb key={`${a.id}:${a.revision ?? 0}`} blobKey={a.blobKey} className="h-full w-full object-contain" />
            </button>)}
            {!activeAssets(assets).length && <span className="col-span-5 py-2 text-center text-xxs text-ink-500">上传参考图，或直接描述设计</span>}
          </div>
        </div>
        <div className="space-y-1">
          <Toggle checked={removeWhite} onChange={setRemoveWhite} label="自动去白底并裁去留白" />
          <p className="text-xxs leading-relaxed text-ink-500">原图会保留；大面积白色主体建议关闭，之后手动剪切。</p>
          <Toggle checked={replace} onChange={setReplace} label="应用时替换所选部位的已有图案" />
          <p className="text-xxs text-ink-500">锁定的图层会保留。关闭替换可叠加新图案。</p>
        </div>
        <div className="flex items-end gap-2">
          <Field label="候选方案数量"><Select aria-label="候选方案数量" value={form.n} onChange={(e) => setForm({ ...form, n: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} 套</option>)}</Select></Field>
          <Button className="flex-1" variant="primary" onClick={generate} disabled={busy || !valid || !form.subject.trim()}>{busy ? '提交中…' : mode === 'linked' ? `联动生成 ${selected.length} 个部位` : '生成此部位'}</Button>
        </div>
        <p className="text-xxs leading-relaxed text-ink-400">{mode === 'linked' ? `每套包含 1 张风格母稿和 ${selected.length} 张部位图案，共请求 ${requestCount} 张图。` : `共请求 ${requestCount} 张图。`}生成后先查看候选，再选择应用；可继续编辑或取消任务。</p>
        {error && <p role="alert" className="rounded-md bg-red-950/50 p-2 text-xs text-red-300">{error}</p>}
        <div className="space-y-3 border-t border-ink-700 pt-3">
          <div className="text-xs font-semibold text-ink-300">任务与候选方案</div>
          {!jobs.length && <p className="text-xxs text-ink-500">还没有生成任务</p>}
          {jobs.slice(0, 8).map((j) => <div key={j.id} className="space-y-2 rounded-lg border border-ink-700 bg-ink-850 p-2.5">
            <div className="flex items-center justify-between"><Badge tone={j.status === 'success' ? 'ok' : j.status === 'failed' ? 'err' : j.status === 'needs-review' ? 'warn' : 'default'}>{STATUS_LABEL[j.status]}</Badge><span className="text-xxs text-ink-500">{j.input.scope?.mode === 'linked' ? '联动方案' : j.input.scope ? '单部位' : '图案'} · {j.model}</span></div>
            <p className="text-xs text-ink-200">{j.input.subject}</p>
            {j.input.scope && <p className="text-xxs text-ink-400">{j.input.scope.cueTemplateName} · {j.input.scope.parts.map((p) => p.name).join(' / ')}</p>}
            {j.progress && <div className="text-xxs text-ink-400">{j.progress.done}/{j.progress.total} · {j.progress.label}</div>}
            {j.error && <p className="text-xxs text-red-300">{j.error}</p>}
            {(j.status === 'queued' || j.status === 'running') && <Button size="sm" variant="outline" onClick={() => cancelJob(j.id)}>取消任务</Button>}
            {j.candidates?.map((c, i) => <div key={c.id} className="space-y-2 border-t border-ink-700 pt-2">
              <div className="flex items-center justify-between"><span className="text-xxs text-ink-300">候选方案 {i + 1}</span><Button size="sm" variant="primary" onClick={() => apply(j, c)}>{j.input.scope?.mode === 'linked' ? '应用整套' : '应用此部位'}</Button></div>
              {c.masterAssetId && <details className="text-xxs text-ink-400"><summary className="cursor-pointer">查看统一风格母稿</summary><AssetThumb blobKey={`blob:${c.masterAssetId}`} className="mt-1 max-h-36 w-full rounded bg-white object-contain" /></details>}
              <div className="grid grid-cols-2 gap-2">{c.partAssets.map((ref) => {
                const a = assets.find((asset) => asset.id === ref.assetId);
                if (!a) return null;
                const p = j.input.scope?.parts.find((part) => part.id === ref.partId);
                return <div key={ref.partId} className="space-y-1">
                  <div className="flex h-24 items-center justify-center rounded border border-ink-600 bg-ink-700"><AssetThumb key={`${a.id}:${a.revision ?? 0}`} blobKey={a.blobKey} className="max-h-full max-w-full object-contain p-1" /></div>
                  <div className="truncate text-xxs text-ink-300" title={p?.name}>{p?.name}</div>
                  {a.processingWarning && <p className="text-xxs text-amber-300">{a.processingWarning}</p>}
                  <div className="flex gap-1"><Button size="sm" variant="outline" className="flex-1" onClick={() => apply(j, c, ref.partId)}>仅此部位</Button><Button size="sm" variant="ghost" aria-label={`剪切 ${p?.name}`} onClick={() => openCutoutForAsset(a)}><Scissors size={11} /></Button></div>
                  {a.originalBlobKey && <details className="text-xxs text-ink-400"><summary className="cursor-pointer">查看原始生成图</summary><AssetThumb blobKey={a.originalBlobKey} className="h-24 w-full bg-white object-contain" /></details>}
                </div>;
              })}</div>
            </div>)}
            {!j.input.scope && j.status === 'success' && <div className="grid grid-cols-3 gap-2">{j.resultAssetIds.map((id) => <button key={id} className="text-xxs text-ink-200" onClick={() => { useStore.getState().setPlacementAsset(id); useStore.getState().set({ generateOpen: false }); }}><AssetThumb blobKey={`blob:${id}`} className="h-20 w-full rounded bg-white object-contain" />放置图案</button>)}</div>}
          </div>)}
        </div>
      </div>
    </div>
  );
}
