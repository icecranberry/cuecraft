import { createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toRaw } from 'vue';
import type { Asset, CueTemplate, DesignSnapshot, PartOverride, StickerInstance } from './core/types';
import { CUE_TEMPLATES, expandedSegments, registerCueTemplate, resolveTemplate } from './cue/templates';
import { CueScene } from './three/Scene';
import { useStore } from './state/store';
import { putBlob, downloadBlob } from './state/imageStore';
import { renderPhoto, type PhotoOptions } from './export/renderPhoto';

const emptySnapshot = (): DesignSnapshot => ({
  name: '未命名球杆',
  cueTemplateId: 'nineball',
  partOverrides: {},
  globalFinish: 'gloss',
  stickers: []
});

function CanvasApp({ onReady }: { onReady?: () => void }) {
  const design = useSyncExternalStore(
    useStore.subscribe,
    () => useStore.getState().design,
    () => useStore.getState().design
  );
  const template = resolveTemplate(design.cueTemplateId, design.decorativeRings, design.partOverrides);
  return createElement(CueScene, { tpl: template, onReady });
}

export interface CueCanvasHandle {
  dispose(): void;
  setSnapshot(snapshot: DesignSnapshot): void;
  getSnapshot(): DesignSnapshot;
  setAssets(assets: Asset[]): void;
  setPartOverride(partId: string, override: PartOverride): void;
  setWrapColor(partId: string, color: string, opacity: number): void;
  applyWrapSticker(partId: string, sticker: StickerInstance): void;
  clearWrapAppearance(partId: string): void;
  setSelection(kind: 'global' | 'part' | 'sticker', id?: string): void;
  focusPart(partId: string): void;
  selectSticker(id: string): void;
  setView(view: 'whole' | 'shaft' | 'butt' | 'joint' | 'face'): void;
  setReadOnly(value: boolean): void;
  setAutoRotate(value: boolean): void;
  setBgMode(mode: 'neutral' | 'bright' | 'dark'): void;
  setPlacementAsset(id: string | null): void;
  addSticker(sticker: StickerInstance): void;
  updateSticker(id: string, patch: Partial<StickerInstance>): void;
  removeSticker(id: string): void;
  duplicateSticker(id: string): void;
  reorderSticker(id: string, dir: -1 | 1): void;
  setStickerOrder(ids: string[]): void;
  exportPng(options: PhotoOptions): Promise<Blob>;
  cacheAssetImage(id: string, blob: Blob): Promise<void>;
}

export function mountCueCanvas(
  container: HTMLElement,
  callbacks: { onChange?: (snapshot: DesignSnapshot) => void; onSelection?: (kind: string, id?: string) => void; onReady?: () => void } = {}
): CueCanvasHandle {
  const root: Root = createRoot(container);
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.design !== previous.design) callbacks.onChange?.(state.design);
    if (state.selection !== previous.selection) callbacks.onSelection?.(state.selection.kind || 'global', state.selection.id);
  });
  useStore.getState().set({ design: emptySnapshot(), assets: [], selection: { kind: 'global' } });
  root.render(createElement(CanvasApp, { onReady: callbacks.onReady }));
  return {
    dispose() {
      unsubscribe();
      root.unmount();
    },
    setSnapshot(snapshot) {
      const rawSnapshot = toRaw(snapshot);
      const custom = (rawSnapshot as DesignSnapshot & { cueTemplate?: CueTemplate }).cueTemplate;
      if (custom) registerCueTemplate(custom);
      useStore.getState().set({ design: structuredClone(rawSnapshot) });
    },
    getSnapshot() {
      return structuredClone(useStore.getState().design);
    },
    setAssets(assets) {
      useStore.getState().set({ assets });
    },
    setPartOverride(partId, override) {
      useStore.getState().setPartOverride(partId, override);
    },
    setWrapColor(partId, color, opacity) {
      useStore.getState().setWrapColor(partId, color, opacity);
    },
    applyWrapSticker(partId, sticker) {
      useStore.getState().applyWrapSticker(partId, sticker);
    },
    clearWrapAppearance(partId) {
      useStore.getState().clearWrapAppearance(partId);
    },
    setSelection(kind, id) {
      useStore.getState().select({ kind, id });
    },
    focusPart(partId) {
      useStore.getState().focusPart(partId);
    },
    selectSticker(id) {
      useStore.getState().selectSticker(id);
    },
    setView(view) {
      useStore.getState().set({ view, viewNonce: useStore.getState().viewNonce + 1 });
    },
    setReadOnly(value) {
      useStore.getState().setInteractionMode(value ? 'watch' : 'design');
    },
    setAutoRotate(value) {
      useStore.getState().set({ autoRotate: value });
    },
    setBgMode(mode) {
      useStore.getState().setBgMode(mode);
    },
    setPlacementAsset(id) {
      useStore.getState().setPlacementAsset(id);
    },
    addSticker(sticker) {
      useStore.getState().addSticker(sticker);
    },
    updateSticker(id, patch) {
      useStore.getState().updateSticker(id, patch);
    },
    removeSticker(id) {
      useStore.getState().removeSticker(id);
    },
    duplicateSticker(id) {
      useStore.getState().duplicateSticker(id);
    },
    reorderSticker(id, dir) {
      useStore.getState().reorderSticker(id, dir);
    },
    setStickerOrder(ids) {
      useStore.getState().setStickerOrder(ids);
    },
    exportPng(options) {
      return renderPhoto(options);
    },
    cacheAssetImage(id, blob) {
      return putBlob(`blob:${id}`, blob);
    }
  };
}

