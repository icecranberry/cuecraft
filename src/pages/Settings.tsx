import { useEffect, useState } from 'react';
import { DEFAULT_AI_SETTINGS, loadAiSettings, saveAiSettings, setApiKey, getApiKey, testConnection, type AiSettings } from '../ai/client';
import { useStore } from '../state/store';
import { Badge, Button, Field, Panel, Select, TextInput } from '../ui/components';

// 设置页（plan.md §10.1/§9.1）：GPTImage 配置、默认参数、显示质量。

export function SettingsPage() {
  const [s, setS] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [key, setKey] = useState('');
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string; models?: string[] } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const quality = useStore((st) => st.quality);

  useEffect(() => {
    loadAiSettings().then(setS);
    setKey(getApiKey());
  }, []);

  const save = async () => {
    await saveAiSettings(s);
    setApiKey(key.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const runTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const r = await testConnection({ ...s });
      setTestMsg(r);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5">
      <div>
        <h1 className="text-lg font-semibold text-ink-100">服务设置</h1>
        <p className="mt-1 text-xs text-ink-500">连接图片生成服务后，即可使用 AI 设计。上传自己的图片无需连接服务。</p>
        <a href="#/workbench" className="text-link inline-flex items-center">← 返回我的设计</a>
      </div>

      <Panel title="图片生成服务（OpenAI 兼容）">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="服务地址" hint="由图片服务商提供">
              <TextInput value={s.baseUrl} onChange={(e) => setS({ ...s, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="服务密钥" hint="仅保存在当前标签页会话中">
              <TextInput type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" />
            </Field>
          </div>
          <details className="quiet-details col-span-2"><summary>高级连接选项 <span>通常无需修改</span></summary><div className="grid grid-cols-2 gap-3 py-3">
          <Field label="图片模型">
            <TextInput value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} placeholder="gpt-image-1" />
          </Field>
          <Field label="默认尺寸">
            <Select value={s.size} onChange={(e) => setS({ ...s, size: e.target.value })}>
              {['1024x1024', '1024x1536', '1536x1024', '512x512', 'auto'].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="质量">
            <Select value={s.quality} onChange={(e) => setS({ ...s, quality: e.target.value })}>
              {['auto', 'high', 'medium', 'low'].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="超时 (ms)">
            <TextInput type="number" value={s.timeoutMs} onChange={(e) => setS({ ...s, timeoutMs: Number(e.target.value) })} />
          </Field>
          </div></details>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button variant="primary" onClick={save}>
            保存设置
          </Button>
          <Button variant="outline" onClick={runTest} disabled={testing}>
            {testing ? '检测中…' : '连接检测'}
          </Button>
          {saved && <Badge tone="ok">已保存</Badge>}
        </div>
        {testMsg && (
          <div className={`mt-3 rounded-md p-2.5 text-xs ${testMsg.ok ? 'bg-emerald-900/30 text-emerald-200' : 'bg-red-900/30 text-red-200'}`}>
            {testMsg.message}
            {testMsg.models && testMsg.models.length > 0 && (
              <div className="mt-1.5 text-xxs text-ink-400">可用模型示例：{testMsg.models.slice(0, 8).join('、')}…</div>
            )}
            <div className="mt-1 text-xxs text-ink-500">
              连接成功后，返回设计页面选择风格并生成方案，即可检查实际出图效果。
            </div>
          </div>
        )}
        <p className="mt-3 rounded bg-ink-800 p-2.5 text-xxs leading-relaxed text-ink-400">
          密钥仅保存在当前标签页的会话中，不会放进你的作品或导出文件。刷新页面后仍可使用，关闭标签页后需重新填写。
        </p>
      </Panel>

      <Panel title="显示质量">
        <Field label="预览纹理质量">
          <Select value={quality} onChange={(e) => useStore.getState().setQuality(e.target.value as never)}>
            <option value="fast">流畅（交互优先）</option>
            <option value="balanced">均衡</option>
            <option value="sharp">高清（静态观察）</option>
          </Select>
        </Field>
        <p className="mt-2 text-xxs leading-relaxed text-ink-500">
          电脑运行较慢时选择「流畅」。此设置只影响预览，不会降低导出图片的清晰度。
        </p>
      </Panel>
    </div>
  );
}
