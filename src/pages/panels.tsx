import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  ImagePlus,
  Layers,
  Lock,
  LockOpen,
  MoveUp,
  MoveDown,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Upload
} from 'lucide-react';
import { expandedSegments } from '../cue/templates';
import type { CueTemplate, FinishId, StickerInstance } from '../core/types';
import { latheSegOfSticker, faceOfSticker } from '../cue/mapping';
import { MATERIAL_PRESETS, FINISHES } from '../materials/presets';
import { effectivePpi } from '../editor/cutout';
import { openCutoutForSticker } from '../editor/CutoutEditor';
import { useStore, nextStickerId, activeAssets } from '../state/store';
import { blobUrl } from '../state/imageStore';
import { Badge, Button, Collapse, Field, NumberInput, Segmented, Select, Slider, TextInput, Toggle } from '../ui/components';

// 工作台侧栏：左侧统一抽屉（部件／图层／素材），右侧只显示当前对象属性。

const FINISH_OPTS: { value: FinishId; label: string }[] = FINISHES.map((f) => ({ value: f.id, label: f.name }));

// —— 左侧统一抽屉 ——

export function LeftDrawer({ tpl, embedded = false }: { tpl: CueTemplate; embedded?: boolean }) {
  const storedTab = useStore((s) => s.leftDrawerTab);
  const tab = embedded && storedTab === 'parts' ? 'layers' : storedTab;
  const open = useStore((s) => s.leftDrawerOpen);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      const url = URL.createObjectURL(f);
      const img = new Image();
      await new Promise((res) => {
        img.onload = res;
        img.onerror = res;
        img.src = url;
      });
      URL.revokeObjectURL(url);
      const id = nextStickerId().replace('st-', 'as-');
      useStore.getState().addAsset(
        {
          id,
          name: f.name.replace(/\.[^.]+$/, '').slice(0, 24),
          source: 'upload',
          tags: [],
          w: img.naturalWidth || 512,
          h: img.naturalHeight || 512,
          blobKey: `blob:${id}`,
          createdAt: Date.now()
        },
        f
      );
    }
    useStore.getState().showToast('素材已入库，点击图案即可放置到杆身');
    useStore.setState({ leftDrawerTab: 'assets' });
  };

  return (
    <div
      className={embedded ? 'embedded-library' : `absolute left-3 top-3 bottom-16 z-20 flex w-64 flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900/95 shadow-2xl backdrop-blur transition-all duration-200 ${
        open ? 'translate-x-0 opacity-100' : '-translate-x-[110%] opacity-0 pointer-events-none'
      }`}
    >
      <div className="flex shrink-0 border-b border-ink-700">
        {(
          [
            { id: 'parts', label: '部件' },
            { id: 'layers', label: '图层' },
            { id: 'assets', label: '素材' }
          ] as const
        ).filter((t) => !embedded || t.id !== 'parts').map((t) => (
          <button
            key={t.id}
            onClick={() => useStore.setState({ leftDrawerTab: t.id })}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors duration-150 relative ${
              tab === t.id ? 'text-accent-400' : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            {t.label}
            <span
              className={`absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-accent-500 transition-opacity duration-200 ${
                tab === t.id ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'parts' && <PartsTab tpl={tpl} />}
        {tab === 'layers' && <LayersTab onUpload={() => fileRef.current?.click()} />}
        {tab === 'assets' && <AssetsTab />}
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
    </div>
  );
}

function PartsTab({ tpl }: { tpl: CueTemplate }) {
  const selection = useStore((s) => s.selection);
  const segs = expandedSegments(tpl);
  const partItems = [
    ...segs.map((s) => ({ id: s.id, name: s.name, note: `${Math.round(s.a0)}–${Math.round(s.a1)}mm` })),
    ...tpl.faces.map((f) => ({ id: f.id, name: f.name, note: '端面' }))
  ];
  return (
    <div className="space-y-1 p-2">
      <p className="px-1.5 pb-1.5 text-xxs leading-relaxed text-ink-400">点击部件：选中并聚焦到画面中心。双击三维球杆同样生效。</p>
      {partItems.map((p) => (
        <button
          key={p.id}
          onClick={() => useStore.getState().focusPart(p.id)}
          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-all duration-150 active:scale-[0.99] ${
            selection.kind === 'part' && selection.id === p.id
              ? 'bg-accent-500/15 text-accent-400 ring-1 ring-accent-500/40'
              : 'text-ink-200 hover:bg-ink-750'
          }`}
        >
          <span className="truncate">{p.name}</span>
          <span className="ml-2 shrink-0 text-xxs text-ink-500">{p.note}</span>
        </button>
      ))}
    </div>
  );
}

