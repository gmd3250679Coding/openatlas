import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Input,
  Select,
  Tag,
  message,
} from 'antd';
import {
  CloudDownloadOutlined,
  DatabaseOutlined,
  FilePptOutlined,
  HighlightOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { AipptDeckVersion, AipptKeyValueStorage } from '../features/aippt/adapters';
import { downloadText, safeFileTitle } from '../features/aippt/browser';
import {
  GENERIC_OPERATIONS_DEMO_PROMPT,
  buildGenericOperationsDemo,
} from '../features/aippt/fixtures';
import {
  createLocalAipptStorageAdapter,
  createMemoryKeyValueStorage,
  createMockAipptAgentAdapter,
  createMockAipptResearchAdapter,
} from '../features/aippt/local-adapters';
import { buildHtmlDeck } from '../features/aippt/renderer';
import { selectedStyle } from '../features/aippt/styles';
import type { DeckConfig, DeckPlan } from '../features/aippt/schema';
import '../styles/presentation-canvas.css';

function browserStorage(): AipptKeyValueStorage {
  if (typeof window === 'undefined') return createMemoryKeyValueStorage();
  return window.localStorage;
}

function nowLabel() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

export default function AipptOfflineDemo() {
  const [messageApi, contextHolder] = message.useMessage();
  const adapters = useMemo(() => {
    const storage = createLocalAipptStorageAdapter({ storage: browserStorage() });
    return {
      storage,
      agent: createMockAipptAgentAdapter({ delayMs: 80 }),
      research: createMockAipptResearchAdapter({ delayMs: 80 }),
    };
  }, []);
  const initial = useMemo(() => buildGenericOperationsDemo(), []);
  const [prompt, setPrompt] = useState(GENERIC_OPERATIONS_DEMO_PROMPT);
  const [config, setConfig] = useState<DeckConfig>(initial.config);
  const [plan, setPlan] = useState<DeckPlan>(initial.plan);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [versions, setVersions] = useState<AipptDeckVersion[]>([]);
  const [busy, setBusy] = useState('');
  const [events, setEvents] = useState<string[]>([
    `${nowLabel()} 已载入中性 demo fixture，当前未连接后端。`,
  ]);

  const style = selectedStyle(config);
  const htmlDeck = useMemo(() => buildHtmlDeck(plan, config, style), [config, plan, style]);

  const pushEvent = (text: string) => {
    setEvents((items) => [`${nowLabel()} ${text}`, ...items].slice(0, 12));
  };

  const refreshVersions = async (deckId: string) => {
    const rows = await adapters.storage.listVersions(deckId);
    setVersions(rows);
    return rows;
  };

  const generateOffline = async () => {
    setBusy('generate');
    setActiveDeckId(null);
    setVersions([]);
    pushEvent('Mock Agent 开始流式生成 Deck Schema。');
    try {
      for await (const event of adapters.agent.streamDeckPlan({ query: prompt, config })) {
        if (event.message) pushEvent(event.message);
        if (event.config) setConfig(event.config);
        if (event.plan) setPlan(event.plan);
      }
      messageApi.success('离线 AIPPT Schema 已生成');
    } catch (err: any) {
      messageApi.error(err?.message || '离线生成失败');
    } finally {
      setBusy('');
    }
  };

  const saveOffline = async () => {
    setBusy('save');
    try {
      const payload = {
        query: prompt,
        config,
        plan,
        status: 'deck_ready',
        change_summary: activeDeckId ? '离线保存版本' : '离线创建 deck',
      };
      const saved = activeDeckId
        ? await adapters.storage.saveSnapshot(activeDeckId, payload)
        : await adapters.storage.createSnapshot(payload);
      setActiveDeckId(saved.id);
      setConfig(saved.config);
      if (saved.plan) setPlan(saved.plan);
      await refreshVersions(saved.id);
      pushEvent(`Local Storage 已保存 ${saved.version ? `v${saved.version.version_no}` : 'deck'}`);
      messageApi.success(saved.version ? `已保存 v${saved.version.version_no}` : '已保存离线 deck');
    } catch (err: any) {
      messageApi.error(err?.message || '保存失败');
    } finally {
      setBusy('');
    }
  };

  const restoreOffline = async (versionId: string) => {
    if (!activeDeckId) return;
    setBusy('restore');
    try {
      const restored = await adapters.storage.restoreVersion(activeDeckId, versionId);
      setConfig(restored.config);
      if (restored.plan) setPlan(restored.plan);
      await refreshVersions(activeDeckId);
      pushEvent(`Local Storage 已回退并生成 v${restored.version?.version_no || '-'}`);
      messageApi.success('已回退离线版本');
    } catch (err: any) {
      messageApi.error(err?.message || '回退失败');
    } finally {
      setBusy('');
    }
  };

  const enhanceChart = async () => {
    const targetSlide = plan.slides.find((slide) => slide.layout === 'metrics') || plan.slides[1] || plan.slides[0];
    if (!targetSlide) return;
    setBusy('patch');
    try {
      const patch = await adapters.agent.runSlideAction(activeDeckId || 'offline-demo', {
        action: 'enhance_chart',
        instruction: '增强图表',
        config,
        plan,
        slide: targetSlide,
      });
      setPlan((prev) => ({
        ...prev,
        slides: prev.slides.map((slide) => slide.id === targetSlide.id ? { ...slide, ...patch.slide_patch } : slide),
        generatedAt: new Date().toISOString(),
      }));
      pushEvent(`Mock Agent 已生成可审阅图表补丁：${patch.quality?.changed_fields?.join('、') || 'visualSpec'}`);
      messageApi.success('已应用 Mock 图表增强补丁');
    } catch (err: any) {
      messageApi.error(err?.message || '图表增强失败');
    } finally {
      setBusy('');
    }
  };

  const researchKnowledge = async () => {
    const targetKnowledge = plan.knowledge.find((item) => item.status !== 'ready') || plan.knowledge[0];
    const targetSlide = plan.slides[1] || plan.slides[0];
    if (!targetKnowledge) return;
    setBusy('research');
    try {
      const result = await adapters.research.researchKnowledge({
        query: `补充 ${targetKnowledge.title}`,
        config,
        knowledge: targetKnowledge,
        slide: targetSlide,
      });
      setPlan((prev) => ({
        ...prev,
        knowledge: prev.knowledge.map((item) => item.id === result.knowledge.id ? result.knowledge : item),
        slides: result.slide_patch && targetSlide
          ? prev.slides.map((slide) => slide.id === targetSlide.id ? { ...slide, ...result.slide_patch } : slide)
          : prev.slides,
        generatedAt: new Date().toISOString(),
      }));
      pushEvent(`Mock Research 已补充 ${result.sources?.length || 0} 条资料来源`);
      messageApi.success('Mock 资料已补充');
    } catch (err: any) {
      messageApi.error(err?.message || '资料补充失败');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="aippt-offline-page">
      {contextHolder}
      <header className="aippt-offline-hero">
        <div>
          <Tag color="blue">AIPPT Offline Demo</Tag>
          <h1>Schema 驱动 AI PPT 离线演示</h1>
          <p>使用 Mock Agent、Local Storage 和 HTML Renderer，不连接 OpenAtlas 后端也能跑通生成、编辑、保存、回退和预览。</p>
        </div>
        <div className="aippt-offline-hero__meta">
          <span><FilePptOutlined /> {plan.slides.length} 页</span>
          <span><DatabaseOutlined /> {activeDeckId ? '已保存' : '未保存'}</span>
          <span><ThunderboltOutlined /> {style.name}</span>
        </div>
      </header>

      <main className="aippt-offline-shell">
        <aside className="aippt-offline-panel">
          <div className="aippt-offline-section-title">
            <PlayCircleOutlined />
            离线生成
          </div>
          <Input.TextArea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
          />
          <div className="aippt-offline-actions">
            <Button type="primary" icon={<PlayCircleOutlined />} loading={busy === 'generate'} onClick={generateOffline}>
              Mock 生成
            </Button>
            <Button icon={<SaveOutlined />} loading={busy === 'save'} onClick={saveOffline}>
              保存版本
            </Button>
          </div>
          <div className="aippt-offline-actions">
            <Button icon={<HighlightOutlined />} loading={busy === 'patch'} onClick={enhanceChart}>
              增强图表
            </Button>
            <Button icon={<SearchOutlined />} loading={busy === 'research'} onClick={researchKnowledge}>
              补资料
            </Button>
          </div>
          <Button icon={<CloudDownloadOutlined />} onClick={() => downloadText(htmlDeck, `${safeFileTitle(plan.title)}.html`)}>
            下载 HTML
          </Button>
          <Alert
            type="info"
            showIcon
            message="离线模式"
            description="本页不会调用 /api；保存使用浏览器 localStorage。Mock 数据只用于开源 demo 和测试。"
          />
        </aside>

        <section className="aippt-offline-preview">
          <div className="aippt-offline-preview__head">
            <strong>{plan.title}</strong>
            <span>{config.audience} · {config.durationMinutes} 分钟 · {config.aspectRatio}</span>
          </div>
          <iframe title="AIPPT offline HTML preview" srcDoc={htmlDeck} />
        </section>

        <aside className="aippt-offline-panel">
          <div className="aippt-offline-section-title">
            <ReloadOutlined />
            本地版本
          </div>
          <Select
            placeholder="选择版本回退"
            disabled={!activeDeckId || versions.length === 0}
            onChange={restoreOffline}
            options={versions.map((version) => ({
              value: version.id,
              label: `v${version.version_no} · ${version.change_summary || version.title}`,
            }))}
          />
          <div className="aippt-offline-version-list">
            {versions.length === 0 ? (
              <span>保存后会在这里显示本地版本。</span>
            ) : versions.map((version) => (
              <article key={version.id}>
                <b>v{version.version_no}</b>
                <strong>{version.change_summary || version.title}</strong>
                <span>{version.created_at || '-'}</span>
              </article>
            ))}
          </div>
          <div className="aippt-offline-section-title">
            事件日志
          </div>
          <div className="aippt-offline-events">
            {events.map((event) => <span key={event}>{event}</span>)}
          </div>
        </aside>
      </main>
    </div>
  );
}
