import { useEffect, useMemo, useRef, useState } from 'react';
import type { Asset, StickerInstance } from '../core/types';
import { useStore } from '../state/store';
import { blobToCanvas, canvasToBlob, putBlob } from '../state/imageStore';
import { invalidateStickerImage } from '../stickers/composite';
import {
  applyBrush,
  applyProtect,
  applySelectionMask,
  autoRemoveWhiteBg,
  cloneImg,
  erodeAlpha,
  featherAlpha,
  imgFromImageData,
  imgToCanvas,
  removeWhiteFringe,
  type Img
} from './cutout';
import { Button, Slider, Badge } from '../ui/components';

// 剪切编辑器（plan.md §6.3）：非破坏性，原始图像保持可恢复；蒙版作用于当前目标。

type Tool = 'rect' | 'lasso' | 'erase' | 'restore' | 'protect';

export function CutoutEditor() {
  const cutout = useStore((s) => s.cutout);
  const assets = useStore((s) => s.assets);
  const stickers = useStore((s) => s.design.stickers);
  const close = () => useStore.getState().set({ cutout: null });

  const asset = useMemo(() => assets.find((a) => a.id === cutout?.assetId), [cutout, assets]);
  const sticker = useMemo(
    () => (cutout?.stickerId ? stickers.find((s) => s.id === cutout.stickerId) : undefined),
    [cutout, stickers]
  );

  const originalRef = useRef<Img | null>(null);
  const workRef = useRef<Img | null>(null);
  const protectRef = useRef<Uint8Array | null>(null);
  const undoRef = useRef<Img[]>([]);
  const [version, setVersion] = useState(0);
  const [tool, setTool] = useState<Tool>('erase');
  const [brush, setBrush] = useState(14);
  const [tolerance, setTolerance] = useState(28);
  const [bg, setBg] = useState<'checker' | 'light' | 'dark' | 'wood'>('checker');
  const [showOriginal, setShowOriginal] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pendingMaskRef = useRef<Uint8Array | null>(null);
  const viewRef = useRef({ scale: 1, ox: 0, oy: 0 });
  const dragRef = useRef<{ start: [number, number] | null; points: [number, number][]; last: [number, number] | null }>({
    start: null,
    points: [],
    last: null
  });
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // 载入目标图像（实例处理图优先，其次素材原图）
  useEffect(() => {
    if (!cutout || !asset) return;
    let dead = false;
    (async () => {
      const key = cutout.mode === 'instance' && sticker?.processedKey ? sticker.processedKey : `blob:${asset.id}`;
      const c = (await blobToCanvas(key)) ?? (await blobToCanvas(`blob:${asset.id}`));
      if (!c || dead) return;
      const ctx = c.getContext('2d')!;
      const img = imgFromImageData(ctx.getImageData(0, 0, c.width, c.height));
      const orig = (await blobToCanvas(`blob:${asset.id}`))!;
      originalRef.current = imgFromImageData(orig.getContext('2d')!.getImageData(0, 0, orig.width, orig.height));
      workRef.current = img;
      protectRef.current = new Uint8Array(img.w * img.h);
      undoRef.current = [];
      setVersion((v) => v + 1);
    })();
    return () => {
      dead = true;
    };
  }, [cutout, asset, sticker]);

  // 渲染画布
  useEffect(() => {
    if (!workRef.current || !canvasHostRef.current) return;
    const img = showOriginal && originalRef.current ? originalRef.current : workRef.current;
    const host = canvasHostRef.current;
    const maxW = host.clientWidth - 8;
    const maxH = host.clientHeight - 8;
    const scale = Math.min(maxW / img.w, maxH / img.h, 1.6);
    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvasRef.current = canvas;
      host.appendChild(canvas);
    }
    canvas.width = Math.round(img.w * scale);
    canvas.height = Math.round(img.h * scale);
    viewRef.current = { scale, ox: 0, oy: 0 };
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackdrop(ctx, canvas.width, canvas.height, bg);
    const tmp = imgToCanvas(img);
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    // 蒙版叠加显示
    if (maskCanvasRef.current && (tool === 'rect' || tool === 'lasso')) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#38bdf8';
      ctx.drawImage(maskCanvasRef.current, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  }, [version, showOriginal, bg, tool]);

  if (!cutout || !asset) return null;

  const pushUndo = () => {
    if (!workRef.current) return;
    undoRef.current.push(cloneImg(workRef.current));
    if (undoRef.current.length > 15) undoRef.current.shift();
  };

  const undo = () => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    workRef.current = prev;
    setVersion((v) => v + 1);
  };

  const toImgCoords = (e: React.PointerEvent): [number, number] | null => {
    const canvas = canvasRef.current;
    const img = workRef.current;
    if (!canvas || !img) return null;
    const rect = canvas.getBoundingClientRect();
    const { scale } = viewRef.current;
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width / scale;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height / scale;
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) return null;
    return [x, y];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const img = workRef.current;
    if (!img) return;
    const pt = toImgCoords(e);
    if (!pt) return;
    pushUndo();
    if (tool === 'rect' || tool === 'lasso') {
      dragRef.current = { start: pt, points: [pt], last: null };
      if (!maskCanvasRef.current || maskCanvasRef.current.width !== img.w) {
        const m = document.createElement('canvas');
        m.width = img.w;
        m.height = img.h;
        maskCanvasRef.current = m;
      }
    } else {
      dragRef.current = { start: null, points: [], last: pt };
      strokeBrush(pt);
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    setVersion((v) => v + 1);
  };

  const strokeBrush = (pt: [number, number]) => {
    const img = workRef.current;
    if (!img) return;
    const last = dragRef.current.last ?? pt;
    // 插值连画
    const steps = Math.max(1, Math.hypot(pt[0] - last[0], pt[1] - last[1]) / (brush / 3));
    for (let i = 1; i <= steps; i++) {
      const x = last[0] + ((pt[0] - last[0]) * i) / steps;
      const y = last[1] + ((pt[1] - last[1]) * i) / steps;
      if (tool === 'erase') applyBrush(img, originalRef.current!, x, y, brush, 'erase', protectRef.current);
      else if (tool === 'restore') applyBrush(img, originalRef.current!, x, y, brush, 'restore', protectRef.current);
      else if (tool === 'protect') applyProtect(protectRef.current!, img.w, img.h, x, y, brush);
    }
    dragRef.current.last = pt;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.start && !dragRef.current.last) return;
    const img = workRef.current;
    if (!img) return;
    const pt = toImgCoords(e);
    if (!pt) return;
    if (tool === 'rect' || tool === 'lasso') {
      if (tool === 'rect' && dragRef.current.start) {
        dragRef.current.points = [dragRef.current.start, pt];
      } else {
        dragRef.current.points.push(pt);
      }
      // 实时显示蒙版
      drawSelectionMask(img);
    } else {
      strokeBrush(pt);
    }
    setVersion((v) => v + 1);
  };

  const drawSelectionMask = (img: Img) => {
    const m = maskCanvasRef.current;
    if (!m) return;
    const mctx = m.getContext('2d')!;
    mctx.clearRect(0, 0, m.width, m.height);
    mctx.fillStyle = '#fff';
    const pts = dragRef.current.points;
    if (tool === 'rect' && pts.length >= 2) {
      const x0 = Math.min(pts[0][0], pts[1][0]);
      const y0 = Math.min(pts[0][1], pts[1][1]);
      mctx.fillRect(x0, y0, Math.abs(pts[1][0] - pts[0][0]), Math.abs(pts[1][1] - pts[0][1]));
    } else if (tool === 'lasso' && pts.length >= 3) {
      mctx.beginPath();
      mctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) mctx.lineTo(p[0], p[1]);
      mctx.closePath();
      mctx.fill();
    }
    void img;
  };

  const onPointerUp = () => {
    const img = workRef.current;
    if (!img) return;
    if ((tool === 'rect' || tool === 'lasso') && maskCanvasRef.current) {
      const mctx = maskCanvasRef.current.getContext('2d')!;
      const md = mctx.getImageData(0, 0, img.w, img.h).data;
      const mask = new Uint8Array(img.w * img.h);
      for (let p = 0; p < mask.length; p++) mask[p] = md[p * 4 + 3] > 0 ? 255 : 0;
      dragRef.current = { start: null, points: [], last: null };
      // 蒙版保留显示，等待用户执行保留/删除
      pendingMaskRef.current = mask;
    } else {
      dragRef.current = { start: null, points: [], last: null };
    }
    setVersion((v) => v + 1);
  };

  const runAuto = () => {
    const img = workRef.current;
    if (!img) return;
    pushUndo();
    autoRemoveWhiteBg(img, tolerance, protectRef.current);
    setVersion((v) => v + 1);
  };

  const applyMaskOp = (mode: 'keep' | 'delete') => {
    const img = workRef.current;
    const mask = pendingMaskRef.current;
    if (!img || !mask) return;
    pushUndo();
    applySelectionMask(img, mask, mode);
    pendingMaskRef.current = null;
    maskCanvasRef.current = null;
    setVersion((v) => v + 1);
  };

  const quick = (fn: (img: Img) => void) => {
    const img = workRef.current;
    if (!img) return;
    pushUndo();
    fn(img);
    setVersion((v) => v + 1);
  };

  const save = async () => {
    const img = workRef.current;
    if (!img || saving) return;
    setSaving(true);
    try {
      const blob = await canvasToBlob(imgToCanvas(img));
      if (cutout.mode === 'asset') {
        await putBlob(`blob:${asset.id}`, blob);
        for (const instance of useStore.getState().design.stickers.filter((s) => s.assetId === asset.id && !s.processedKey)) invalidateStickerImage(instance);
        // 更新素材尺寸信息
        useStore.getState().set({
          assets: useStore.getState().assets.map((a) => (a.id === asset.id ? { ...a, w: img.w, h: img.h, revision: (a.revision ?? 0) + 1, processingWarning: undefined } : a)),
          design: { ...useStore.getState().design, stickers: useStore.getState().design.stickers.map((s) => s.assetId === asset.id && !s.processedKey ? { ...s, processedRev: s.processedRev + 1 } : s) }
        });
        useStore.getState().showToast('已保存到素材（原图可通过恢复画笔找回）');
      } else if (sticker) {
        const key = `img:${sticker.id}:${sticker.processedRev + 1}`;
        await putBlob(key, blob);
        invalidateStickerImage(sticker);
        useStore.getState().setStickerProcessed(sticker.id, key);
        useStore.getState().showToast('已应用到当前贴纸（其他实例不受影响）');
      }
      close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink-950/95">
      <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-ink-100">素材剪切</span>
          <Badge tone={cutout.mode === 'instance' ? 'ok' : 'default'}>
            {cutout.mode === 'instance' ? '编辑当前贴纸实例' : '编辑素材本身'}
          </Badge>
          <span className="text-xs text-ink-400">{asset.name}（{asset.w}×{asset.h}px）</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={undo} disabled={!undoRef.current.length}>
            撤销
          </Button>
          <Button variant="primary" size="sm" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存并应用'}
          </Button>
          <Button variant="ghost" size="icon" onClick={close}>
            ✕
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-44 shrink-0 flex-col gap-2 overflow-auto border-r border-ink-700 bg-ink-900 p-3">
          <div className="text-xxs font-semibold text-ink-400">自动抠图</div>
          <Slider min={5} max={80} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} />
          <div className="text-xxs text-ink-500">容差 {tolerance}</div>
          <Button size="sm" variant="default" onClick={runAuto}>
            自动去白底
          </Button>
          <div className="mt-2 text-xxs text-ink-400">选区工具</div>
          <div className="grid grid-cols-2 gap-1.5">
            <ToolBtn active={tool === 'rect'} onClick={() => setTool('rect')}>矩形</ToolBtn>
            <ToolBtn active={tool === 'lasso'} onClick={() => setTool('lasso')}>套索</ToolBtn>
          </div>
          {pendingMaskRef.current && (
            <div className="grid grid-cols-2 gap-1.5">
              <Button size="sm" variant="outline" onClick={() => applyMaskOp('keep')}>保留选区</Button>
              <Button size="sm" variant="outline" onClick={() => applyMaskOp('delete')}>删除选区</Button>
            </div>
          )}
          <div className="mt-2 text-xxs text-ink-400">画笔</div>
          <div className="grid grid-cols-3 gap-1.5">
            <ToolBtn active={tool === 'erase'} onClick={() => setTool('erase')}>擦除</ToolBtn>
            <ToolBtn active={tool === 'restore'} onClick={() => setTool('restore')}>恢复</ToolBtn>
            <ToolBtn active={tool === 'protect'} onClick={() => setTool('protect')}>保护</ToolBtn>
          </div>
          <Slider min={3} max={60} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
          <div className="text-xxs text-ink-500">笔刷 {brush}px</div>
          <div className="mt-2 text-xxs text-ink-400">边缘处理</div>
          <div className="grid grid-cols-2 gap-1.5">
            <Button size="sm" variant="outline" onClick={() => quick((im) => featherAlpha(im, 2))}>羽化</Button>
            <Button size="sm" variant="outline" onClick={() => quick(erodeAlpha)}>收缩</Button>
            <Button size="sm" variant="outline" className="col-span-2" onClick={() => quick(removeWhiteFringe)}>
              去白边
            </Button>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-900 px-3 py-1.5">
            {(['checker', 'light', 'dark', 'wood'] as const).map((b) => (
              <button
                key={b}
                onClick={() => setBg(b)}
                className={`h-5 w-8 rounded border ${bg === b ? 'border-accent-500' : 'border-ink-600'}`}
                style={{
                  background:
                    b === 'checker'
                      ? 'repeating-conic-gradient(#888 0% 25%, #ccc 0% 50%) 50%/8px 8px'
                      : b === 'light'
                        ? '#dfe3e8'
                        : b === 'dark'
                          ? '#20242a'
                          : 'linear-gradient(90deg,#c9a870,#b08d55)'
                }}
                title={b}
              />
            ))}
            <div className="flex-1" />
            <Button
              size="sm"
              variant={showOriginal ? 'primary' : 'ghost'}
              onMouseDown={() => setShowOriginal(true)}
              onMouseUp={() => setShowOriginal(false)}
              onMouseLeave={() => setShowOriginal(false)}
            >
              按住看原图
            </Button>
          </div>
          <div ref={canvasHostRef} className="relative min-h-0 flex-1 overflow-hidden bg-ink-850 p-1">
            {!workRef.current && <div className="pt-20 text-center text-sm text-ink-400">载入中…</div>}
          </div>
        </div>
      </div>

      <div className="border-t border-ink-700 bg-ink-900 px-4 py-1.5 text-xxs text-ink-500">
        自动去白底仅移除与画面边缘相连的近白背景；白色主体、细线与高光会被保留，必要时用「恢复」画笔找回，用「保护」画笔标记不想被删除的区域。
      </div>
    </div>
  );
}

function ToolBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button size="sm" variant={active ? 'primary' : 'outline'} onClick={onClick} className="w-full">
      {children}
    </Button>
  );
}

function drawBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, bg: string) {
  if (bg === 'checker') {
    const s = 10;
    for (let y = 0; y < h; y += s) {
      for (let x = 0; x < w; x += s) {
        ctx.fillStyle = ((x / s + y / s) | 0) % 2 ? '#c8c8c8' : '#efefef';
        ctx.fillRect(x, y, s, s);
      }
    }
  } else {
    ctx.fillStyle = bg === 'light' ? '#dfe3e8' : bg === 'dark' ? '#20242a' : '#b08d55';
    ctx.fillRect(0, 0, w, h);
  }
}

export async function openCutoutForAsset(asset: Asset) {
  useStore.getState().set({ cutout: { mode: 'asset', assetId: asset.id } });
}

export async function openCutoutForSticker(sticker: StickerInstance) {
  useStore.getState().set({ cutout: { mode: 'instance', assetId: sticker.assetId, stickerId: sticker.id } });
}
