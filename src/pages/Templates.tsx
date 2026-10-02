import { CUE_TEMPLATES, expandedSegments } from '../cue/templates';
import { Badge, Button } from '../ui/components';
import { useStore } from '../state/store';

// 球杆模板页：唯一大头杆规格与部件尺寸。

export function TemplatesPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-5">
      <div>
        <h1 className="text-lg font-semibold text-ink-100">球杆模板</h1>
        <p className="mt-1 text-xs text-ink-500">
          仅保留大头杆这一种尺寸，三维模型与印刷展开使用同一套毫米规格。
        </p>
      </div>
      {CUE_TEMPLATES.map((t) => (
        <div key={t.id} className="rounded-xl border border-ink-700 bg-ink-850 p-4">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-base font-semibold text-ink-100">{t.name}</h2>
            <Badge>{t.sizeStatus}</Badge>
            <div className="flex-1" />
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                useStore.getState().setCueTemplate(t.id);
                location.hash = '#/workbench';
              }}
            >
              用此杆型设计
            </Button>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
            <Spec label="总长度" value={`${t.lengthMm} mm`} />
            <Spec label="前支长度" value={`${t.shaftLengthMm} mm`} />
            <Spec label="后把长度" value={`${t.buttLengthMm} mm`} />
            <Spec label="中轮直径" value={`${t.jointDiameterMm} mm`} />
            <Spec label="大轮直径" value={`${t.buttDiameterMm} mm`} />
            <Spec label="先角直径" value={`${t.tipDiameterMm} mm`} />
          </div>
          <p className="mb-3 rounded bg-ink-800 p-2.5 text-xxs leading-relaxed text-ink-400">{t.sizeSource}</p>
          <div className="overflow-hidden rounded-lg border border-ink-700">
            <table className="w-full text-xs">
              <thead className="bg-ink-800 text-ink-400">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">部件</th>
                  <th className="px-3 py-1.5 text-left font-medium">轴向范围 (mm)</th>
                  <th className="px-3 py-1.5 text-left font-medium">直径 (mm)</th>
                  <th className="px-3 py-1.5 text-left font-medium">可印刷</th>
                </tr>
              </thead>
              <tbody className="text-ink-300">
                {expandedSegments(t).map((s) => (
                  <tr key={s.id} className="border-t border-ink-700/60">
                    <td className="px-3 py-1.5">{s.name}</td>
                    <td className="px-3 py-1.5">
                      {Math.round(s.a0)} – {Math.round(s.a1)}
                    </td>
                    <td className="px-3 py-1.5">{(s.r0 * 2).toFixed(1)} – {(s.r1 * 2).toFixed(1)}</td>
                    <td className="px-3 py-1.5">{s.printEnabled ? '是' : '否'}</td>
                  </tr>
                ))}
                {t.faces.map((f) => (
                  <tr key={f.id} className="border-t border-ink-700/60">
                    <td className="px-3 py-1.5">{f.name}</td>
                    <td className="px-3 py-1.5">@ {Math.round(f.a)}</td>
                    <td className="px-3 py-1.5">{(f.radius * 2).toFixed(1)}</td>
                    <td className="px-3 py-1.5">{f.printEnabled ? '是' : '否'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-ink-800 px-3 py-2">
      <div className="text-xxs text-ink-500">{label}</div>
      <div className="text-sm text-ink-100">{value}</div>
    </div>
  );
}
