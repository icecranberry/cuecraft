import { useMemo, useRef, useState } from 'react';
import { Crosshair, Plus, Scissors, Search, Trash2, Upload } from 'lucide-react';
import { useStore, activeAssets } from '../state/store';
import { AssetThumb } from './panels';
import { Badge, Button, TextInput } from '../ui/components';
import { openCutoutForAsset } from '../editor/CutoutEditor';
import type { Asset } from '../core/types';

// 素材库（plan.md §9.1）：图案、上传与历史生成素材的统一管理。

export function AssetsPage() {
  const assets = useStore((s) => s.assets);
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const list = activeAssets(assets).filter(
    (a) => !q || a.name.includes(q) || a.tags.some((t) => t.includes(q))
  );

  return (
    <div className="mx-auto max-w-5xl p-5">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold text-ink-100">素材库</h1>
        <div className="flex-1" />
        <div className="relative w-56">
          <Search size={14} className="absolute left-2.5 top-2.5 text-ink-500" />
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索名称或标签" className="pl-8" />
        </div>
        <Button variant="primary" onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> 上传素材
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = e.target.files;
            if (!files) return;
            handleUpload(files);
            e.target.value = '';
          }}
        />
      </div>
      <p className="mb-4 text-xs text-ink-500">
        白底素材建议先「自动去白底」再放置；透明素材可直接使用。移除素材不删除仍被历史设计引用的文件（plan §9.3）。
      </p>
      {!list.length ? (
        <div className="rounded-xl border border-dashed border-ink-700 p-14 text-center text-sm text-ink-500">
          还没有素材，点击右上角上传，或到工作台用 AI 生成。
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {list.map((a) => (
            <AssetCard key={a.id} asset={a} />
          ))}
        </div>
      )}
    </div>
  );
}

async function handleUpload(files: FileList) {
  const { nextStickerId } = await import('../state/store');
  const { loadImage } = await import('../state/imageStore');
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
  useStore.getState().showToast('素材已入库');
}

function AssetCard({ asset }: { asset: Asset }) {
  return (
    <div className="group overflow-hidden rounded-lg border border-ink-700 bg-ink-850">
      <div className="relative flex h-32 items-center justify-center bg-[repeating-conic-gradient(#3a3f47_0%_25%,#2b3037_0%_50%)] bg-[length:14px_14px]">
        <AssetThumb blobKey={`blob:${asset.id}`} className="max-h-full max-w-full object-contain p-2" />
        <div className="absolute inset-0 hidden items-center justify-center gap-2 bg-black/45 group-hover:flex">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              useStore.getState().setPlacementAsset(asset.id);
              location.hash = '#/workbench';
            }}
          >
            <Crosshair size={13} /> 放置
          </Button>
          <Button size="sm" variant="default" onClick={() => openCutoutForAsset(asset)}>
            <Scissors size={13} /> 剪切
          </Button>
        </div>
      </div>
      <div className="space-y-1.5 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm text-ink-100">{asset.name}</span>
          <Badge tone={asset.source === 'ai' ? 'warn' : 'default'}>{asset.source === 'ai' ? 'AI' : '上传'}</Badge>
        </div>
        <div className="flex items-center justify-between text-xxs text-ink-500">
          <span>
            {asset.w}×{asset.h}px
          </span>
          <button
            className="rounded px-1 text-ink-500 hover:bg-ink-750 hover:text-ink-200"
            title="编辑标签"
            onClick={() => {
              const t = prompt('标签（逗号分隔）', asset.tags.join(','));
              if (t === null) return;
              useStore.getState().set({
                assets: useStore.getState().assets.map((x) =>
                  x.id === asset.id ? { ...x, tags: t.split(/[,，]/).map((s) => s.trim()).filter(Boolean) } : x
                )
              });
            }}
          >
            {asset.tags.length ? asset.tags.join(' / ') : '+ 标签'}
          </button>
          <button
            className="rounded p-1 text-ink-500 hover:bg-ink-750 hover:text-red-300"
            title="移除出库"
            onClick={() => useStore.getState().removeAsset(asset.id)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
