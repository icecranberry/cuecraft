import { create } from 'zustand';
import type {
  Asset,
  DesignSnapshot,
  DesignVersion,
  DisplayQuality,
  ExportRecord,
  FinishId,
  GenerationJob,
  PartOverride,
  Product,
  StickerInstance
} from '../core/types';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { putBlob, removeBlob } from './imageStore';
import { resolveTemplate } from '../cue/templates';

// 应用状态（plan.md §3/§9）：设计数据、选择、历史、UI 与库数据。
// 自动保存当前工作状态；显式保存不可变设计版本（plan.md §9.3）。

export interface Selection {
  kind: 'global' | 'part' | 'sticker' | 'hover' | null;
  id?: string;
}

export interface CutoutTarget {
  mode: 'asset' | 'instance';
  assetId: string;
  stickerId?: string;
}

export interface ExportCheckBlock {
  block: {
    blockId: string;
    segId: string;
    a0: number;
    a1: number;
    rMid: number;
    kind: 'lathe' | 'face';
    wMm: number;
    hMm: number;
    xMm: number;
    yMm: number;
    mirror: boolean;
    label: string;
  };
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

interface Store {
  loaded: boolean;
  design: DesignSnapshot;
  selection: Selection;
  placementAssetId: string | null;
  past: DesignSnapshot[];
  future: DesignSnapshot[];

  assets: Asset[];
  jobs: GenerationJob[];
  versions: DesignVersion[];
  products: Product[];
  exports: ExportRecord[];

  quality: DisplayQuality;
  bgMode: 'neutral' | 'bright' | 'dark';
  showWhiteModel: boolean;
  exportCheckMode: boolean;
  /** 最近一次导出的展开 PNG 与块索引（用于回贴检查，运行时数据） */
  exportCheckData: { canvas: HTMLCanvasElement; ppi: number; blocks: ExportCheckBlock[] } | null;
  /** 拖动等交互进行中（预览纹理降采样） */
  interactive: boolean;
  fps: number;
  /** 当前视角：整杆/前节/后把/接头/端面/部件聚焦 */
  view: 'whole' | 'shaft' | 'butt' | 'joint' | 'face' | 'focus';
  /** 聚焦视角的目标部件 */
  focusPartId: string | null;
  /** 视角请求计数：重复点击同一视角按钮时强制重新取景 */
  viewNonce: number;
  /** 三维悬停对象（轻量描边），独立于选择状态 */
  hoverId: string | null;
  /** 自动保存状态 */
  saveState: 'saved' | 'saving' | 'error';

  layersOpen: boolean;
  generateOpen: boolean;
  generationRequest: { mode: 'linked' | 'single'; partId?: string } | null;
  /** true=导出 PNG，'check'=展开版面检查 */
  exportOpen: boolean | 'check';
  versionsOpen: boolean;
  /** 左侧统一抽屉：开合与当前页签 */
  leftDrawerOpen: boolean;
  leftDrawerTab: 'parts' | 'layers' | 'assets';
  cutout: CutoutTarget | null;
  toast: string | null;

  // —— 设计操作 ——
  setDesign(partial: Partial<DesignSnapshot>): void;
  setCueTemplate(id: string): void;
  renameDesign(name: string): void;
  setPartOverride(segId: string, o: PartOverride): void;
  clearPartOverride(segId: string): void;
  applyFinishAll(f: FinishId): void;
  setGlobalFinish(f: FinishId): void;

  addSticker(s: StickerInstance): void;
  updateSticker(id: string, patch: Partial<StickerInstance>, opts?: { noHistory?: boolean }): void;
  removeSticker(id: string): void;
  duplicateSticker(id: string): void;
  reorderSticker(id: string, dir: -1 | 1): void;
  setStickerProcessed(id: string, key: string): void;

  select(sel: Selection): void;
  focusPart(partId: string): void;
  setPlacementAsset(id: string | null): void;

  pushHistory(): void;
  commitSnapshot(snap: DesignSnapshot): void;
  undo(): void;
  redo(): void;

  // —— UI ——
  set(partial: Partial<Store>): void;
  setQuality(q: DisplayQuality): void;
  setBgMode(m: Store['bgMode']): void;
  showToast(msg: string): void;