export { downloadBlob };

export function templateFromSpecification(specification: Record<string, unknown>, name: string): CueTemplate {
  const base = CUE_TEMPLATES[0];
  const length = Number(specification.length_mm) || Number((specification.segments as Array<{ a1: number }> | undefined)?.at(-1)?.a1) || base.lengthMm;
  const shaftLength = Number(specification.shaft_length_mm) || length / 2;
  const tipDiameter = Number(specification.tip_diameter_mm) || base.tipDiameterMm;
  const jointDiameter = Number(specification.joint_diameter_mm) || base.jointDiameterMm;
  const buttDiameter = Number(specification.butt_diameter_mm) || base.buttDiameterMm;
  const explicit = Array.isArray(specification.segments) ? (specification.segments as Partial<CueTemplate['segments'][number]>[]).map((segment, index) => ({
    id: typeof segment.id === 'string' && segment.id ? segment.id : `segment-${index + 1}`,
    kind: segment.kind || (index === 0 ? 'shaft' : 'butt'),
    name: segment.name || `杆段 ${index + 1}`,
    a0: Number(segment.a0), a1: Number(segment.a1),
    r0: Number(segment.r0), r1: Number(segment.r1),
    matPreset: segment.matPreset || 'maple',
    printEnabled: segment.printEnabled !== false
  })) as CueTemplate['segments'] : null;
  const segments = explicit || expandedSegments(base).map((segment) => {
    const a0 = segment.a0 * length / base.lengthMm;
    const a1 = segment.a1 * length / base.lengthMm;
    const radius = (a: number) => a <= shaftLength
      ? tipDiameter / 2 + (jointDiameter - tipDiameter) * a / (2 * shaftLength)
      : jointDiameter / 2 + (buttDiameter - jointDiameter) * (a - shaftLength) / (2 * (length - shaftLength));
    return { ...segment, a0, a1, r0: radius(a0), r1: radius(a1) };
  });
  const first = segments[0];
  const last = segments[segments.length - 1];
  return {
    ...base,
    id: `custom-${crypto.randomUUID()}`,
    name,
    family: typeof specification.family === 'string' ? specification.family : base.family,
    tipDiameterMm: tipDiameter,
    lengthMm: length,
    shaftLengthMm: shaftLength,
    buttLengthMm: length - shaftLength,
    jointDiameterMm: jointDiameter,
    buttDiameterMm: buttDiameter,
    sizeStatus: specification.size_status === '示意尺寸' ? '示意尺寸' : '已校准尺寸',
    sizeSource: typeof specification.size_source === 'string' ? specification.size_source : '素材库尺寸',
    segments,
    selectablePartIds: segments.map((segment) => segment.id),
    faces: [
      { ...base.faces[0], a: 0, radius: first.r0 },
      { ...base.faces[1], a: length, radius: last.r1 }
    ]
  };
}
