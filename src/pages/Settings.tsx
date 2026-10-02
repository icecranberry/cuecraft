import { useEffect, useState } from 'react';
import { DEFAULT_AI_SETTINGS, loadAiSettings, saveAiSettings, setApiKey, getApiKey, testConnection, startGeneration, type AiSettings } from '../ai/client';
import { useStore } from '../state/store';
import { Badge, Button, Field, Panel, Select, TextInput } from '../ui/components';

// 设置页（plan.md §10.1/§9.1）：GPTImage 配置、默认参数、显示质量。

export function SettingsPage() {
  const [s, setS] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [key, setKey] = useState('');
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string; models?: string[]; warning?: boolean; imageTest?: boolean } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testingImage, setTestingImage] = useState(false);
  const [saved, setSaved] = useState(false);
  const quality = useStore((st) => st.quality);

  useEffect(() => {
    loadAiSettings().then(setS);
    getApiKey().then(setKey).catch(() => setTestMsg({ ok: false, message: '读取服务密钥失败，请检查浏览器存储权限后重试。' }));
  }, []);

  const save = async () => {
    setSaved(false);
    try {
      await saveAiSettings(s);
      await setApiKey(key.trim());
      setTestMsg(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (error) {
      setTestMsg({ ok: false, message: (error as Error).message });
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const r = await testConnection({ ...s }, key);
      setTestMsg(r);
    } finally {
      setTesting(false);
    }
  };

  const runImageTest = async () => {
    setTestingImage(true);
    setTestMsg(null);
    try {
      const job = await startGeneration({ subject: `连接试图 ${Date.now()}：白底蓝色圆形，居中，无文字`, style: '极简平面', palette: '蓝白', keep: '', avoid: '文字', n: 1, refAssetIds: [], removeWhite: false }, 'generate', { settings: { ...s }, apiKey: key });
      await new Promise<void>((resolve) => {
        const finished = () => { const current = useStore.getState().jobs.find(j => j.id === job.id); return current && !['running', 'queued'].includes(current.status); };
        if (finished()) { resolve(); return; }
        const unsubscribe = useStore.subscribe(() => { if (finished()) { unsubscribe(); resolve(); } });
      });
      const result = useStore.getState().jobs.find(j => j.id === job.id)!;
      setTestMsg({ imageTest: true, ok: result.status === 'success', message: result.status === 'success' ? '真实生图测试通过，生成的图片已保存到「我的图片」。' : `真实生图测试失败：${result.error ?? result.status}` });
    } catch (error) {
      setTestMsg({ imageTest: true, ok: false, message: (error as Error).message });
    } finally { setTestingImage(false); }
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
            <Field label="图片生成 URL" hint="填写完整请求地址，原样使用">
              <TextInput value={s.baseUrl} onChange={(e) => setS({ ...s, baseUrl: e.target.value })} placeholder="https://aikun.uk/v1/images/generations" />
            </Field>
            <p className="mt-1.5 text-xxs leading-relaxed text-ink-400">直接填写服务商调用示例中的完整 URL。程序不会追加任何路径。以 /chat/completions 结尾的地址使用 messages 格式；服务必须实际返回图片。</p>
          </div>
          <div className="col-span-2">
            <Field label="服务密钥" hint="保存在当前浏览器本地">
              <TextInput type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" />
            </Field>
          </div>
          <details className="quiet-details col-span-2"><summary>模型与高级连接选项 <span>按服务商提供的信息填写</span></summary><div className="grid grid-cols-2 gap-3 py-3">
          <div className="col-span-2"><Field label="图片编辑 URL（可选）" hint="参考图和多部位联动需要，填写完整地址">
            <TextInput value={s.editUrl ?? ''} onChange={(e) => setS({ ...s, editUrl: e.target.value })} placeholder="填写服务商提供的完整图片编辑 URL" />
          </Field></div>
          <div className="col-span-2"><Field label="模型查询 URL（可选）" hint="用于检测密钥和可用模型，填写完整地址">
            <TextInput value={s.modelsUrl ?? ''} onChange={(e) => setS({ ...s, modelsUrl: e.target.value })} placeholder="填写服务商提供的完整模型查询 URL" />
          </Field></div>
          <Field label="图片模型" hint="填写调用示例中的 model">
            <TextInput value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} placeholder="gpt-image-1" />
          </Field>
          <Field label="默认尺寸" hint="图片接口使用；聊天接口由服务商决定">
            <Select value={s.size} onChange={(e) => setS({ ...s, size: e.target.value })}>
              {['1024x1024', '1024x1536', '1536x1024', '512x512', 'auto'].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="质量" hint="图片接口使用">
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
          <Button variant="outline" onClick={runTest} disabled={testing || testingImage}>
            {testing ? '检测中…' : '连接检测'}
          </Button>
          <Button variant="outline" onClick={runImageTest} disabled={testing || testingImage}>
            {testingImage ? '试生成中…' : '单张试生成'}
          </Button>
          {saved && <Badge tone="ok">已保存</Badge>}
        </div>
        <p className="mt-2 text-xxs leading-relaxed text-ink-400">单张试生成使用当前输入的 URL、密钥和模型，无需先保存；会实际生成 1 张图片，并按服务商规则计费。</p>
        {testMsg && (
          <div className={`mt-3 rounded-md border p-2.5 text-xs leading-relaxed break-words ${testMsg.warning ? 'border-amber-200 bg-amber-50 text-amber-900' : testMsg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
            {testMsg.message}
            {testMsg.models && testMsg.models.length > 0 && (
              <div className="mt-1.5 text-xxs text-inherit">可用模型示例：{testMsg.models.slice(0, 8).join('、')}…</div>
            )}
            <div className="mt-1 text-xxs text-inherit">
              {testMsg.imageTest ? '本次使用当前填写的配置发送了真实单张生图请求。' : '检测使用当前填写的配置，无需先保存。有模型查询 URL 时查询模型；否则仅向图片生成 URL 发 HEAD 检测，不生成图片。'}
            </div>
          </div>
        )}
        <p className="mt-3 rounded bg-ink-800 p-2.5 text-xxs leading-relaxed text-ink-400">
          密钥保存在当前浏览器的 IndexedDB 中，关闭页面后仍可使用，不会放进你的作品或导出文件。清空密钥并保存即可删除。
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
