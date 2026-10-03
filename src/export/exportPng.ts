import type { CueTemplate, SegmentSpec, StickerInstance } from '../core/types';
import { expandedSegments, faceById } from '../cue/templates';
import {
  buildUnfoldTemplate,
  mmToPx,
  sheetPixels,
  type UnfoldBlock,
  type UnfoldOptions,
  type UnfoldTemplate
} from '../cue/unwrap';
import { drawStickerMM, drawLatheStickers, getCachedStickerImage, getStickerImage } from '../stickers/composite';
import { useStore } from '../state/store';
import { canvasToBlob, downloadBlob } from '../state/imageStore';

// 导出模块（plan.md §7）：按生产展开模板把全部印刷图层合成为单张透明 PNG。
// 不烘焙底材、漆面高光、灯光、阴影、环境反射（plan §7.2）。

export interface ExportOptions extends UnfoldOptions {
  designName: string;
  versionId?: string;
}

export interface ExportOutcome {
  canvas: HTMLCanvasElement;
  tpl: UnfoldTemplate;
  fileName: string;
}

/** 按展开块合成印刷图层（同一份贴纸数据、与预览一致的绘制规则，plan §4.3/§7.3） */
export async function composeExport(
  t: CueTemplate,
  stickers: StickerInstance[],
  opts: ExportOptions
): Promise<ExportOutcome> {
  for (const s of stickers) await getStickerImage(s);
  const tpl = buildUnfoldTemplate(t, opts);
  const px = sheetPixels(tpl);
  const canvas = document.createElement('canvas');
  canvas.width = px.w;
  canvas.height = px.h;
  const ctx = canvas.getContext('2d')!;
  const ppi = opts.ppi;
  const segs = expandedSegments(t);

  for (const block of tpl.blocks) {
    const blockPxX = mmToPx(block.xMm, ppi);
    const blockPxY = mmToPx(block.yMm, ppi);
    const bw = mmToPx(block.wMm, ppi);
    ctx.save();
    // 镜像按模板配置（plan §7.1）
    if (block.mirror) {
      ctx.translate(blockPxX + bw, blockPxY);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(blockPxX, blockPxY);
    }
    if (block.kind === 'face') {
      const face = faceById(t, block.segId);
      if (face) drawFaceBlock(ctx, face, stickers, ppi);
    } else {
      const seg = segs.find((s) => s.id === block.segId);
      if (seg) drawLatheBlock(ctx, segs, stickers, block, ppi);
    }
    ctx.restore();
  }
  const fileName = `${sanitize(opts.designName || 'cue-design')}-${t.id}-${ppi}ppi.png`;
  return { canvas, tpl, fileName };
}

function drawLatheBlock(
  ctx: CanvasRenderingContext2D,
  segments: SegmentSpec[],
  stickers: StickerInstance[],
  block: UnfoldBlock,
  ppi: number
) {
  const pxPerMm = ppi / 25.4;
  const circ = 2 * Math.PI * block.rMid;
  drawLatheStickers(ctx, stickers, segments, block.a0, block.a1, circ, block.wMm, pxPerMm);
}

function drawFaceBlock(
  ctx: CanvasRenderingContext2D,
  face: { id: string; radius: number },
  stickers: StickerInstance[],
  ppi: number
) {
  const pxPerMm = ppi / 25.4;
  const mine = stickers.filter((s) => !s.hidden && s.target.kind === 'face' && s.target.faceId === face.id);
  for (const s of mine) {
    if (s.target.kind !== 'face') continue;
    const img = getCachedStickerImage(s);
    if (!img) continue;
    drawStickerMM(ctx, img, { x: s.target.fx + face.radius, y: s.target.fz + face.radius }, s, pxPerMm);
  }
}

/** 下载主交付 PNG，登记导出记录并缓存块索引（供回贴检查，plan §7.3） */
export async function exportPrintPng(t: CueTemplate, opts: ExportOptions): Promise<ExportOutcome> {
  const stickers = useStore.getState().design.stickers;
  const outcome = await composeExport(t, stickers, opts);
  const blob = await canvasToBlob(outcome.canvas);
  downloadBlob(blob, outcome.fileName);
  const px = sheetPixels(outcome.tpl);
  const ppi = opts.ppi;
  useStore.getState().addExport({
    id: `exp-${Date.now().toString(36)}`,
    createdAt: Date.now(),
    designName: opts.designName,
    versionId: opts.versionId,
    ppi,
    sheetWmm: outcome.tpl.sheetWmm,
    sheetHmm: outcome.tpl.sheetHmm,
    pxW: px.w,
    pxH: px.h,
    blockCount: outcome.tpl.blocks.length,
    templateVersion: outcome.tpl.version,
    fileName: outcome.fileName
  });
  const blocks = outcome.tpl.blocks.map((b) => ({
    block: {
      blockId: b.blockId,
      segId: b.segId,
      a0: b.a0,
      a1: b.a1,
      rMid: b.rMid,
      kind: b.kind,
      wMm: b.wMm,
      hMm: b.hMm,
      xMm: b.xMm,
      yMm: b.yMm,
      mirror: b.mirror,
      label: b.label
    },
    sx: mmToPx(b.xMm, ppi),
    sy: mmToPx(b.yMm, ppi),
    sw: mmToPx(b.wMm, ppi),
    sh: mmToPx(b.hMm, ppi)
  }));
  useStore.getState().set({ exportCheckData: { canvas: outcome.canvas, ppi, blocks } });
  return outcome;
}

/** 展开版面低分辨率预览（检查用） */
export async function previewUnfold(
  t: CueTemplate,
  opts: ExportOptions
): Promise<{ canvas: HTMLCanvasElement; tpl: UnfoldTemplate }> {
  const stickers = useStore.getState().design.stickers;
  const outcome = await composeExport(t, stickers, { ...opts, ppi: 24 });
  return { canvas: outcome.canvas, tpl: outcome.tpl };
}

/** 产品效果图（可选辅助文件，独立于生产 PNG，plan §7.3） */
export async function exportRenderShot(fileName: string, options: import('./renderPhoto').PhotoOptions = {}) {
  useStore.getState().showToast('正在生成高清效果图…');
  try {
    const { renderPhoto } = await import('./renderPhoto');
    const blob = await renderPhoto(options);
    downloadBlob(blob, fileName);
    useStore.getState().showToast('高清效果图已生成');
    return blob;
  } catch (error) {
    useStore.getState().showToast(error instanceof Error ? error.message : '效果图生成失败，请重试');
  }
}

export const glRef: { current: { domElement: HTMLCanvasElement } | null } = { current: null };

function sanitize(s: string) {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'cue-design';
}
