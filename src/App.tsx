import { useEffect, useState } from 'react';
import { initPersistence, useStore } from './state/store';
import { Workbench } from './pages/Workbench';
import { AssetsPage } from './pages/Assets';
import { TemplatesPage } from './pages/Templates';
import { ProductsPage } from './pages/Products';
import { SettingsPage } from './pages/Settings';
import { CutoutEditor } from './editor/CutoutEditor';

// 应用外壳：顶部导航 + 哈希路由 + 全局覆盖层（剪切编辑器、Toast）。

const ROUTES = [
  { hash: '#/workbench', label: '工作台' },
  { hash: '#/assets', label: '素材库' },
  { hash: '#/templates', label: '球杆模板' },
  { hash: '#/products', label: '作品库' },
  { hash: '#/settings', label: '设置' }
];

function currentRoute() {
  const h = location.hash || '#/workbench';
  return ROUTES.some((r) => r.hash === h) ? h : '#/workbench';
}

export default function App() {
  const [route, setRoute] = useState(currentRoute());
  const loaded = useStore((s) => s.loaded);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    void initPersistence();
    const onHash = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHash);
    if (!location.hash) location.hash = '#/workbench';
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
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
    <div className="flex h-screen flex-col bg-ink-950 text-ink-100">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-ink-700 bg-ink-900 px-3">
        <span className="mr-3 text-sm font-bold tracking-wide text-accent-500">球杆外观设计平台</span>
        {ROUTES.map((r) => (
          <a
            key={r.hash}
            href={r.hash}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              route === r.hash ? 'bg-ink-750 text-ink-100' : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            {r.label}
          </a>
        ))}
      </header>
      <main className="min-h-0 flex-1">
        {route === '#/workbench' && <Workbench />}
        {route === '#/assets' && <AssetsPage />}
        {route === '#/templates' && <TemplatesPage />}
        {route === '#/products' && <ProductsPage />}
        {route === '#/settings' && <SettingsPage />}
      </main>
      <CutoutEditor />
      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-lg border border-ink-600 bg-ink-800 px-4 py-2 text-sm text-ink-100 shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
