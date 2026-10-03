import { useEffect, useMemo, useRef, useState } from 'react';
import { transitionUI } from '../ui/motion';
import { SlidingIndicator } from '../ui/SlidingIndicator';
import { Check, ChevronDown, CircleHelp, Download, History, Eye, Layers, PenTool, Maximize2, MousePointer2, Redo2, RotateCcw, Save, Undo2, X } from 'lucide-react';
import { CueScene } from '../three/Scene';
import { expandedSegments, resolveTemplate } from '../cue/templates';
import { useStore } from '../state/store';
import { saveCurrentProduct, uploadDesignImages } from '../state/designActions';
import { exportRenderShot } from '../export/exportPng';
import { Button, Dialog } from '../ui/components';
import type { CueTemplate } from '../core/types';
import { PreviewTools } from './PreviewTools';
import { GenerateDrawer } from './GenerateDrawer';
import { LayersTab } from './panels';
import { ExportDialog, UnfoldCheckDialog, VersionsDialog } from './Workbench';

export function Workbench() {
  const design = useStore((s) => s.design);
  const tpl = useMemo(() => resolveTemplate(design.cueTemplateId, design.decorativeRings, design.partOverrides), [design.cueTemplateId, design.decorativeRings, design.partOverrides['ring-joint']?.ringEnabled, design.partOverrides['ring-deco']?.ringEnabled]);
  const selection = useStore((s) => s.selection);
  const placement = useStore((s) => s.placementAssetId);
  const generateOpen = useStore((s) => s.generateOpen);
  const view = useStore((s) => s.view);
  const watching = useStore((s) => s.interactionMode === 'watch');
  const [railTab, setRailTab] = useState<'design' | 'layers'>('design');
  const railRef = useRef<HTMLDivElement>(null);
  const requestedRail = useRef(railTab);
  const switchRail = (next: 'design' | 'layers') => {
    if (next === requestedRail.current) return;
    requestedRail.current = next;
    transitionUI(() => [railRef.current], next === 'layers' ? 1 : -1, () => setRailTab(next));
  };
  const [help, setHelp] = useState(false);
  const [tipVisible, setTipVisible] = useState(true);
  useEffect(() => {
    if (generateOpen) {
      requestedRail.current = 'design';
      setRailTab('design');
      useStore.getState().set({ generateOpen: false });
    }
  }, [generateOpen]);
  const selectedSticker = selection.kind === 'sticker' ? design.stickers.find((s) => s.id === selection.id) : undefined;
  const partId = selection.kind === 'part' ? selection.id : selectedSticker?.target.kind === 'lathe' ? selectedSticker.target.segId : selectedSticker?.target.faceId;
  const name = expandedSegments(resolveTemplate(tpl.id)).find((p) => p.id === partId)?.name ?? tpl.faces.find((p) => p.id === partId)?.name;
  return <div className="studio">
    <div className="studio-heading">
      <div><div className="eyebrow">YOUR CUE, YOUR SIGNATURE</div><h1>设计你的专属球杆<span className="heading-dot">.</span></h1><p>选好部位，说出灵感，看看它上杆的样子。</p></div>
      <div className="heading-actions"><button className="help-button" onClick={() => setHelp(true)}><CircleHelp size={17} /> 使用帮助</button><Button variant="outline" onClick={saveCurrentProduct}><Save size={16} /> 保存设计</Button></div>
    </div>
    <div className="studio-layout">
      <PartNavigator tpl={tpl} selectedId={partId} />
      <section className="preview-panel" aria-label="球杆实时预览">
        <div className="preview-toolbar"><div className="preview-title"><span className="live-dot" /><strong>实时预览</strong><span>大头杆</span></div><div className="preview-actions"><HistoryControls /><details className="download-menu"><summary aria-label="下载与历史记录"><Download size={17} /><ChevronDown size={12} /></summary><div className="menu-popover"><button onClick={(e) => { exportRenderShot(`${useStore.getState().design.name}.png`); e.currentTarget.closest('details')?.removeAttribute('open'); }}>下载效果图</button><button disabled={watching} onClick={(e) => { useStore.getState().set({ versionsOpen: true }); e.currentTarget.closest('details')?.removeAttribute('open'); }}><History size={16} /> 查看历史版本</button><button onClick={(e) => { useStore.getState().set({ exportOpen: true }); e.currentTarget.closest('details')?.removeAttribute('open'); }}>导出工厂文件</button></div></details></div></div>
        <div className="preview-workspace">
        <div className="preview-stage">
          <div className="stage-watermark" aria-hidden="true">MADE BY YOU</div>
          <div className="stage-canvas"><CueScene tpl={tpl} /></div>
          <div className="stage-label"><span>CUE / 01</span><p>你的设计，正在这里发生</p></div>
          {tipVisible && !partId && <div className="stage-tip"><MousePointer2 size={17} /><span>拖动空白处旋转球杆<br /><small>{watching || view === 'whole' ? '滚轮缩放，右键拖动平移，自由旋转' : '滚动鼠标可放大，双击部位可聚焦'}</small></span><button aria-label="收起操作提示" onClick={() => setTipVisible(false)}><X size={15} /></button></div>}
          {name && <div className="selected-part-note"><span>已选中 · {name}</span><button aria-label="取消部位选择" onClick={() => useStore.getState().select({ kind: 'global' })}><X size={14} /></button></div>}
          {placement && <div className="placement-note">点击球杆放下图案 <button onClick={() => useStore.getState().setPlacementAsset(null)}>取消放置</button></div>}
          <StudioViews />
        </div>
        <PreviewTools tpl={tpl} />
        </div>
        <div className="preview-meta"><label className="design-name">作品名称<input readOnly={watching} aria-label="作品名称" maxLength={40} placeholder="我的第一支定制球杆" value={design.name === '未命名设计' ? '' : design.name} onChange={(e) => useStore.getState().setDesign({ name: e.target.value })} /></label><SaveStatus /></div>
      </section>
      <aside {...(watching ? { inert: '' } : {})} aria-disabled={watching} className="design-rail" aria-label="设计与图层">
        <div className="design-rail-tabs" role="tablist" aria-label="侧边栏内容" onKeyDown={(e) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault();
          const next = e.key === 'Home' ? 'design' : e.key === 'End' ? 'layers' : requestedRail.current === 'design' ? 'layers' : 'design';
          switchRail(next);
          document.getElementById(`rail-tab-${next}`)?.focus();
        }}>
          <SlidingIndicator activeKey={railTab} selector="button[aria-selected=true]" />
          <button id="rail-tab-design" role="tab" aria-selected={railTab === 'design'} aria-controls="rail-design" tabIndex={railTab === 'design' ? 0 : -1} onClick={() => switchRail('design')}><PenTool size={15} />设计</button>
          <button id="rail-tab-layers" role="tab" aria-selected={railTab === 'layers'} aria-controls="rail-layers" tabIndex={railTab === 'layers' ? 0 : -1} onClick={() => switchRail('layers')}><Layers size={15} />图层<span>{design.stickers.length}</span></button>
        </div>
        <div className="rail-content" ref={railRef}>
        <div id="rail-design" role="tabpanel" aria-labelledby="rail-tab-design" className="wizard-host" hidden={railTab !== 'design'}><GenerateDrawer embedded /></div>
        <div id="rail-layers" role="tabpanel" aria-labelledby="rail-tab-layers" className="rail-layers" hidden={railTab !== 'layers'}>
          <header><h2>已上杆图案</h2><p>点击图层选中图案，在预览下方调整。</p></header>
          <div className="rail-layer-list"><LayersTab onUpload={() => { switchRail('design'); document.getElementById('global-upload')?.click(); }} onGenerate={() => switchRail('design')} /></div>
        </div>
        </div>
      </aside>
    </div>
    <ExportDialog tpl={tpl} /><UnfoldCheckDialog tpl={tpl} /><VersionsDialog tpl={tpl} />
    <Dialog open={help} onClose={() => setHelp(false)} title="第一次设计？从这三步开始">
      <div className="help-content"><ol><li><strong>选部位</strong><p>选择「前后呼应」，把纹样应用到前臂和尾段。想改某一处，选「只改一处」。</p></li><li><strong>选纹样</strong><p>在「纹样选料」中搜索和选择系统内置图案，直接放上球杆。也可以切换到 AI 设计，或上传自己的图片。</p></li><li><strong>看效果</strong><p>生成后点「用这套」，图案就会上杆。满意后保存设计，随时能在「我的作品」里继续编辑。</p></li></ol><p>改错了？预览区的「撤销」能回退。图层在右侧「图层」页签管理，尺寸和剪切工具在预览下方。设计模式下点击左侧「查看整杆」可调整整体底色和漆面；切换「观看」可自由查看，避免误编辑。</p><Button variant="primary" className="w-full" onClick={() => setHelp(false)}>明白了，开始设计</Button></div>
    </Dialog>
    <input id="global-upload" type="file" accept="image/*" multiple hidden onChange={async (e) => {
      const files = Array.from(e.target.files ?? []); e.target.value = ''; if (!files.length) return;
      try { await uploadDesignImages(files); useStore.getState().showToast('图片已上传，可在「纹样素材」中使用'); } catch { useStore.getState().showToast('图片未能读取，请换一张图片重试'); }
    }} />
  </div>;
}

