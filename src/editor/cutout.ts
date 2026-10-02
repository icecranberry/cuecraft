// 图像处理纯函数（plan.md §6.3）：
// 自动去白底只处理与画面边缘相连的背景（连通识别），白色图案、细线与高光不会被误删；
// 蒙版与恢复画笔非破坏性，原图始终保留。

export interface Img {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

export function imgFromImageData(id: ImageData): Img {
  return { data: id.data, w: id.width, h: id.height };
}

export function imgToCanvas(img: Img): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.w;
  c.height = img.h;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  return c;
}

export function cloneImg(img: Img): Img {
  return { data: new Uint8ClampedArray(img.data), w: img.w, h: img.h };
}

const idx = (img: Img, x: number, y: number) => (y * img.w + x) * 4;

/**
 * 自动去白底：从画面边缘出发的广度优先扩散，删除「与边缘连通」的近白背景。
 * tolerance：0-100，数值越大，可容忍的偏离白色越多。
 * protect：保护蒙版（>0 的像素永不删除，plan §6.3 保护区域）。
 */
export function autoRemoveWhiteBg(img: Img, tolerance: number, protect?: Uint8Array | null) {
  const tol = (tolerance / 100) * 160;
  const { data, w, h } = img;
  const visited = new Uint8Array(w * h);
  const queue: number[] = [];
  const isBg = (p: number) => {
    const i = p * 4;
    if (data[i + 3] === 0) return true; // 已透明处继续扩散
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    // 近白且低饱和才视为背景（保留白色图案中的彩色部分）
    return mn >= 255 - tol && mx - mn <= tol * 0.9;
  };
  const push = (p: number) => {
    if (visited[p]) return;
    if (protect && protect[p] > 0) return;
    if (!isBg(p)) return;
    visited[p] = 1;
    queue.push(p);
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (queue.length) {
    const p = queue.pop()!;
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  for (let p = 0; p < visited.length; p++) {
    if (visited[p]) data[p * 4 + 3] = 0;
  }
}

/** 画笔：erase 擦除 / restore 从原图恢复（plan §6.3 擦除与恢复） */
export function applyBrush(
  img: Img,
  original: Img,
  x: number,
  y: number,
  radius: number,
  mode: 'erase' | 'restore',
  protect?: Uint8Array | null,
  protectValue = 0
) {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= img.w || py >= img.h) continue;
      const p = py * img.w + px;
      if (mode === 'restore' && protect && protectValue > 0) {
        protect[p] = 0; // 恢复画笔同时取消保护
      }
      if (mode === 'erase' && protect && protect[p] > 0) continue;
      const i = p * 4;
      if (mode === 'erase') {
        img.data[i + 3] = 0;
      } else {
        img.data[i] = original.data[i];
        img.data[i + 1] = original.data[i + 1];
        img.data[i + 2] = original.data[i + 2];
        img.data[i + 3] = original.data[i + 3];
      }
    }
  }
}

/** 保护画笔：标记区域，自动去底时不触碰 */
export function applyProtect(protect: Uint8Array, w: number, h: number, x: number, y: number, radius: number) {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      protect[py * w + px] = 255;
    }
  }
}

/** 选区蒙版应用：keep 只保留选区，delete 删除选区（plan §6.3 保留/删除选区） */
export function applySelectionMask(img: Img, mask: Uint8Array, mode: 'keep' | 'delete') {
  for (let p = 0; p < mask.length; p++) {
    if (mode === 'delete' && mask[p] > 0) img.data[p * 4 + 3] = 0;
    if (mode === 'keep' && mask[p] === 0) img.data[p * 4 + 3] = 0;
  }
}

/** 轻量边缘羽化：alpha 通道盒式模糊 3 次（plan §6.3） */
export function featherAlpha(img: Img, radius: number) {
  if (radius <= 0) return;
  const { w, h } = img;
  let a = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) a[p] = img.data[p * 4 + 3];
  for (let it = 0; it < 3; it++) {
    const b = new Float32Array(w * h);
    // 横向
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let d = -radius; d <= radius; d++) {
          const xx = x + d;
          if (xx < 0 || xx >= w) continue;
          sum += a[y * w + xx];
          n++;
        }
        b[y * w + x] = sum / n;
      }
    }
    // 纵向
    const c = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let d = -radius; d <= radius; d++) {
          const yy = y + d;
          if (yy < 0 || yy >= h) continue;
          sum += b[yy * w + x];
          n++;
        }
        c[y * w + x] = sum / n;
      }
    }
    a = c;
  }
  for (let p = 0; p < w * h; p++) img.data[p * 4 + 3] = a[p];
}

/** 边缘收缩：alpha 侵蚀 1px */
export function erodeAlpha(img: Img) {
  const { w, h } = img;
  const src = new Uint8ClampedArray(img.data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;
      if (src[i + 3] === 0) continue;
      let minA = 255;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          minA = Math.min(minA, src[(yy * w + xx) * 4 + 3]);
        }
      }
      img.data[i + 3] = minA;
    }
  }
}

/** 去白边：半透明边缘像素若近白，用邻近不透明像素颜色替换 */
export function removeWhiteFringe(img: Img) {
  const { w, h } = img;
  const src = new Uint8ClampedArray(img.data);
  const nearOpaque = (x: number, y: number): [number, number, number] | null => {
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = (yy * w + xx) * 4;
          if (src[j + 3] > 220) return [src[j], src[j + 1], src[j + 2]];
        }
      }
    }
    return null;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const a = src[p + 3];
      if (a === 0 || a > 235) continue;
      const r = src[p];
      const g = src[p + 1];
      const b = src[p + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mn > 190 && mx - mn < 50) {
        const c = nearOpaque(x, y);
        if (c) {
          img.data[p] = c[0];
          img.data[p + 1] = c[1];
          img.data[p + 2] = c[2];
        }
      }
    }
  }
}

/** 有效清晰度 PPI（plan §6.4）：源图像素 ÷ 实际尺寸英寸 */
export function effectivePpi(imageW: number, printMm: number): number {
  const inch = printMm / 25.4;
  if (inch <= 0) return 0;
  return imageW / inch;
}
