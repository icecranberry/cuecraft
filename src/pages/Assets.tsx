import { useRef, useState } from 'react';
import { Crosshair, Scissors, Search, Trash2, Upload } from 'lucide-react';
import { useStore } from '../state/store';
import { AssetThumb } from './panels';
import { Badge, Button, Select, TextInput } from '../ui/components';
import { builtinCategories, filterAssets, type AssetKindFilter } from '../materials/patterns';
import { uploadDesignImages } from '../state/designActions';
import { openCutoutForAsset } from '../editor/CutoutEditor';
import type { Asset } from '../core/types';

// 素材库（plan.md §9.1）：图案、上传与历史生成素材的统一管理。

export function AssetsPage() {
  const assets = useStore((s) => s.assets);
  const [q, setQ] = useState('');
  const [source, setSource] = useState('all');
  const [category, setCategory] = useState('all');
  const [kind, setKind] = useState<AssetKindFilter>('all');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const list = filterAssets(assets, q, source, category, kind);
  const categories = builtinCategories(kind);

  return (
    <div className="asset-library mx-auto max-w-5xl p-5">
      <div className="eyebrow">PATTERNS & STICKERS</div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold text-ink-100">纹样素材库</h1>
        <div className="flex-1" />
        <div className="relative w-56">
          <Search size={14} className="absolute left-2.5 top-2.5 text-ink-500" />
          <TextInput aria-label="搜索素材" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索纹样、贴纸或标签" className="pl-8" />
        </div>
        <Button variant="primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> {uploading ? '正在上传…' : '上传图片'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (!files.length) return;
            setUploading(true);
            try { await uploadDesignImages(files); setSource('upload'); setKind('all'); setCategory('all'); setQ(''); useStore.getState().showToast('素材已入库'); }
            catch { useStore.getState().showToast('部分图片未能读取，请检查文件后重试'); }
            finally { setUploading(false); }
          }}
        />
      </div>
      <p className="mb-4 text-xs text-ink-500">
        从传统纹样中挑选灵感，用趣味贴纸表达个性。系统内置图案、上传图片和生成素材，都收在这里。
      </p>
      <div className="asset-filters">
        <Select aria-label="素材类型" value={kind} onChange={(e) => { setKind(e.target.value as AssetKindFilter); setCategory('all'); }}>
          <option value="all">全部类型</option><option value="pattern">纹样</option><option value="sticker">贴纸</option>
        </Select>
        <Select aria-label="素材来源" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="all">全部素材</option><option value="builtin">系统内置</option><option value="upload">我的图片</option><option value="ai">AI 生成</option>
        </Select>
        <Select aria-label="素材分类" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">全部分类</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <span role="status">{list.length} 款素材</span>
      </div>
      {!list.length ? (
        <div className="rounded-xl border border-dashed border-ink-700 p-14 text-center text-sm text-ink-500">
          <p>没有找到匹配的素材。</p><Button variant="outline" className="mt-5" onClick={() => { setQ(''); setSource('all'); setKind('all'); setCategory('all'); }}>查看全部素材</Button>
        </div>
      ) : (
        <div className="asset-grid">
          {list.map((a) => (
            <AssetCard key={a.id} asset={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function AssetCard({ asset }: { asset: Asset }) {
  return (
    <div className="group overflow-hidden rounded-lg border border-ink-700 bg-ink-850">
      <div className="asset-card-art">
        <AssetThumb blobKey={asset.blobKey} className="h-full w-full object-contain p-3" />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-white/90 p-2">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              useStore.getState().setPlacementAsset(asset.id);
              location.hash = '#/workbench';
            }}
          >
            <Crosshair size={13} /> 上杆
          </Button>
          <Button size="sm" variant="default" onClick={() => openCutoutForAsset(asset)}>
            <Scissors size={13} /> {asset.source === 'builtin' ? '剪切副本' : '剪切'}
          </Button>
        </div>
      </div>
      <div className="space-y-1.5 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm text-ink-100">{asset.name}</span>
          <Badge tone={asset.source === 'builtin' ? 'ok' : asset.source === 'ai' ? 'warn' : 'default'}>{asset.source === 'builtin' ? '系统内置' : asset.source === 'ai' ? 'AI' : '上传'}</Badge>
        </div>
        {asset.description && <p className="asset-description">{asset.description}</p>}
        {asset.kind && <p className="text-xxs text-ink-500">{asset.kind === 'sticker' ? '贴纸' : '纹样'} · {asset.category}</p>}
        <div className="flex items-center justify-between text-xxs text-ink-500">
          <span>
            {asset.w}×{asset.h}px
          </span>
          {asset.source === 'builtin' ? <span className="asset-tags">{asset.tags.join(' / ')}</span> : <button
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
          </button>}
          {asset.source !== 'builtin' && <button
            className="rounded p-1 text-ink-500 hover:bg-ink-750 hover:text-red-300"
            title="移除出库"
            onClick={() => useStore.getState().removeAsset(asset.id)}
          >
            <Trash2 size={13} />
          </button>}
        </div>
      </div>
    </div>
  );
}
