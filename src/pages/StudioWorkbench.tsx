import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, CircleHelp, Download, History, Maximize2, MousePointer2, Redo2, RotateCcw, Save, SlidersHorizontal, Undo2, X } from 'lucide-react';
import { CueScene } from '../three/Scene';
import { expandedSegments, resolveTemplate } from '../cue/templates';
import { useStore } from '../state/store';
import { saveCurrentProduct, uploadDesignImages } from '../state/designActions';
import { exportRenderShot } from '../export/exportPng';
import { Button, Dialog } from '../ui/components';
import { FINISHES } from '../materials/presets';
import type { CueTemplate } from '../core/types';
import { artworkParts } from '../cue/artwork';
import { LeftDrawer, RightPanel } from './panels';
import { GenerateDrawer } from './GenerateDrawer';
import { ExportDialog, UnfoldCheckDialog, VersionsDialog } from './Workbench';

const BASES = [
  { name: '原木', preset: 'maple', color: '#c4a77d' },
  { name: '墨黑', preset: 'blackSolid', color: '#263329' },
  { name: '暖白', preset: 'whiteSolid', color: '#f7f2e7' },
  { name: '红木', preset: 'rosewood', color: '#794b3c' }
];

export function Workbench() {
  const design = useStore((s) => s.design);
  const tpl = useMemo(() => resolveTemplate(design.cueTemplateId), [design.cueTemplateId]);
  const selection = useStore((s) => s.selection);
  const placement = useStore((s) => s.placementAssetId);
  const generateOpen = useStore((s) => s.generateOpen);
  const [advanced, setAdvanced] = useState(false);
  const [help, setHelp] = useState(false);
  const [tipVisible, setTipVisible] = useState(true);
  useEffect(() => {
    if (generateOpen) { setAdvanced(false); useStore.getState().set({ generateOpen: false }); }
  }, [generateOpen]);
  const selectedSticker = selection.kind === 'sticker' ? design.stickers.find((s) => s.id === selection.id) : undefined;
  const partId = selection.kind === 'part' ? selection.id : selectedSticker?.target.kind === 'lathe' ? selectedSticker.target.segId : selectedSticker?.target.faceId;
  const name = expandedSegments(tpl).find((p) => p.id === partId)?.name ?? tpl.faces.find((p) => p.id === partId)?.name;
  const canDesignPart = artworkParts(tpl, design).some((part) => part.id === partId);
  const openAdvanced = () => {
    setAdvanced((value) => !value);
    useStore.getState().set({ leftDrawerOpen: true, leftDrawerTab: 'layers' });
  };
  return <div className="studio">
    <div className="studio-heading">
      <div><div className="eyebrow">YOUR CUE, YOUR SIGNATURE</div><h1>设计你的专属球杆<span className="heading-dot">.</span></h1><p>选好部位，说出灵感，看看它上杆的样子。</p></div>
      <div className="heading-actions"><button className="help-button" onClick={() => setHelp(true)}><CircleHelp size={17} /> 使用帮助</button><Button variant="outline" onClick={saveCurrentProduct}><Save size={16} /> 保存设计</Button></div>
    </div>
    <div className={`studio-layout ${advanced ? 'is-advanced' : ''}`}>
      <PartNavigator tpl={tpl} selectedId={partId} />
      <section className="preview-panel" aria-label="球杆实时预览">
        <div className="preview-toolbar"><div className="preview-title"><span className="live-dot" /><strong>实时预览</strong><span>大头杆</span></div><div className="preview-actions"><HistoryControls /><details className="download-menu"><summary aria-label="下载与历史记录"><Download size={17} /><ChevronDown size={12} /></summary><div className="menu-popover"><button onClick={(e) => { exportRenderShot(`${useStore.getState().design.name}.png`); e.currentTarget.closest('details')?.removeAttribute('open'); }}>下载效果图</button><button onClick={(e) => { useStore.getState().set({ versionsOpen: true }); e.currentTarget.closest('details')?.removeAttribute('open'); }}><History size={16} /> 查看历史版本</button><button onClick={(e) => { useStore.getState().set({ exportOpen: true }); e.currentTarget.closest('details')?.removeAttribute('open'); }}>导出工厂文件</button></div></details></div></div>
        <div className="preview-stage">
          <div className="stage-watermark" aria-hidden="true">MADE BY YOU</div>
          <div className="stage-canvas"><CueScene tpl={tpl} /></div>
          <div className="stage-label"><span>CUE / 01</span><p>你的设计，正在这里发生</p></div>
          {!advanced && tipVisible && !partId && <div className="stage-tip"><MousePointer2 size={17} /><span>拖动空白处旋转球杆<br /><small>滚动鼠标可放大，双击部位可聚焦</small></span><button aria-label="收起操作提示" onClick={() => setTipVisible(false)}><X size={15} /></button></div>}
          {!advanced && name && <div className="selected-part-note"><span>已选中 · {name}</span>{canDesignPart && <button onClick={() => useStore.getState().set({ generationRequest: { mode: 'single', partId } })}>只设计这里 <ArrowLeft size={14} className="rotate-180" /></button>}<button aria-label="取消部位选择" onClick={() => useStore.getState().select({ kind: 'global' })}><X size={14} /></button></div>}
          {placement && <div className="placement-note">点击球杆放下图案 <button onClick={() => useStore.getState().setPlacementAsset(null)}>取消放置</button></div>}
          <StudioViews />
        </div>
        <div className="preview-customize">
          <div className="base-options"><span className="control-label">后把底色</span><div>{BASES.map((base) => <button key={base.preset} aria-label={`底色：${base.name}`} title={base.name} aria-pressed={design.partOverrides['butt-forearm']?.matPreset === base.preset} style={{ '--swatch': base.color } as React.CSSProperties} onClick={() => {
            const st = useStore.getState(); st.pushHistory();
            const overrides = { ...st.design.partOverrides };
            for (const id of ['butt-forearm', 'butt-cap']) overrides[id] = { ...overrides[id], matPreset: base.preset, color: undefined };
            st.setDesign({ partOverrides: overrides });
          }}><span />{design.partOverrides['butt-forearm']?.matPreset === base.preset && <Check size={13} />}</button>)}</div></div>
          <div className="finish-options"><span className="control-label">表面质感</span><div>{FINISHES.map((finish) => <button key={finish.id} aria-pressed={design.globalFinish === finish.id} onClick={() => useStore.getState().applyFinishAll(finish.id)}>{finish.id === 'gloss' ? '亮光' : finish.id === 'semi' ? '柔光' : '哑光'}</button>)}</div></div>
          <button className={`advanced-toggle ${advanced ? 'active' : ''}`} onClick={openAdvanced} aria-pressed={advanced}><SlidersHorizontal size={16} />{advanced ? '返回轻松设计' : '精细调整'}</button>
        </div>
        <div className="preview-meta"><label className="design-name">作品名称<input aria-label="作品名称" maxLength={40} placeholder="我的第一支定制球杆" value={design.name === '未命名设计' ? '' : design.name} onChange={(e) => useStore.getState().setDesign({ name: e.target.value })} /></label><SaveStatus /></div>
      </section>
      <aside className="design-rail" aria-label={advanced ? '精细调整面板' : '三步设计向导'}>
        <div className="wizard-host" hidden={advanced}><GenerateDrawer embedded /></div>
        {advanced && <div className="expert-panel"><div className="expert-heading"><div><span className="eyebrow">ADVANCED EDITOR</span><h2>精细调整</h2></div><Button variant="ghost" size="icon" aria-label="返回轻松设计" onClick={() => setAdvanced(false)}><X size={19} /></Button></div><p className="expert-note">在左侧选部位，或在「图层与图片」中选图案。</p><details className="expert-library"><summary>图层与图片</summary><LeftDrawer tpl={tpl} embedded /></details><RightPanel tpl={tpl} /><Button variant="outline" onClick={() => useStore.getState().set({ exportOpen: 'check' })}>查看工厂展开图</Button></div>}
      </aside>
    </div>
    <ExportDialog tpl={tpl} /><UnfoldCheckDialog tpl={tpl} /><VersionsDialog tpl={tpl} />
    <Dialog open={help} onClose={() => setHelp(false)} title="第一次设计？从这三步开始">
      <div className="help-content"><ol><li><strong>选部位</strong><p>选择「前后呼应」，AI 会搭配好前臂和尾段。想改某一处，选「只改一处」。</p></li><li><strong>说想法</strong><p>点一个喜欢的风格，再用一句话描述。也可以上传图片作为参考，或直接使用自己的图案。</p></li><li><strong>看效果</strong><p>生成后点「用这套」，图案就会上杆。满意后保存设计，随时能在「我的作品」里继续编辑。</p></li></ol><p>改错了？预览区的「撤销」能回退。尺寸、图层和剪切工具在「精细调整」中。</p><Button variant="primary" className="w-full" onClick={() => setHelp(false)}>明白了，开始设计</Button></div>
    </Dialog>
    <input id="global-upload" type="file" accept="image/*" multiple hidden onChange={async (e) => {
      const files = Array.from(e.target.files ?? []); e.target.value = ''; if (!files.length) return;
      try { await uploadDesignImages(files); useStore.getState().showToast('图片已上传，可在「我的图片」中使用'); } catch { useStore.getState().showToast('图片未能读取，请换一张图片重试'); }
    }} />
  </div>;
}

