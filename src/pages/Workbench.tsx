import { useEffect, useMemo, useState } from 'react';
import { Check, CloudUpload, Download, Grid2x2, History, Loader2, Redo2, Ruler, Save, Undo2 } from 'lucide-react';
import { CueScene } from '../three/Scene';
import { resolveTemplate } from '../cue/templates';
import { useStore } from '../state/store';
import { glRef, exportPrintPng, previewUnfold } from '../export/exportPng';
import type { ExportOptions } from '../export/exportPng';
import { buildUnfoldTemplate, sheetPixels } from '../cue/unwrap';
import { Badge, Button, Dialog, Field, NumberInput, Collapse, Select, Toggle } from '../ui/components';
import { LeftDrawer, RightPanel } from './panels';
import { GenerateDrawer } from './GenerateDrawer';
import { nextStickerId } from '../state/store';
import { loadImage } from '../state/imageStore';

// 球杆设计工作台（plan.md §3.1）：球杆居中，左侧统一抽屉（部件／图层／素材），右侧当前对象属性。

export function Workbench() {
  const cueTemplateId = useStore((s) => s.design.cueTemplateId);
  const tpl = useMemo(() => resolveTemplate(cueTemplateId), [cueTemplateId]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar />
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <CueScene tpl={tpl} />
          <DrawerToggle />
          <LeftDrawer tpl={tpl} />
          <ViewBar />
        </div>
        <div className="w-80 shrink-0 border-l border-ink-700 bg-ink-900">
          <RightPanel tpl={tpl} />
        </div>
      </div>
      <GenerateDrawer />
      <ExportDialog tpl={tpl} />
      <UnfoldCheckDialog tpl={tpl} />
      <VersionsDialog tpl={tpl} />
      <input
        id="global-upload"
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files;
          if (!files?.length) return;
          void handleUploadFiles(files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export async function handleUploadFiles(files: FileList) {
  for (const f of Array.from(files)) {
    if (!f.type.startsWith('image/')) continue;
    const url = URL.createObjectURL(f);
    const img = await loadImage(url).catch(() => null);
    URL.revokeObjectURL(url);
    const id = nextStickerId().replace('st-', 'as-');
    useStore.getState().addAsset(
      {
        id,
        name: f.name.replace(/\.[^.]+$/, '').slice(0, 24),
        source: 'upload',
        tags: [],
        w: img?.naturalWidth ?? 512,
        h: img?.naturalHeight ?? 512,
        blobKey: `blob:${id}`,
        createdAt: Date.now()
      },
      f
    );
  }
  useStore.getState().showToast('素材已入库，点击图案即可放置到杆身');
}

function DrawerToggle() {
  const open = useStore((s) => s.leftDrawerOpen);
  return (
    <button
      onClick={() => useStore.setState({ leftDrawerOpen: !open })}
      title={open ? '收起面板' : '展开面板'}
      className={`absolute top-3 z-30 flex h-9 w-9 items-center justify-center rounded-lg border border-ink-600 bg-ink-900/95 text-ink-200 shadow-xl backdrop-blur transition-all duration-200 hover:bg-ink-750 ${
        open ? 'left-[17.75rem]' : 'left-3'
      }`}
    >
      <svg viewBox="0 0 16 16" className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M10 3 L5 8 L10 13" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function TopBar() {
  const design = useStore((s) => s.design);
  const saveState = useStore((s) => s.saveState);
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-ink-700 bg-ink-900 px-3">
      <input
        value={design.name}
        onChange={(e) => useStore.getState().renameDesign(e.target.value)}
        className="h-8 w-36 shrink-0 rounded-md border border-transparent bg-transparent px-2 text-sm font-medium text-ink-100 outline-none transition-colors hover:border-ink-600 focus:border-accent-500"
      />
      <SaveStateBadge state={saveState} />
      <div className="mx-0.5 h-6 w-px shrink-0 bg-ink-700" />
      <div className="shrink-0 text-xs text-ink-300">
        大头杆 · {resolveTemplate(design.cueTemplateId).lengthMm} mm
      </div>
      <div className="flex-1" />
      <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
        <Button variant="ghost" size="icon" title="撤销" onClick={() => useStore.getState().undo()} disabled={!past.length}>
          <Undo2 size={15} />
        </Button>
        <Button variant="ghost" size="icon" title="重做" onClick={() => useStore.getState().redo()} disabled={!future.length}>
          <Redo2 size={15} />
        </Button>
        <span className="mx-0.5 h-6 w-px bg-ink-700" />
        <Button variant="outline" size="sm" onClick={() => useStore.getState().set({ versionsOpen: true })}>
          <History size={13} /> 版本
        </Button>
        <Button variant="outline" size="sm" onClick={() => useStore.getState().set({ exportOpen: 'check' })}>
          <Ruler size={13} /> 展开检查
        </Button>
        <Button variant="primary" size="sm" onClick={() => useStore.getState().set({ exportOpen: true })}>
          <Download size={13} /> 导出 PNG
        </Button>
      </div>
    </div>
  );
}

function SaveStateBadge({ state }: { state: 'saved' | 'saving' | 'error' }) {
  if (state === 'saving') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xxs text-ink-400">
        <Loader2 size={11} className="animate-spin" /> 保存中
      </span>
    );
  }
  if (state === 'error') {
    return <span className="shrink-0 text-xxs text-red-300">保存失败</span>;
  }
  return (
    <span className="flex shrink-0 items-center gap-1 text-xxs text-ink-500">
      <Check size={11} className="text-emerald-400" /> 已保存
    </span>
  );
}

function ViewBar() {
  const view = useStore((s) => s.view);
  const fps = useStore((s) => s.fps);
  const placementAssetId = useStore((s) => s.placementAssetId);
  const views: { id: typeof view; label: string }[] = [
    { id: 'whole', label: '整杆' },
    { id: 'shaft', label: '前节' },
    { id: 'butt', label: '后把' },
    { id: 'joint', label: '接头' },
    { id: 'face', label: '端面' }
  ];
  const current = view === 'focus' ? 'focus' : view;
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2">
      {placementAssetId && (
        <div className="pointer-events-auto rounded-lg border border-accent-500/50 bg-accent-500/15 px-3 py-1.5 text-xs text-accent-400 shadow-xl backdrop-blur">
          点击杆身放置图案 · 按 Esc 取消
        </div>
      )}
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-900/95 p-1 shadow-xl backdrop-blur">
        {views.map((v) => (
          <button
            key={v.id}
            onClick={() => useStore.setState((st) => ({ view: v.id, focusPartId: null, viewNonce: st.viewNonce + 1 }))}
            className={`rounded px-2.5 py-1 text-xs transition-all duration-150 ${
              view === v.id ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            {v.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-ink-700" />
        <span className="px-1.5 text-xxs text-ink-500" title="滚轮缩放 · 拖动空白处旋转 · 双击部件聚焦">
          {import.meta.env.DEV ? `${fps} fps · ` : ''}双击聚焦
        </span>
      </div>
    </div>
  );
}

// —— 导出对话框 ——

function ExportDialog({ tpl }: { tpl: ReturnType<typeof resolveTemplate> }) {
  const openRaw = useStore((s) => s.exportOpen);
  const open = openRaw === true;
  const design = useStore((s) => s.design);
  const hasCheckData = useStore((s) => !!s.exportCheckData);
  const checkMode = useStore((s) => s.exportCheckMode);
  const [ppi, setPpi] = useState(300);
  const [bleed, setBleed] = useState(2);
  const [overlap, setOverlap] = useState(3);
  const [rowWidth, setRowWidth] = useState(640);
  const [mirror, setMirror] = useState(false);
  const [busy, setBusy] = useState(false);

  const opts: ExportOptions = { ppi, bleedMm: bleed, overlapMm: overlap, rowWidthMm: rowWidth, mirror, designName: design.name };
  const tplPreview = useMemo(() => {
    try {
      return buildUnfoldTemplate(tpl, opts);
    } catch {
      return null;
    }
  }, [tpl, ppi, bleed, overlap, rowWidth, mirror]);
  const px = tplPreview ? sheetPixels(tplPreview) : null;

  const close = () => useStore.getState().set({ exportOpen: false });

  const doExport = async () => {
    setBusy(true);
    try {
      const v = useStore.getState().saveVersion(`${design.name} · 导出快照`, '导出前自动保存');
      await exportPrintPng(tpl, { ...opts, versionId: v.id });
      useStore.getState().showToast('已导出透明 PNG（含生产展开模板块）');
    } catch (e) {
      useStore.getState().showToast(`导出失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} title="导出生产 PNG（水贴／转印）" wide>
      <div className="grid grid-cols-2 gap-4 p-4">
        <div className="space-y-3">
          <Field label="目标像素密度 PPI" hint="px = mm ÷ 25.4 × PPI">
            <Select value={ppi} onChange={(e) => setPpi(Number(e.target.value))}>
              <option value={150}>150 PPI（预览／小样）</option>
              <option value={300}>300 PPI（常用印刷）</option>
              <option value={600}>600 PPI（高精度）</option>
            </Select>
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="出血 (mm)">
              <NumberInput value={bleed} min={0} max={10} onChange={(e) => setBleed(Number(e.target.value))} />
            </Field>
            <Field label="搭接 (mm)">
              <NumberInput value={overlap} min={0} max={20} onChange={(e) => setOverlap(Number(e.target.value))} />
            </Field>
            <Field label="行宽 (mm)">
              <NumberInput value={rowWidth} min={210} max={1300} step={10} onChange={(e) => setRowWidth(Number(e.target.value))} />
            </Field>
          </div>
          <Toggle checked={mirror} onChange={setMirror} label="镜像输出（按贴附方式决定）" />
          <div className="rounded-md bg-ink-800 p-3 text-xs leading-relaxed text-ink-300">
            <div className="mb-1 font-semibold text-ink-100">主交付规范</div>
            单张 PNG · 真实 Alpha 透明底 · 仅含印刷图层；
            <span className="text-ink-400">不含</span>底材、漆面高光、灯光、阴影、UV 辅助线。
            白色图案按原色保留。版面保持模板定义，不自动裁切透明留白。
          </div>
        </div>
        <div className="space-y-3">
          <Collapse title="展开版面摘要">
            {tplPreview && px ? (
              <div className="space-y-1.5 text-xs text-ink-300">
                <div className="flex justify-between">
                  <span>版面尺寸</span>
                  <span className="text-ink-100">
                    {tplPreview.sheetWmm} × {tplPreview.sheetHmm} mm
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>输出像素</span>
                  <span className="text-ink-100">
                    {px.w} × {px.h} px
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>展开块</span>
                  <span className="text-ink-100">{tplPreview.blocks.length} 块</span>
                </div>
                <div className="flex justify-between">
                  <span>贴纸数</span>
                  <span className="text-ink-100">{design.stickers.filter((s) => !s.hidden).length} 个</span>
                </div>
                <div className="flex justify-between">
                  <span>模板版本</span>
                  <Badge>{tplPreview.version}</Badge>
                </div>
              </div>
            ) : (
              <div className="text-xs text-ink-500">计算中…</div>
            )}
          </Collapse>
          <Button variant="primary" className="w-full" onClick={doExport} disabled={busy}>
            {busy ? '合成中…' : '导出透明 PNG'}
          </Button>
          <Button
            variant={checkMode ? 'primary' : 'outline'}
            className="w-full"
            disabled={!hasCheckData}
            onClick={() => {
              useStore.getState().set({ exportCheckMode: !checkMode });
              if (!checkMode) {
                close();
                useStore.getState().showToast('回贴检查中：球杆当前显示导出 PNG 的回贴结果');
              }
            }}
          >
            <Grid2x2 size={14} /> {checkMode ? '退出回贴检查' : '回贴检查（从导出 PNG 重载）'}
          </Button>
          {!hasCheckData && <p className="text-xxs text-ink-500">先完成一次导出，再进行回贴一致性检查。</p>}
        </div>
      </div>
    </Dialog>
  );
}

// —— 展开检查对话框 ——

function UnfoldCheckDialog({ tpl }: { tpl: ReturnType<typeof resolveTemplate> }) {
  const exportOpen = useStore((s) => s.exportOpen);
  const open = exportOpen === 'check';
  const design = useStore((s) => s.design);
  const [preview, setPreview] = useState<string | null>(null);
  const [info, setInfo] = useState<{ blocks: { label: string; wMm: number; hMm: number }[]; w: number; h: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    (async () => {
      const r = await previewUnfold(tpl, {
        ppi: 300,
        bleedMm: 2,
        overlapMm: 3,
        rowWidthMm: 640,
        mirror: false,
        designName: design.name
      });
      if (dead) return;
      setPreview(r.canvas.toDataURL('image/png'));
      setInfo({
        blocks: r.tpl.blocks.map((b) => ({ label: b.label, wMm: b.wMm, hMm: b.hMm })),
        w: r.tpl.sheetWmm,
        h: r.tpl.sheetHmm
      });
    })();
    return () => {
      dead = true;
    };
  }, [open, tpl, design.name]);

  return (
    <Dialog open={open} onClose={() => useStore.getState().set({ exportOpen: false })} title="展开版面检查" wide>
      <div className="space-y-3 p-4">
        <p className="text-xs leading-relaxed text-ink-400">
          展开块按周长×轴长的毫米比例排布（锥度曲面分段近似），此预览仅含印刷图层。复杂曲面不能默认无失真铺平，正式生产前需经工厂纸样试贴校准。
        </p>
        <div className="flex max-h-96 items-start justify-center overflow-auto rounded-md border border-ink-700 bg-[repeating-conic-gradient(#3a3f47_0%_25%,#2b3037_0%_50%)] bg-[length:16px_16px] p-3">
          {preview ? <img src={preview} alt="展开预览" className="max-w-full" /> : <span className="p-10 text-xs text-ink-500">合成中…</span>}
        </div>
        {info && (
          <div className="text-xxs text-ink-500">
            版面 {info.w} × {info.h} mm · {info.blocks.length} 块 ·
            {' '}
            {info.blocks
              .slice(0, 8)
              .map((b) => `${b.label} ${b.wMm.toFixed(0)}×${b.hMm.toFixed(0)}`)
              .join('；')}
            {info.blocks.length > 8 ? ' …' : ''}
          </div>
        )}
      </div>
    </Dialog>
  );
}

// —— 版本对话框 ——

function VersionsDialog({ tpl }: { tpl: ReturnType<typeof resolveTemplate> }) {
  const open = useStore((s) => s.versionsOpen);
  const versions = useStore((s) => s.versions);
  const design = useStore((s) => s.design);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');

  const captureThumb = (): string | undefined => {
    const gl = glRef.current;
    try {
      return gl?.domElement.toDataURL('image/jpeg', 0.6);
    } catch {
      return undefined;
    }
  };

  return (
    <Dialog open={open} onClose={() => useStore.getState().set({ versionsOpen: false })} title="设计版本" wide>
      <div className="space-y-4 p-4">
        <div className="flex items-end gap-2">
          <Field label="版本名称">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={design.name}
              className="h-9 w-52 rounded-md border border-ink-600 bg-ink-900 px-2.5 text-sm text-ink-100 outline-none focus:border-accent-500"
            />
          </Field>
          <Field label="说明">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="本次改动备注"
              className="h-9 w-64 rounded-md border border-ink-600 bg-ink-900 px-2.5 text-sm text-ink-100 outline-none focus:border-accent-500"
            />
          </Field>
          <Button
            variant="primary"
            onClick={() => {
              const v = useStore.getState().saveVersion(name || design.name, note, captureThumb());
              useStore.getState().showToast(`已保存版本「${v.name}」`);
              setName('');
              setNote('');
            }}
          >
            <Save size={14} /> 保存当前为版本
          </Button>
        </div>
        <div className="space-y-2">
          {!versions.length && (
            <div className="flex flex-col items-start gap-2 text-sm text-ink-500">
              <span>还没有版本。显式保存可随时回到这里，自动保存始终进行中。</span>
              <Button size="sm" variant="outline" onClick={() => useStore.getState().saveVersion(design.name, '首个版本', captureThumb())}>
                <CloudUpload size={13} /> 立即保存第一个版本
              </Button>
            </div>
          )}
          {versions.map((v) => (
            <div key={v.id} className="flex items-center gap-3 rounded-md border border-ink-700 bg-ink-850 p-2.5">
              {v.thumb ? (
                <img src={v.thumb} alt="" className="h-12 w-20 rounded object-cover" />
              ) : (
                <div className="h-12 w-20 rounded bg-ink-800" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink-100">{v.name}</div>
                <div className="text-xxs text-ink-500">
                  {new Date(v.createdAt).toLocaleString()} · {v.note || '无备注'} · {resolveTemplate(v.cueTemplateId).name}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const pname = prompt('作品名称', v.name);
                  if (pname === null) return;
                  useStore.getState().addProduct({
                    id: `prod-${Date.now().toString(36)}`,
                    name: pname || v.name,
                    desc: '',
                    cover: v.thumb,
                    versionId: v.id,
                    createdAt: Date.now()
                  });
                  useStore.getState().showToast('已加入作品库');
                }}
              >
                存为作品
              </Button>
              <Button size="sm" variant="default" onClick={() => useStore.getState().restoreVersion(v.id)}>
                恢复
              </Button>
            </div>
          ))}
        </div>
        <p className="text-xxs text-ink-500">
          版本为不可变快照（贴纸、蒙版引用、材质、模板版本），修改预设不会静默改变历史作品。当前杆型：{tpl.name}。
        </p>
      </div>
    </Dialog>
  );
}