function PartNavigator({ tpl, selectedId }: { tpl: CueTemplate; selectedId?: string }) {
  const view = useStore((s) => s.view);
  const watching = useStore((s) => s.interactionMode === 'watch');
  const parts = [...expandedSegments(resolveTemplate(tpl.id)), ...tpl.faces];
  return <aside {...(watching ? { inert: '' } : {})} aria-disabled={watching} className="part-navigator" aria-label="球杆部位选择">
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
  const watching = useStore((s) => s.interactionMode === 'watch');
  const canUndo = useStore((s) => s.past.length > 0), canRedo = useStore((s) => s.future.length > 0);
  return <><Button size="icon" variant="ghost" title="撤销上一步" aria-label="撤销上一步" disabled={watching || !canUndo} onClick={() => useStore.getState().undo()}><Undo2 size={17} /></Button><Button size="icon" variant="ghost" title="重做" aria-label="重做" disabled={watching || !canRedo} onClick={() => useStore.getState().redo()}><Redo2 size={17} /></Button></>;
}
function SaveStatus() {
  const state = useStore((s) => s.saveState);
  return <span className={`save-status ${state}`} aria-live="polite">{state === 'saved' && <Check size={13} />}{state === 'saved' ? '已自动保存' : state === 'saving' ? '正在保存…' : '自动保存失败，请检查浏览器存储空间'}</span>;
}
function StudioViews() {
  const mode = useStore((s) => s.interactionMode);
  const setMode = useStore((s) => s.setInteractionMode);
  return <div className="studio-views"><div><button aria-pressed={mode === 'design'} onClick={() => setMode('design')}><PenTool size={14} /> 设计</button><button aria-pressed={mode === 'watch'} onClick={() => setMode('watch')}><Eye size={14} /> 观看</button></div><button className="reset-view" aria-label="恢复默认视角" title="恢复默认视角" onClick={() => setMode(mode)}><RotateCcw size={16} /></button></div>;
}