function PartNavigator({ tpl, selectedId }: { tpl: CueTemplate; selectedId?: string }) {
  const view = useStore((s) => s.view);
  const parts = [...expandedSegments(tpl), ...tpl.faces];
  return <aside className="part-navigator" aria-label="球杆部位选择">
    <header><h2>球杆部位</h2><p>点击选择并聚焦</p></header>
    <button className="part-overview" aria-pressed={!selectedId && view === 'whole'} onClick={() => {
      const st = useStore.getState();
      st.set({ selection: { kind: 'global' }, view: 'whole', focusPartId: null, viewNonce: st.viewNonce + 1 });
    }}><Maximize2 size={15} />查看整杆</button>
    <nav aria-label="各个部位">{parts.map((part, index) => <button key={part.id} title={part.name} aria-label={`选择${part.name}`} aria-pressed={selectedId === part.id} onClick={() => useStore.getState().focusPart(part.id)}>
      <span className="part-index">{String(index + 1).padStart(2, '0')}</span><span>{part.name.replace(/（.*?）/g, '')}</span>{selectedId === part.id && <Check size={13} />}
    </button>)}</nav>
    <p className="parts-hint">选择只影响当前查看部位，生成范围在右侧设置。</p>
  </aside>;
}

function HistoryControls() {
  const canUndo = useStore((s) => s.past.length > 0), canRedo = useStore((s) => s.future.length > 0);
  return <><Button size="icon" variant="ghost" title="撤销上一步" aria-label="撤销上一步" disabled={!canUndo} onClick={() => useStore.getState().undo()}><Undo2 size={17} /></Button><Button size="icon" variant="ghost" title="重做" aria-label="重做" disabled={!canRedo} onClick={() => useStore.getState().redo()}><Redo2 size={17} /></Button></>;
}
function SaveStatus() {
  const state = useStore((s) => s.saveState);
  return <span className={`save-status ${state}`} aria-live="polite">{state === 'saved' && <Check size={13} />}{state === 'saved' ? '已自动保存' : state === 'saving' ? '正在保存…' : '自动保存失败，请检查浏览器存储空间'}</span>;
}
function StudioViews() {
  const view = useStore((s) => s.view);
  const setView = (next: 'butt' | 'whole') => useStore.setState((s) => ({ view: next, focusPartId: null, viewNonce: s.viewNonce + 1 }));
  return <div className="studio-views"><div><button aria-pressed={view === 'butt'} onClick={() => setView('butt')}>看后把细节</button><button aria-pressed={view === 'whole'} onClick={() => setView('whole')}><Maximize2 size={14} /> 看整杆</button></div><button className="reset-view" aria-label="恢复默认视角" title="恢复默认视角" onClick={() => setView('butt')}><RotateCcw size={16} /></button></div>;
}




