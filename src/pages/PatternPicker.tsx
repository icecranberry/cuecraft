import { useState } from 'react';
import { Check, Search } from 'lucide-react';
import { useStore } from '../state/store';
import { builtinCategories, filterAssets, type AssetKindFilter } from '../materials/patterns';
import { Select, TextInput } from '../ui/components';
import { AssetThumb } from './panels';

export function PatternPicker({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) {
  const assets = useStore((s) => s.assets);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [kind, setKind] = useState<AssetKindFilter>(() => assets.find((a) => a.id === selectedId)?.kind ?? 'pattern');
  const patterns = filterAssets(assets, query, 'builtin', category, kind);
  const categories = builtinCategories(kind);
  const selected = assets.find((a) => a.id === selectedId && a.source === 'builtin');
  return <div className="pattern-picker">
    <p className="helper-text">选一款纹样或贴纸，直接看上杆效果。透明底图案，可继续移动、缩放或剪切。</p>
    <Select aria-label="选料类型" value={kind} onChange={(e) => { setKind(e.target.value as AssetKindFilter); setCategory('all'); }}>
      <option value="all">全部纹样与贴纸</option>
      <option value="pattern">纹样 · {filterAssets(assets, '', 'builtin', 'all', 'pattern').length} 款</option>
      <option value="sticker">贴纸 · {filterAssets(assets, '', 'builtin', 'all', 'sticker').length} 张</option>
    </Select>
    <div className="pattern-filters">
      <div className="pattern-search"><Search size={15} aria-hidden="true" /><TextInput aria-label="搜索系统纹样与贴纸" placeholder="搜索名称、颜色…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      <Select aria-label="选料分类" value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">全部分类</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
    </div>
    {selected && <p className="pattern-selected" role="status"><Check size={14} />已选 · {selected.name}</p>}
    <div className="pattern-grid">
      {patterns.map((a) => <button key={a.id} type="button" className="pattern-card" aria-label={`选择${a.kind === 'sticker' ? '贴纸' : '纹样'} ${a.name}`} aria-pressed={selectedId === a.id} onClick={() => onSelect(a.id)}>
        <div className="pattern-art"><AssetThumb blobKey={a.blobKey} className="h-full w-full object-contain" />{selectedId === a.id && <span className="pattern-check" aria-hidden="true"><Check size={13} /></span>}</div>
        <strong>{a.name}</strong><small>{a.kind === 'sticker' ? '贴纸' : '纹样'} · {a.category}</small>
      </button>)}
    </div>
    {!patterns.length && <div className="pattern-empty"><p>没有匹配的素材，试试其他关键词。</p><button className="text-link" onClick={() => { setQuery(''); setCategory('all'); }}>清除筛选</button></div>}
  </div>;
}