export function LayersTab({ onUpload, onGenerate }: { onUpload: () => void; onGenerate?: () => void }) {
  const stickers = useStore((s) => s.design.stickers);
  const selection = useStore((s) => s.selection);
  const sorted = [...stickers].sort((a, b) => b.z - a.z);
  if (!sorted.length) {
    return (
      <div className="flex flex-col items-center gap-2.5 p-6 text-center">
        <Layers size={22} className="text-ink-600" />
        <p className="text-xs leading-relaxed text-ink-400">还没有贴纸。上传图案或用 AI 生成，点击后放到杆身上。</p>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={onUpload}>
            <Upload size={13} /> 上传图案
          </Button>
          <Button size="sm" variant="outline" onClick={onGenerate ?? (() => useStore.getState().set({ generateOpen: true, generationRequest: null }))}>
            <Sparkles size={13} /> AI 生成
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1 p-2">
      {sorted.map((s) => (
        <div
          key={s.id}
          className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors duration-150 ${
            selection.kind === 'sticker' && selection.id === s.id
              ? 'bg-accent-500/15 ring-1 ring-accent-500/40'
              : 'hover:bg-ink-750'
          }`}
        >
          <button
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            aria-pressed={selection.kind === 'sticker' && selection.id === s.id}
            title={s.name}
            onClick={() => useStore.getState().select({ kind: 'sticker', id: s.id })}
          >
            <span className={s.hidden ? 'text-ink-600' : 'text-ink-300'}>
              {s.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
            </span>
            <span className={`truncate ${s.hidden ? 'text-ink-500 line-through' : 'text-ink-200'}`}>{s.name}</span>
            {s.locked && <Lock size={11} className="text-ink-500" />}
          </button>
          <div className="flex gap-0.5">
            <IconBtn title="复制" onClick={() => useStore.getState().duplicateSticker(s.id)}>
              <Copy size={12} />
            </IconBtn>
            <IconBtn title="删除" onClick={() => useStore.getState().removeSticker(s.id)}>
              <Trash2 size={12} />
            </IconBtn>
          </div>
        </div>
      ))}
    </div>
  );
}

function AssetsTab() {
  const assets = useStore((s) => s.assets);
  const placementAssetId = useStore((s) => s.placementAssetId);
  const list = activeAssets(assets);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!list.length) {
    return (
      <div className="flex flex-col items-center gap-2.5 p-6 text-center">
        <ImagePlus size={22} className="text-ink-600" />
        <p className="text-xs leading-relaxed text-ink-400">素材库是空的。上传本地图案，或用 AI 直接生成。</p>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={() => document.getElementById('global-upload')?.click()}>
            <Upload size={13} /> 上传图案
          </Button>
          <Button size="sm" variant="outline" onClick={() => useStore.getState().set({ generateOpen: true, generationRequest: null })}>
            <Sparkles size={13} /> AI 生成
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="p-2">
      <p className="px-1.5 pb-2 text-xxs leading-relaxed text-ink-400">点击图案进入放置模式，在杆身上再次点击完成放置。</p>
      <div className="grid grid-cols-3 gap-1.5">
        {list.map((a) => (
          <button
            key={a.id}
            onClick={() => useStore.getState().setPlacementAsset(a.id === placementAssetId ? null : a.id)}
            title={a.name}
            className={`aspect-square overflow-hidden rounded-lg border bg-ink-800 transition-all duration-150 hover:scale-[1.03] ${
              a.id === placementAssetId ? 'border-accent-500 ring-1 ring-accent-500' : 'border-ink-600'
            }`}
          >
            <AssetThumb blobKey={`blob:${a.id}`} className="h-full w-full object-contain" />
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5 px-0.5">
        <Button size="sm" variant="outline" className="flex-1" onClick={() => document.getElementById('global-upload')?.click()}>
          <Upload size={12} /> 上传
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={() => (location.hash = '#/assets')}>
          管理素材库
        </Button>
      </div>
    </div>
  );
}

export function AssetThumb({ blobKey, className }: { blobKey: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const revision = useStore((s) => s.assets.find((a) => a.blobKey === blobKey)?.revision ?? 0);
  useEffect(() => {
    let dead = false;
    blobUrl(blobKey).then((u) => !dead && setUrl(u ?? null));
    return () => {
      dead = true;
    };
  }, [blobKey, revision]);
  return url ? <img src={url} className={className} alt="" /> : <div className={className} />;
}

// —— 右侧属性面板（只显示当前对象） ——

export function RightPanel({ tpl, embedded = false }: { tpl: CueTemplate; embedded?: boolean }) {
  const view = useStore((s) => s.view);
  const selection = useStore((s) => s.selection);
  const stickers = useStore((s) => s.design.stickers);
  if (selection.kind === 'sticker') {
    const st = stickers.find((x) => x.id === selection.id);
    if (st) return <StickerPanel sticker={st} tpl={tpl} />;
  }
  if (selection.kind === 'part' && selection.id) return <PartPanel partId={selection.id} tpl={tpl} />;
  if (embedded && view !== 'whole') return <div className="inline-editor-empty"><strong>选择部位或图案，直接调整</strong><p>点击左侧部位可修改材质；选中图层可调整位置、大小和剪切。</p><Button variant="outline" size="sm" onClick={() => useStore.setState((s) => ({ selection: { kind: 'global' }, view: 'whole', focusPartId: null, viewNonce: s.viewNonce + 1 }))}>查看整杆 · 整体设计</Button></div>;
  return <GlobalPanel tpl={tpl} />;
}

function ModeBanner({ mode, label }: { mode: 'sticker' | 'part' | 'global'; label: string }) {
  const styles = {
    sticker: 'bg-accent-500/15 text-accent-400 border-accent-500/40',
    part: 'bg-sky-500/10 text-sky-300 border-sky-500/40',
    global: 'bg-ink-800 text-ink-300 border-ink-700'
  } as const;
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs font-semibold ${styles[mode]}`}>{label}</div>
  );
}

function useThrottledHistory() {
  const last = useRef(0);
  return () => {
    const now = Date.now();
    if (now - last.current > 800) useStore.getState().pushHistory();
    last.current = now;
  };
}

function GlobalPanel({ tpl }: { tpl: CueTemplate }) {
  const design = useStore((s) => s.design);
  const bgMode = useStore((s) => s.bgMode);
  const quality = useStore((s) => s.quality);
  const white = useStore((s) => s.showWhiteModel);
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3">
      <ModeBanner mode="global" label="整体设计" />
      <Collapse title="后把底色" defaultOpen>
        <div className="base-options"><div>{[
          { name: '原木', preset: 'maple', color: '#c4a77d' },
          { name: '墨黑', preset: 'blackSolid', color: '#263329' },
          { name: '暖白', preset: 'whiteSolid', color: '#f7f2e7' },
          { name: '红木', preset: 'rosewood', color: '#794b3c' }
        ].map((base) => <button key={base.preset} aria-label={`底色：${base.name}`} title={base.name} aria-pressed={design.partOverrides['butt-forearm']?.matPreset === base.preset} style={{ '--swatch': base.color } as React.CSSProperties} onClick={() => {
          const st = useStore.getState(); st.pushHistory();
          const overrides = { ...st.design.partOverrides };
          for (const id of ['butt-forearm', 'butt-cap']) overrides[id] = { ...overrides[id], matPreset: base.preset, color: undefined };
          st.setDesign({ partOverrides: overrides });
        }}><span />{design.partOverrides['butt-forearm']?.matPreset === base.preset && <Check size={13} />}</button>)}</div></div>
      </Collapse>
      <Collapse title="规格" defaultOpen={false}>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-ink-300">当前杆型</span>
            <Badge>{tpl.name}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-300">尺寸状态</span>
            <Badge>{tpl.sizeStatus}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-300">
            <span>总长度</span>
            <span className="text-right text-ink-100">{tpl.lengthMm} mm</span>
            <span>前支长度</span>
            <span className="text-right text-ink-100">{tpl.shaftLengthMm} mm</span>
            <span>后把长度</span>
            <span className="text-right text-ink-100">{tpl.buttLengthMm} mm</span>
            <span>中轮直径</span>
            <span className="text-right text-ink-100">{tpl.jointDiameterMm} mm</span>
            <span>大轮直径</span>
            <span className="text-right text-ink-100">{tpl.buttDiameterMm} mm</span>
            <span>先角直径</span>
            <span className="text-right text-ink-100">{tpl.tipDiameterMm} mm</span>
          </div>
        </div>
      </Collapse>
      <Collapse title="整体漆面（可按部件覆盖）" defaultOpen>
        <Segmented value={design.globalFinish} options={FINISH_OPTS} onChange={(f) => useStore.getState().applyFinishAll(f)} />
        <p className="mt-2 text-xxs leading-relaxed text-ink-400">
          整体应用会清除所有部件漆面覆盖；切换漆面不会改变印刷图案。
        </p>
      </Collapse>
      <Collapse title="显示" defaultOpen={false}>
        <div className="space-y-2.5">
          <Field label="背景">
            <Segmented
              value={bgMode}
              options={[
                { value: 'neutral', label: '中性' },
                { value: 'bright', label: '明亮' },
                { value: 'dark', label: '深色' }
              ]}
              onChange={(m) => useStore.getState().setBgMode(m)}
            />
          </Field>
          <Field label="预览纹理质量">
            <Select value={quality} onChange={(e) => useStore.getState().setQuality(e.target.value as never)}>
              <option value="fast">流畅</option>
              <option value="balanced">均衡</option>
              <option value="sharp">高清</option>
            </Select>
          </Field>
          <Toggle checked={white} onChange={(v) => useStore.getState().set({ showWhiteModel: v })} label="白模检查视图" />
        </div>
      </Collapse>
      <Collapse title="开始设计" defaultOpen>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="primary" onClick={() => document.getElementById('global-upload')?.click()}>
            <Upload size={13} /> 上传图案
          </Button>
          <Button size="sm" variant="outline" onClick={() => useStore.getState().set({ generateOpen: true, generationRequest: null })}>
            <Sparkles size={13} /> AI 生成
          </Button>
          <Button size="sm" variant="outline" className="col-span-2" onClick={() => useStore.setState({ leftDrawerOpen: true, leftDrawerTab: 'parts' })}>
            选择部件编辑材质
          </Button>
        </div>
      </Collapse>
    </div>
  );
}

function PartPanel({ partId, tpl }: { partId: string; tpl: CueTemplate }) {
  const design = useStore((s) => s.design);
  const throttle = useThrottledHistory();
  const seg = expandedSegments(tpl).find((s) => s.id === partId);
  const face = tpl.faces.find((f) => f.id === partId);
  const name = seg?.name ?? face?.name ?? partId;
  const override = design.partOverrides[partId] ?? {};
  const effectivePreset = override.matPreset ?? seg?.matPreset ?? face?.matPreset ?? 'ash';
  const aInfo = seg
    ? `${seg.a0}–${seg.a1} mm · 直径 ${(seg.r0 * 2).toFixed(1)}–${(seg.r1 * 2).toFixed(1)} mm`
    : face
      ? `位于 ${face.a} mm · 半径 ${face.radius} mm`
      : '';

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3">
      <ModeBanner mode="part" label={`部件编辑 · ${name}`} />
      <div className="text-xs text-ink-400">{aInfo}</div>
      {(seg?.printEnabled || face?.printEnabled) && <Collapse title="AI 图案定制" defaultOpen>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="primary" onClick={() => useStore.getState().set({ generateOpen: true, generationRequest: { mode: 'single', partId } })}>
            <Sparkles size={12} /> 单独调整
          </Button>
          <Button size="sm" variant="outline" onClick={() => useStore.getState().set({ generateOpen: true, generationRequest: { mode: 'linked', partId } })}>多部位联动</Button>
        </div>
        <p className="mt-2 text-xxs leading-relaxed text-ink-400">单独设计当前部位，或选择其他部位一起生成配套图案。</p>
      </Collapse>}
      <Collapse title="材质" defaultOpen>
        <div className="space-y-3">
          <Field label="底材预设">
            <Select
              value={effectivePreset}
              onChange={(e) => {
                throttle();
                useStore.getState().setPartOverride(partId, { matPreset: e.target.value });
              }}
            >
              {MATERIAL_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="颜色叠加（可选）">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={override.color ?? '#ffffff'}
                onChange={(e) => {
                  throttle();
                  useStore.getState().setPartOverride(partId, { color: e.target.value });
                }}
                className="h-9 w-14 cursor-pointer rounded border border-ink-600 bg-ink-900"
              />
              {override.color && (
                <Button size="sm" variant="ghost" onClick={() => useStore.getState().clearPartOverride(partId)}>
                  清除
                </Button>
              )}
            </div>
          </Field>
        </div>
      </Collapse>
      <Collapse title="漆面" defaultOpen>
        <Segmented
          value={override.finish ?? design.globalFinish}
          onChange={(f) => {
            throttle();
            if (f === design.globalFinish) useStore.getState().clearPartOverride(partId);
            else useStore.getState().setPartOverride(partId, { finish: f });
          }}
          options={
            override.finish
              ? FINISH_OPTS
              : [{ value: design.globalFinish, label: '跟随全局' }, ...FINISH_OPTS.filter((f) => f.value !== design.globalFinish)]
          }
        />
        {override.finish && (
          <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={() => useStore.getState().clearPartOverride(partId)}>
            恢复全局默认
          </Button>
        )}
        <p className="mt-2 text-xxs leading-relaxed text-ink-400">全局属性为默认值，部件可覆盖。</p>
      </Collapse>
    </div>
  );
}

function StickerPanel({ sticker, tpl }: { sticker: StickerInstance; tpl: CueTemplate }) {
  const throttle = useThrottledHistory();
  const assets = useStore((s) => s.assets);
  const asset = assets.find((a) => a.id === sticker.assetId);
  const aspect = asset ? asset.h / asset.w : 1;
  const [lockAspect, setLockAspect] = useState(true);
  const seg = latheSegOfSticker(sticker, tpl);
  const face = faceOfSticker(sticker, tpl);

  const upd = (patch: Partial<StickerInstance>, history = true) => {
    if (history) throttle();
    useStore.getState().updateSticker(sticker.id, patch, { noHistory: !history });
  };

  const ppi = asset ? effectivePpi(asset.w, sticker.w) : 0;
  const targetName = seg?.name ?? face?.name ?? '—';
  const target = sticker.target;
  const latheTarget = target.kind === 'lathe' ? target : null;
  const faceTarget = target.kind === 'face' ? target : null;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3">
      <ModeBanner mode="sticker" label="贴纸编辑" />
      <Collapse title="贴纸" defaultOpen right={<Badge>{targetName}</Badge>}>
        <div className="space-y-2">
          <TextInput value={sticker.name} onChange={(e) => upd({ name: e.target.value }, false)} className="h-8" />
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => useStore.getState().duplicateSticker(sticker.id)}>
              <Copy size={12} /> 复制
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={() => useStore.getState().removeSticker(sticker.id)}>
              <Trash2 size={12} /> 删除
            </Button>
          </div>
        </div>
      </Collapse>

      <Collapse title="位置（毫米 / 角度）" defaultOpen>
        {seg && latheTarget ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="沿杆位置 a (mm)" hint={`${Math.round(seg.a0)}–${Math.round(seg.a1)}`}>
              <NumberInput
                value={Math.round(latheTarget.a)}
                min={seg.a0}
                max={seg.a1}
                step={1}
                onChange={(e) =>
                  upd({
                    target: {
                      kind: 'lathe',
                      segId: seg.id,
                      a: clamp(Number(e.target.value), seg.a0, seg.a1),
                      angDeg: latheTarget.angDeg
                    }
                  })
                }
              />
            </Field>
            <Field label="环绕角度 (°)" hint="0=正上">
              <NumberInput
                value={Math.round(latheTarget.angDeg)}
                min={0}
                max={360}
                step={5}
                onChange={(e) =>
                  upd({
                    target: { kind: 'lathe', segId: seg.id, a: latheTarget.a, angDeg: Number(e.target.value) }
                  })
                }
              />
            </Field>
          </div>
        ) : face && faceTarget ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="水平 fx (mm)">
              <NumberInput
                value={Math.round(faceTarget.fx)}
                step={0.5}
                onChange={(e) =>
                  upd({ target: { kind: 'face', faceId: face.id, fx: Number(e.target.value), fz: faceTarget.fz } })
                }
              />
            </Field>
            <Field label="垂直 fz (mm)">
              <NumberInput
                value={Math.round(faceTarget.fz)}
                step={0.5}
                onChange={(e) =>
                  upd({ target: { kind: 'face', faceId: face.id, fx: faceTarget.fx, fz: Number(e.target.value) } })
                }
              />
            </Field>
          </div>
        ) : null}
      </Collapse>

      <Collapse title="尺寸与旋转" defaultOpen>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="宽度 w (mm)">
              <NumberInput
                value={Number(sticker.w.toFixed(1))}
                min={1}
                step={0.5}
                onChange={(e) => {
                  const w = Math.max(1, Number(e.target.value));
                  upd(lockAspect ? { w, h: w * aspect } : { w });
                }}
              />
            </Field>
            <Field label="高度 h (mm)">
              <NumberInput
                value={Number(sticker.h.toFixed(1))}
                min={1}
                step={0.5}
                onChange={(e) => {
                  const h = Math.max(1, Number(e.target.value));
                  upd(lockAspect ? { h, w: h / aspect } : { h });
                }}
              />
            </Field>
          </div>
          <Toggle checked={lockAspect} onChange={setLockAspect} label="锁定宽高比" />
          <Field label="图案自身旋转 (°)" hint="区别于绕杆角度">
            <div className="flex items-center gap-1.5">
              <NumberInput value={Math.round(sticker.rotDeg)} step={5} onChange={(e) => upd({ rotDeg: Number(e.target.value) })} />
              <Button size="sm" variant="outline" onClick={() => upd({ rotDeg: sticker.rotDeg - 90 })}>
                ⟲90°
              </Button>
              <Button size="sm" variant="outline" onClick={() => upd({ rotDeg: sticker.rotDeg + 90 })}>
                ⟳90°
              </Button>
            </div>
          </Field>
          <div className="flex gap-1.5">
            <Button size="sm" variant={sticker.flipX ? 'primary' : 'outline'} className="flex-1" onClick={() => upd({ flipX: !sticker.flipX })}>
              水平翻转
            </Button>
            <Button size="sm" variant={sticker.flipY ? 'primary' : 'outline'} className="flex-1" onClick={() => upd({ flipY: !sticker.flipY })}>
              垂直翻转
            </Button>
          </div>
          <Field label={`透明度 ${Math.round(sticker.opacity * 100)}%`}>
            <Slider min={5} max={100} value={sticker.opacity * 100} onChange={(e) => upd({ opacity: Number(e.target.value) / 100 }, false)} />
          </Field>
        </div>
      </Collapse>

      <Collapse title="图层与剪切" defaultOpen={false}>
        <div className="space-y-2">
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => useStore.getState().reorderSticker(sticker.id, 1)}>
              <MoveUp size={13} /> 上移
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={() => useStore.getState().reorderSticker(sticker.id, -1)}>
              <MoveDown size={13} /> 下移
            </Button>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => upd({ hidden: !sticker.hidden })}>
              {sticker.hidden ? <EyeOff size={13} /> : <Eye size={13} />} {sticker.hidden ? '已隐藏' : '显示中'}
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={() => upd({ locked: !sticker.locked })}>
              {sticker.locked ? <Lock size={13} /> : <LockOpen size={13} />} {sticker.locked ? '已锁定' : '未锁定'}
            </Button>
          </div>
          <Button size="sm" variant="default" className="w-full" onClick={() => openCutoutForSticker(sticker)}>
            <Scissors size={13} /> 编辑剪切（仅此实例）
          </Button>
        </div>
      </Collapse>

      <div className="rounded-lg border border-ink-700 bg-ink-850 p-2.5 text-xs leading-relaxed text-ink-300">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold text-ink-200">有效清晰度</span>
          {ppi > 0 && <Badge tone={ppi >= 150 ? 'ok' : 'warn'}>{Math.round(ppi)} PPI</Badge>}
        </div>
        源图 {asset?.w ?? '—'}×{asset?.h ?? '—'}px，摆放 {sticker.w.toFixed(0)}mm 宽。
        {ppi > 0 && ppi < 150 && ' 清晰度偏低，放大会模糊；建议重新生成更高分辨率图案。'}
      </div>
    </div>
  );
}

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

function IconBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button title={title} onClick={onClick} className="rounded p-0.5 text-ink-400 hover:bg-ink-700 hover:text-ink-100">
      {children}
    </button>
  );
}

