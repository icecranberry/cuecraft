import { useEffect, useRef, useState } from 'react';
import { transitionUI } from './ui/motion';
import { SlidingIndicator } from './ui/SlidingIndicator';
import { initPersistence, useStore } from './state/store';
import { Workbench } from './pages/StudioWorkbench';
import { AssetsPage } from './pages/Assets';
import { TemplatesPage } from './pages/Templates';
import { ProductsPage } from './pages/Products';
import { SettingsPage } from './pages/Settings';
import { CutoutEditor } from './editor/CutoutEditor';
import { ArrowUpRight, CheckCircle2, ChevronDown, Image, PenTool, Settings, Shapes } from 'lucide-react';

// 应用外壳：顶部导航 + 哈希路由 + 全局覆盖层（剪切编辑器、Toast）。

const ROUTES = [
  { hash: '#/workbench', label: '开始设计' },
  { hash: '#/assets', label: '我的图片' },
  { hash: '#/templates', label: '球杆规格' },
  { hash: '#/products', label: '我的作品' },
  { hash: '#/settings', label: '服务设置' }
];

function currentRoute() {
  const h = location.hash || '#/workbench';
  return ROUTES.some((r) => r.hash === h) ? h : '#/workbench';
}

export default function App() {
  const [route, setRoute] = useState(currentRoute());
  const routeRef = useRef(route);
  const loaded = useStore((s) => s.loaded);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    void initPersistence();
    const onHash = () => {
      const next = currentRoute(), previous = routeRef.current;
      if (next === previous) return;
      routeRef.current = next;
      const order = ['#/workbench', '#/assets', '#/products', '#/templates', '#/settings'];
      transitionUI(() => [document.getElementById('main-content')], order.indexOf(next) - order.indexOf(previous), () => setRoute(next));
    };
    window.addEventListener('hashchange', onHash);
    if (!location.hash) location.hash = '#/workbench';
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (currentRoute() === '#/workbench' && st.interactionMode === 'watch') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [role="combobox"], [role="listbox"], [contenteditable="true"], [role="dialog"]') || st.cutout) return;
      if (e.key === 'Escape') {
        if (st.placementAssetId) st.setPlacementAsset(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        st.undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        st.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!loaded) {
    return <div className="flex h-screen items-center justify-center text-sm text-ink-400">载入中…</div>;
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳到主要内容</a>
      <header className="app-header">
        <a href="#/workbench" className="brand" aria-label="CUE STUDIO 球杆定制">
          <span className="brand-mark"><span /><span /></span><span><strong>CUE STUDIO</strong><small>球杆定制工作室</small></span>
        </a>
        <nav aria-label="主导航" className="main-nav">
        <SlidingIndicator activeKey={route} selector="a[aria-current=page]" />
        {ROUTES.filter((r) => !['#/templates', '#/settings'].includes(r.hash)).map((r) => (
          <a
            key={r.hash}
            href={r.hash}
            aria-current={route === r.hash ? 'page' : undefined}
            className={route === r.hash ? 'is-current' : ''}
          >
            {r.hash === '#/workbench' ? <PenTool size={16} /> : r.hash === '#/assets' ? <Image size={16} /> : <Shapes size={16} />}{r.label}
          </a>
        ))}
        </nav>
        <details className="nav-more">
          <summary>更多 <ChevronDown size={14} /></summary>
          <div className="menu-popover">
            <a href="#/templates" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}><Shapes size={16} /> 球杆规格 <ArrowUpRight size={14} /></a>
            <a href="#/settings" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}><Settings size={16} /> 服务设置 <ArrowUpRight size={14} /></a>
          </div>
        </details>
      </header>
      <main id="main-content" tabIndex={-1} className={`app-main ${route === '#/workbench' ? 'is-workbench' : 'is-library'}`}>
        {route === '#/workbench' && <Workbench />}
        {route === '#/assets' && <AssetsPage />}
        {route === '#/templates' && <TemplatesPage />}
        {route === '#/products' && <ProductsPage />}
        {route === '#/settings' && <SettingsPage />}
      </main>
      <CutoutEditor />
      {toast && (
        <div role="status" aria-live="polite" className="app-toast">
          <CheckCircle2 size={18} />{toast}
        </div>
      )}
    </div>
  );
}