  // —— 库数据 ——
  addAsset(a: Asset, blob: Blob): void;
  removeAsset(id: string): void;
  addJob(j: GenerationJob): void;
  updateJob(id: string, patch: Partial<GenerationJob>): void;
  saveVersion(name: string, note: string, thumb?: string): DesignVersion;
  restoreVersion(id: string): void;
  addProduct(p: Product): void;
  removeProduct(id: string): void;
  addExport(r: ExportRecord): void;
}

const emptyDesign = (): DesignSnapshot => ({
  name: '未命名设计',
  cueTemplateId: 'nineball',
  partOverrides: {},
  globalFinish: 'gloss',
  stickers: []
});

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<Store>((set, get) => ({
  loaded: false,
  design: emptyDesign(),
  selection: { kind: 'global' },
  placementAssetId: null,
  past: [],
  future: [],

  assets: [],
  jobs: [],
  versions: [],
  products: [],
  exports: [],

  quality: 'balanced',
  bgMode: 'neutral',
  showWhiteModel: false,
  exportCheckMode: false,
  exportCheckData: null,
  interactive: false,
  fps: 0,
  view: 'butt',
  focusPartId: null,
  viewNonce: 0,
  hoverId: null,
  saveState: 'saved',

  layersOpen: true,
  generateOpen: false,
  generationRequest: null,
  exportOpen: false,
  versionsOpen: false,
  leftDrawerOpen: true,
  leftDrawerTab: 'parts',
  cutout: null,
  toast: null,

  setDesign(partial) {
    set((s) => ({ design: { ...s.design, ...partial } }));
  },
  setCueTemplate(id) {
    get().pushHistory();
    set((s) => ({
      design: { ...s.design, cueTemplateId: resolveTemplate(id).id },
      selection: { kind: 'global' }
    }));
  },
  renameDesign(name) {
    set((s) => ({ design: { ...s.design, name } }));
  },
  setPartOverride(segId, o) {
    set((s) => ({
      design: {
        ...s.design,
        partOverrides: { ...s.design.partOverrides, [segId]: { ...s.design.partOverrides[segId], ...o } }
      }
    }));
  },
  clearPartOverride(segId) {
    get().pushHistory();
    set((s) => {
      const po = { ...s.design.partOverrides };
      delete po[segId];
      return { design: { ...s.design, partOverrides: po } };
    });
  },
  applyFinishAll(f) {
    get().pushHistory();
    set((s) => ({
      design: { ...s.design, globalFinish: f, partOverrides: Object.fromEntries(Object.entries(s.design.partOverrides).map(([id, override]) => {
        const { finish: _finish, ...material } = override;
        return [id, material];
      })) }
    }));
  },
  setGlobalFinish(f) {
    set((s) => ({ design: { ...s.design, globalFinish: f } }));
  },

  addSticker(st) {
    get().pushHistory();
    set((s) => ({ design: { ...s.design, stickers: [...s.design.stickers, st] } }));
  },
  updateSticker(id, patch, opts) {
    if (!opts?.noHistory) get().pushHistory();
    set((s) => ({
      design: {
        ...s.design,
        stickers: s.design.stickers.map((x) => (x.id === id ? { ...x, ...patch } : x))
      }
    }));
  },
  removeSticker(id) {
    get().pushHistory();
    set((s) => ({
      design: { ...s.design, stickers: s.design.stickers.filter((x) => x.id !== id) },
      selection: s.selection.id === id ? { kind: 'global' } : s.selection
    }));
  },
  duplicateSticker(id) {
    const s = get();
    const src = s.design.stickers.find((x) => x.id === id);
    if (!src) return;
    const copy: StickerInstance = {
      ...src,
      id: `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: `${src.name} 副本`,
      z: Math.max(...s.design.stickers.map((x) => x.z)) + 1,
      target:
        src.target.kind === 'lathe'
          ? { ...src.target, angDeg: src.target.angDeg + 12 }
          : { ...src.target, fx: src.target.fx + src.w * 0.6 }
    };
    s.pushHistory();
    set((s2) => ({ design: { ...s2.design, stickers: [...s2.design.stickers, copy] } }));
    set({ selection: { kind: 'sticker', id: copy.id } });
  },
  reorderSticker(id, dir) {
    get().pushHistory();
    set((s) => {
      const list = [...s.design.stickers];
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return {};
      list[i] = { ...list[i], z: list[i].z + dir * 1.5 };
      return { design: { ...s.design, stickers: list } };
    });
  },
  setStickerProcessed(id, key) {
    set((s) => ({
      design: {
        ...s.design,
        stickers: s.design.stickers.map((x) =>
          x.id === id ? { ...x, processedKey: key, processedRev: x.processedRev + 1 } : x
        )
      }
    }));
  },

  select(sel) {
    set({ selection: sel });
  },
  /** 选中部件并动画聚焦到画面中心（部件列表 / 双击共用） */
  focusPart(partId: string) {
    set((s) => ({ selection: { kind: 'part', id: partId }, view: 'focus', focusPartId: partId, viewNonce: s.viewNonce + 1 }));
  },
  setPlacementAsset(id) {
    set({ placementAssetId: id, selection: id ? { kind: 'global' } : get().selection });
  },

  pushHistory() {
    const { design, past } = get();
    set({
      past: [...past.slice(-49), design],
      future: []
    });
  },
  commitSnapshot(snap) {
    set((s) => ({ past: [...s.past.slice(-49), snap], future: [] }));
  },
  undo() {
    const { past, future, design } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: [...future.slice(-49), design],
      design: prev,
      selection: { kind: 'global' }
    });
  },
  redo() {
    const { past, future, design } = get();
    if (!future.length) return;
    const next = future[future.length - 1];
    set({
      future: future.slice(0, -1),
      past: [...past.slice(-49), design],
      design: next,
      selection: { kind: 'global' }
    });
  },

  set(partial) {
    set(partial);
  },
  setQuality(q) {
    set({ quality: q });
    void idbSet('settings:quality', q);
  },
  setBgMode(m) {
    set({ bgMode: m });
  },
  showToast(msg) {
    set({ toast: msg });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 2600);
  },

  addAsset(a, blob) {
    void putBlob(`blob:${a.id}`, blob);
    set((s) => ({ assets: [a, ...s.assets] }));
  },
  removeAsset(id) {
    // 从列表移除；仍被设计引用的 blob 保留（plan.md §9.3）
    set((s) => ({ assets: s.assets.map((a) => (a.id === id ? { ...a, removed: true } : a)) }));
  },
  addJob(j) {
    set((s) => ({ jobs: [j, ...s.jobs].slice(0, 100) }));
  },
  updateJob(id, patch) {
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch, updatedAt: Date.now() } : j))
    }));
  },
  saveVersion(name, note, thumb) {
    const v: DesignVersion = {
      id: `ver-${Date.now().toString(36)}`,
      name: name || get().design.name,
      note,
      createdAt: Date.now(),
      cueTemplateId: get().design.cueTemplateId,
      snapshot: JSON.parse(JSON.stringify(get().design)),
      thumb
    };
    set((s) => ({ versions: [v, ...s.versions].slice(0, 50) }));
    return v;
  },
  restoreVersion(id) {
    const v = get().versions.find((x) => x.id === id);
    if (!v) return;
    get().pushHistory();
    const snapshot: DesignSnapshot = JSON.parse(JSON.stringify(v.snapshot));
    snapshot.cueTemplateId = resolveTemplate(snapshot.cueTemplateId).id;
    set({ design: snapshot, selection: { kind: 'global' } });
    get().showToast(`已恢复版本「${v.name}」`);
  },
  addProduct(p) {
    set((s) => ({ products: [p, ...s.products] }));
  },
  removeProduct(id) {
    set((s) => ({ products: s.products.filter((p) => p.id !== id) }));
  },
  addExport(r) {
    set((s) => ({ exports: [r, ...s.exports].slice(0, 50) }));
  }
}));

// —— 持久化（IndexedDB；密钥永不入内，plan.md §10.1） ——

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const s = useStore.getState();
    if (!s.loaded) return;
    useStore.setState({ saveState: 'saving' });
    try {
      await idbSet('cue:project:v2', s.design);
      await idbSet('cue:assets:v2', s.assets);
      await idbSet('cue:jobs:v2', s.jobs);
      await idbSet('cue:versions:v2', s.versions.map((v) => ({ ...v, thumb: undefined })));
      await idbSet('cue:products:v2', s.products);
      await idbSet('cue:exports:v2', s.exports);
      useStore.setState({ saveState: 'saved' });
    } catch {
      useStore.setState({ saveState: 'error' });
    }
  }, 800);
}

export async function initPersistence() {
  const design = (await idbGet<DesignSnapshot>('cue:project:v2')) ?? emptyDesign();
  design.cueTemplateId = resolveTemplate(design.cueTemplateId).id;
  const assets = (await idbGet<Asset[]>('cue:assets:v2')) ?? [];
  const jobs = (await idbGet<GenerationJob[]>('cue:jobs:v2')) ?? [];
  const versions = (await idbGet<DesignVersion[]>('cue:versions:v2')) ?? [];
  const products = (await idbGet<Product[]>('cue:products:v2')) ?? [];
  const exports_ = (await idbGet<ExportRecord[]>('cue:exports:v2')) ?? [];
  const quality = (await idbGet<DisplayQuality>('settings:quality')) ?? 'balanced';
  // 刷新后仍在运行的任务标记为待核对（plan.md §10.3）
  for (const j of jobs) {
    if (j.status === 'running' || j.status === 'queued') {
      j.status = 'needs-review';
      j.error = '页面刷新导致任务中断，请核对结果或重新生成';
    }
  }
  useStore.setState({
    design,
    assets,
    jobs,
    versions,
    products,
    exports: exports_,
    quality,
    loaded: true,
    saveState: 'saved'
  });
  useStore.subscribe(scheduleSave);
}

export function activeAssets(assets: Asset[]) {
  return assets.filter((a) => !a.removed);
}

export function nextStickerId() {
  return `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
