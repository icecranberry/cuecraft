import type { CueTemplate } from '../core/types';
import { expandedSegments } from './templates';

// 生产展开模板（plan.md §7.1）：水贴／转印的平面包覆规划。
// 锥度连续变化的曲面按「相邻展开块半径差 ≤ maxStepMm」分段近似，
// 每块为矩形（周长 × 轴长），块间保持毫米比例，不随意缩放旋转。

export interface UnfoldBlock {
  blockId: string;
  segId: string;
  label: string;
  /** 在版面上的位置（mm，左上角） */
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  /** 覆盖的轴向范围 */
  a0: number;
  a1: number;
  /** 该块采用的半径（分段中点），用于角↔弧长换算 */
  rMid: number;
  mirror: boolean;
  kind: 'lathe' | 'face';
}

export interface UnfoldTemplate {
  version: string;
  cueTemplateId: string;
  cueTemplateName: string;
  ppi: number;
  bleedMm: number;
  overlapMm: number;
  sheetWmm: number;
  sheetHmm: number;
  blocks: UnfoldBlock[];
  createdAt: string;
  calibrated: boolean;
}

export interface UnfoldOptions {
  ppi: number;
  bleedMm: number;
  overlapMm: number;
  /** 单行最大宽度 mm（受打印机／纸张限制） */
  rowWidthMm: number;
  mirror: boolean;
  maxStepMm?: number;
}

export const TEMPLATE_VERSION = 'tpl-1.1.0';

/**
 * 构建展开模板：所有可印刷旋转面分段成块＋端面块，按行排入版面。
 * 像素换算：px = mm / 25.4 × PPI（plan.md §7.2）。
 */
export function buildUnfoldTemplate(t: CueTemplate, opts: UnfoldOptions): UnfoldTemplate {
  const maxStep = opts.maxStepMm ?? 0.3;
  const blocks: UnfoldBlock[] = [];
  const gutter = 6 + opts.bleedMm * 2;

  for (const seg of expandedSegments(t)) {
    if (!seg.printEnabled) continue;
    const len = seg.a1 - seg.a0;
    if (len <= 0.01) continue;
    const nPieces = Math.max(1, Math.ceil(Math.abs(seg.r1 - seg.r0) / maxStep));
    for (let i = 0; i < nPieces; i++) {
      const f0 = i / nPieces;
      const f1 = (i + 1) / nPieces;
      const a0 = seg.a0 + f0 * len;
      const a1 = seg.a0 + f1 * len;
      const rMid = seg.r0 + ((seg.r1 - seg.r0) * (f0 + f1)) / 2;
      const circ = 2 * Math.PI * rMid;
      blocks.push({
        blockId: `${seg.id}#p${i}`,
        segId: seg.id,
        label: nPieces > 1 ? `${seg.name}（${i + 1}/${nPieces} 段）` : seg.name,
        xMm: 0,
        yMm: 0,
        wMm: circ + opts.overlapMm,
        hMm: a1 - a0,
        a0,
        a1,
        rMid,
        mirror: opts.mirror,
        kind: 'lathe'
      });
    }
  }
  for (const f of t.faces) {
    if (!f.printEnabled) continue;
    blocks.push({
      blockId: f.id,
      segId: f.id,
      label: f.name,
      xMm: 0,
      yMm: 0,
      wMm: f.radius * 2 + opts.overlapMm,
      hMm: f.radius * 2 + opts.overlapMm,
      a0: f.a,
      a1: f.a,
      rMid: f.radius,
      mirror: opts.mirror,
      kind: 'face'
    });
  }

  // 排版：按宽度降序装箱到行内，行高取块最大高
  const sorted = [...blocks].sort((a, b) => b.wMm - a.wMm);
  const rows: UnfoldBlock[][] = [];
  let cur: UnfoldBlock[] = [];
  let curW = 0;
  for (const b of sorted) {
    if (cur.length && curW + b.wMm + gutter > opts.rowWidthMm) {
      rows.push(cur);
      cur = [];
      curW = 0;
    }
    cur.push(b);
    curW += b.wMm + gutter;
  }
  if (cur.length) rows.push(cur);

  let y = gutter;
  let maxRowW = 0;
  for (const row of rows) {
    let x = gutter;
    let rowH = 0;
    for (const b of row) {
      b.xMm = x;
      b.yMm = y;
      x += b.wMm + gutter;
      rowH = Math.max(rowH, b.hMm);
    }
    maxRowW = Math.max(maxRowW, x);
    y += rowH + gutter;
  }

  return {
    version: TEMPLATE_VERSION,
    cueTemplateId: t.id,
    cueTemplateName: t.name,
    ppi: opts.ppi,
    bleedMm: opts.bleedMm,
    overlapMm: opts.overlapMm,
    sheetWmm: Math.ceil(maxRowW),
    sheetHmm: Math.ceil(y),
    blocks,
    createdAt: new Date().toISOString(),
    calibrated: false
  };
}

export const mmToPx = (mm: number, ppi: number) => Math.round((mm / 25.4) * ppi);

/** 版面像素尺寸 */
export function sheetPixels(tpl: UnfoldTemplate): { w: number; h: number } {
  return { w: mmToPx(tpl.sheetWmm, tpl.ppi), h: mmToPx(tpl.sheetHmm, tpl.ppi) };
}

/** 贴纸在展开块画布内的中心（mm）：x 沿环绕角，y 沿轴（相对块顶） */
export function stickerPosInBlock(
  stickerAngDeg: number,
  stickerA: number,
  block: UnfoldBlock
): { x: number; y: number } {
  const circ = 2 * Math.PI * block.rMid;
  const x = (norm360(stickerAngDeg) / 360) * circ;
  const y = stickerA - block.a0;
  return { x, y };
}

function norm360(d: number) {
  return ((d % 360) + 360) % 360;
}

/** 回贴检查：块内映射参数（块内 x=0 对应环绕角 0，y=0 对应块顶轴向位置） */
export function blockToSegmentCanvasTransform(block: UnfoldBlock) {
  return {
    ang0Deg: 0,
    a0: block.a0,
    circMm: 2 * Math.PI * block.rMid
  };
}
