import { useStore } from '../state/store';
import { AssetThumb } from './panels';
import { Badge, Button } from '../ui/components';
import { resolveTemplate } from '../cue/templates';

// 作品库（plan.md §9.1）：归档作品，继续编辑与复制设计。

export function ProductsPage() {
  const products = useStore((s) => s.products);
  const versions = useStore((s) => s.versions);
  return (
    <div className="mx-auto max-w-5xl p-5">
      <h1 className="mb-1 text-lg font-semibold text-ink-100">我的作品</h1>
      <p className="mb-4 text-xs text-ink-500">
        每一个灵感，都值得留下。打开保存的作品，随时继续设计。
      </p>
      {!products.length ? (
        <div className="rounded-xl border border-dashed border-ink-700 p-14 text-center text-sm text-ink-500">
          <p>这里将收藏你的球杆设计。</p><a href="#/workbench" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-accent-500 px-5 text-white">开始我的第一个设计</a>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {products.map((p) => {
            const v = versions.find((x) => x.id === p.versionId);
            return (
              <div key={p.id} className="overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
                <div className="flex h-40 items-center justify-center bg-ink-900">
                  {p.cover || v?.thumb ? (
                    <AssetThumb blobKey="" className="hidden" />
                  ) : null}
                  {p.cover ? (
                    <img src={p.cover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs text-ink-600">无封面</span>
                  )}
                </div>
                <div className="space-y-1.5 p-3">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-sm font-medium text-ink-100">{p.name}</span>
                    <Badge>{v ? resolveTemplate(v.cueTemplateId).name : '版本缺失'}</Badge>
                  </div>
                  <div className="text-xxs text-ink-500">
                    {v ? `${new Date(v.createdAt).toLocaleString()} 保存` : '—'}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="primary"
                      className="flex-1"
                      disabled={!v}
                      onClick={() => {
                        if (v) {
                          useStore.getState().restoreVersion(v.id);
                          location.hash = '#/workbench';
                        }
                      }}
                    >
                      继续编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (v) {
                          useStore.getState().restoreVersion(v.id);
                          const copy = useStore.getState().saveVersion(`${v.name}（副本）`, '复制设计');
                          useStore.getState().addProduct({
                            id: `prod-${Date.now().toString(36)}`,
                            name: `${p.name}（副本）`,
                            desc: p.desc,
                            cover: p.cover,
                            versionId: copy.id,
                            createdAt: Date.now()
                          });
                          useStore.getState().showToast('已复制设计');
                        }
                      }}
                    >
                      复制
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => useStore.getState().removeProduct(p.id)}>
                      删除
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
