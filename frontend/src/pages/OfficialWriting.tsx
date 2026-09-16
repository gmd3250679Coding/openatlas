import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Input, Select, Spin, Tag, Tooltip, message } from 'antd';
import {
  ApartmentOutlined,
  AuditOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  FileDoneOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  FileWordOutlined,
  FormOutlined,
  HistoryOutlined,
  MailOutlined,
  NotificationOutlined,
  ReadOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  WechatOutlined,
} from '@ant-design/icons';
import ArtifactPreviewContent from '../components/ArtifactPreviewContent';
import ArtifactPreviewDrawer from '../components/ArtifactPreviewDrawer';
import ChatMessage from '../components/ChatMessage';
import Composer from '../components/Composer';
import {
  downloadProtectedFile,
  extractOfficialDocumentIntent,
  fetchOfficialDocuments,
  generateOfficialDocument,
  getOfficialDocument,
  previewOfficialDocumentVersion,
  reviseOfficialDocument,
  type Attachment,
  type FilePreviewPayload,
  type OfficialA2UIAction,
  type OfficialA2UIBlock,
  type OfficialDocument,
  type OfficialDocumentVersion,
  type OfficialWritingComplianceItem,
  type OfficialWritingFieldDef,
  type OfficialWritingSurface,
} from '../services/api';
import '../styles/official-writing.css';

type ChatTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

const EXAMPLES = [
  '帮我写一份关于加强数据安全管理的通知，下周一发给各部门，要求自查并提交整改计划。',
  '起草一份请示，申请启动客户数据治理专项，经费和人员需要上级批复。',
  '写一份关于上半年数字化转型推进情况的报告，面向集团领导。',
  '拟一份函，致合作单位，请对接口联调时间安排予以确认。',
  '写一篇内网新闻宣传稿，主题是研发中心完成智能合同审核上线。',
  '写一篇微信公众号推文，介绍 InsightLab 公文写作能力，语气正式清爽。',
];

const TYPE_ICON: Record<string, ReactNode> = {
  notice: <NotificationOutlined />,
  request: <FileProtectOutlined />,
  report: <BarChartOutlined />,
  letter: <MailOutlined />,
  publicity_article: <ReadOutlined />,
  intranet_news: <ReadOutlined />,
  wechat_article: <WechatOutlined />,
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  recognized: { label: '已识别', color: 'blue' },
  defaulted: { label: '默认', color: 'geekblue' },
  needs_confirm: { label: '待确认', color: 'gold' },
  optional: { label: '可选', color: 'default' },
};

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeWritingInput(value: string) {
  return value
    .trim()
    .replace(/^(好的|好|嗯|收到|可以|行|ok|OK|没问题|明白了|辛苦了)[，,。.\s]*/g, '')
    .trim();
}

function looksLikeNewDraftRequest(value: string) {
  const q = normalizeWritingInput(value);
  if (!q) return false;
  const docNounPattern = /(通知|通告|请示|申请|报批|报告|汇报|总结|函|复函|新闻稿|宣传稿|外宣稿|外宣|发布稿|传播稿|简讯|内网新闻|会议通知|公众号|推文|微信文章|文案|稿件)/;
  const newIntentPattern = /(新建|另写|再写|重新写|重新起草|写一[份篇个]|起草一[份篇个]|拟一[份篇个]|生成一[份篇个]|撰写一[份篇个]|帮我写|帮我起草|帮我拟|帮我生成|帮我找一[份篇个]|现在帮我|我想写|我要写|需要写)/;
  const revisionPattern = /(修改|改成|改为|更新为|替换|换成|润色|优化|精简|扩写|补充|删除|去掉|加上|调整|语气|标题改|来源改|公司名称|发布单位|上一版|当前稿|当前初稿|这个稿|这篇|原文|文中|最后的来源|最后来源|版本)/;
  if (!docNounPattern.test(q)) return false;
  if (revisionPattern.test(q) && !newIntentPattern.test(q)) return false;
  return newIntentPattern.test(q) || /关于.+(通知|请示|报告|函|新闻稿|宣传稿|外宣稿|公众号|推文)/.test(q);
}

function latestVersion(doc: OfficialDocument | null): OfficialDocumentVersion | null {
  if (!doc?.versions?.length) return null;
  return doc.versions.find((v) => v.id === doc.current_version_id) || doc.versions[0] || null;
}

function fieldValue(value: any): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join('；');
  return String(value);
}

export default function OfficialWriting() {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: '我是公文写作 Agent。你可以直接说要写什么，我会先识别文种和关键字段，把需要确认的内容生成一张可操作卡片；确认后输出完整 DOCX 初稿。',
    },
  ]);
  const [surface, setSurface] = useState<OfficialWritingSurface | null>(null);
  const [fields, setFields] = useState<Record<string, any>>({});
  const [templateKey, setTemplateKey] = useState('gbt9704');
  const [documents, setDocuments] = useState<OfficialDocument[]>([]);
  const [current, setCurrent] = useState<OfficialDocument | null>(null);
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [revising, setRevising] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const emptyAttachments = useMemo<Attachment[]>(() => [], []);

  const intent = surface?.intent;
  const latest = latestVersion(current);
  const compliance = current?.compliance || surface?.compliance || [];
  const passCount = compliance.filter((item) => item.status === 'pass').length;
  const missingCount = surface?.field_defs.filter((field) => field.status === 'needs_confirm').length || 0;

  useEffect(() => {
    void reloadDocuments();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length, surface?.surface_id, current?.id, analyzing, generating]);

  async function reloadDocuments() {
    try {
      const rows = await fetchOfficialDocuments();
      setDocuments(rows);
    } catch {
      // History is helpful, not required for the writing flow.
    }
  }

  function pushTurn(role: ChatTurn['role'], text: string) {
    setTurns((prev) => [...prev, { id: uid(role), role, text }]);
  }

  function startNewDraftMode() {
    setInput('');
    setSurface(null);
    setCurrent(null);
    setPreview(null);
    setFields({});
    setTemplateKey('gbt9704');
    pushTurn('assistant', '已切换到新建初稿。你可以直接说下一篇要写什么，我会重新识别文种并生成确认卡。');
  }

  async function sendPrompt(nextInput = input, opts: { forceNew?: boolean } = {}) {
    const query = nextInput.trim();
    if (!query) {
      message.warning('先输入一句公文需求');
      return;
    }
    const shouldCreateNewDraft = opts.forceNew || looksLikeNewDraftRequest(query);
    if (current && !surface && !shouldCreateNewDraft) {
      await reviseDraft(query);
      return;
    }

    setInput('');
    setSurface(null);
    setCurrent(null);
    setPreview(null);
    pushTurn('user', query);
    setAnalyzing(true);

    try {
      const nextSurface = await extractOfficialDocumentIntent(query);
      setSurface(nextSurface);
      setFields(nextSurface.fields || {});
      setTemplateKey(nextSurface.template_key || 'gbt9704');
      const missing = nextSurface.missing?.length || 0;
      pushTurn(
        'assistant',
        missing > 0
          ? `我识别为「${nextSurface.intent.label}」。下面这张确认卡已经从你的需求里自动补全字段，还有 ${missing} 项建议扫一眼。`
          : `我识别为「${nextSurface.intent.label}」。字段已经比较完整，可以直接生成完整初稿。`,
      );
    } catch (err: any) {
      pushTurn('assistant', `识别失败：${err?.message || '请稍后重试'}`);
      message.error(err?.message || '识别失败');
    } finally {
      setAnalyzing(false);
    }
  }

  function updateField(key: string, value: any) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function generateDraft() {
    if (!surface) {
      await sendPrompt();
      return;
    }

    setGenerating(true);
    try {
      pushTurn('assistant', '收到确认。我会按当前字段生成完整初稿，并同步生成可预览、可下载的 DOCX。');
      const doc = await generateOfficialDocument({
        query: turns.filter((turn) => turn.role === 'user').at(-1)?.text || input,
        doc_type: surface.intent.doc_type,
        template_key: templateKey,
        fields,
      });
      setCurrent(doc);
      await reloadDocuments();
      const version = latestVersion(doc);
      if (version) {
        await openPreview(version, { silent: true });
      }
      setSurface(null);
      setFields(doc.fields || fields);
      pushTurn('assistant', `完整初稿已生成：${doc.title}。你可以先在线预览，也可以直接下载 DOCX 继续编辑。`);
      message.success('完整初稿已生成');
    } catch (err: any) {
      pushTurn('assistant', `生成失败：${err?.message || '请稍后重试'}`);
      message.error(err?.message || '生成失败');
    } finally {
      setGenerating(false);
    }
  }

  async function reviseDraft(nextInstruction = input) {
    const instruction = nextInstruction.trim();
    if (!instruction) {
      message.warning('先输入修改意见');
      return;
    }
    if (!current) {
      await sendPrompt(instruction, { forceNew: true });
      return;
    }

    setInput('');
    setSurface(null);
    pushTurn('user', instruction);
    setRevising(true);
    try {
      pushTurn('assistant', '我会基于当前初稿生成一个新版本，保留原版本方便回看。');
      const doc = await reviseOfficialDocument(current.id, {
        instruction,
        fields: current.fields || fields,
      });
      setCurrent(doc);
      setFields(doc.fields || fields);
      await reloadDocuments();
      const version = latestVersion(doc);
      if (version) {
        await openPreview(version, { silent: true });
      }
      pushTurn('assistant', `已生成 v${version?.version_no || doc.version_count}：${doc.title}。右侧审阅区可以比较版本并预览下载。`);
      message.success('已生成新版本');
    } catch (err: any) {
      pushTurn('assistant', `修改失败：${err?.message || '请稍后重试'}`);
      message.error(err?.message || '修改失败');
    } finally {
      setRevising(false);
    }
  }

  async function openPreview(version: OfficialDocumentVersion, opts: { silent?: boolean } = {}) {
    setPreviewLoading(true);
    try {
      const payload = await previewOfficialDocumentVersion(version.id);
      setPreview(payload);
    } catch (err: any) {
      if (!opts.silent) message.error(err?.message || '预览失败');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function downloadVersion(version: OfficialDocumentVersion) {
    try {
      await downloadProtectedFile(version.download_url, version.name);
    } catch (err: any) {
      message.error(err?.message || '下载失败');
    }
  }

  async function openHistoryDocument(doc: OfficialDocument) {
    try {
      const detail = await getOfficialDocument(doc.id);
      setCurrent(detail);
      setSurface(null);
      pushTurn('assistant', `已打开历史初稿：${detail.title}。`);
    } catch (err: any) {
      message.error(err?.message || '打开失败');
    }
  }

  const onComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
      event.preventDefault();
      void sendPrompt();
    }
  };

  return (
    <div className="official-writing-page">
      <main className="official-chat-shell">
        <header className="official-chat-head">
          <div className="official-agent-mark">
            <span><FileWordOutlined /></span>
            <div>
              <strong>公文写作</strong>
              <em>A2UI · React / AntD Renderer</em>
            </div>
          </div>
          <div className="official-chat-head__meta">
            <Tag color={intent?.group === 'publicity' ? 'green' : 'blue'}>{intent?.label || '6 类高频'}</Tag>
            <Tag color="processing">Agent Surface</Tag>
            {(current || surface) && (
              <Button size="small" icon={<FileTextOutlined />} onClick={startNewDraftMode}>
                新建初稿
              </Button>
            )}
          </div>
        </header>

        <div className="official-chat-stream">
          {turns.map((turn) => (
            <ChatMessage
              key={turn.id}
              role={turn.role === 'user' ? 'user' : 'assistant'}
              sender={turn.role === 'user' ? '你' : '公文写作 Agent'}
              avatar={turn.role === 'user' ? '我' : '文'}
              color={turn.role === 'user' ? 'var(--accent)' : '#2563eb'}
              text={turn.text}
            />
          ))}

          {analyzing && (
            <div className="official-agent-thinking">
              <span />
              正在识别文种、抽取字段并生成确认卡...
            </div>
          )}

          {surface && (
            <OfficialSurfaceMessage
              surface={surface}
              fields={fields}
              templateKey={templateKey}
              missingCount={missingCount}
              onFieldChange={updateField}
              onTemplateChange={setTemplateKey}
              onGenerate={() => void generateDraft()}
              onRefresh={() => void sendPrompt(turns.filter((turn) => turn.role === 'user').at(-1)?.text || input, { forceNew: true })}
              generating={generating}
            />
          )}

          {current && latest && (
            <OfficialDraftMessage
              document={current}
              version={latest}
              previewLoading={previewLoading}
              onPreview={() => void openPreview(latest)}
              onDownload={() => void downloadVersion(latest)}
            />
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="official-example-strip">
          {EXAMPLES.map((item, index) => (
            <button key={item} type="button" onClick={() => void sendPrompt(item, { forceNew: true })}>
              示例 {index + 1}
            </button>
          ))}
        </div>

        <Composer
          input={input}
          setInput={setInput}
          disabled={analyzing || generating || revising}
          running={analyzing || generating || revising}
          uploading={false}
          pendingAttachments={emptyAttachments}
          onSend={() => void sendPrompt()}
          onAbort={() => {
            setAnalyzing(false);
            setGenerating(false);
            setRevising(false);
          }}
          onKeyDown={onComposerKeyDown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onFileSelect={() => message.info('公文写作首版先聚焦文本起草')}
          placeholder={current && !surface ? '输入新稿需求或修改意见，例如：写一份会议通知 / 把语气改正式一点...' : '说出要写的公文，例如：下周一发给各部门的数据安全通知...'}
        />
      </main>

      <aside className="official-writing-side">
        <OfficialReviewPanel
          document={current}
          surface={surface}
          latest={latest}
          previewLoading={previewLoading}
          onPreview={(version) => void openPreview(version)}
          onDownload={(version) => void downloadVersion(version)}
        />

        <section className="official-side-panel official-side-panel--state">
          <div className="official-side-panel__head">
            <span><AuditOutlined /> 任务状态</span>
            {generating || revising ? <Spin size="small" /> : <Tag color={current ? 'green' : surface ? 'blue' : 'default'}>{current ? '可继续修改' : surface ? '待确认' : '待输入'}</Tag>}
          </div>
          <div className="official-state-list">
            <StateRow icon={<SendOutlined />} label="用户需求" active={turns.some((turn) => turn.role === 'user')} />
            <StateRow icon={<FormOutlined />} label="A2UI 确认卡" active={Boolean(surface)} />
            <StateRow icon={<FileDoneOutlined />} label="完整初稿" active={Boolean(current)} />
            <StateRow icon={<FileWordOutlined />} label="二次修改" active={Boolean(current && current.version_count > 1)} />
          </div>
        </section>

        <section className="official-side-panel">
          <div className="official-side-panel__head">
            <span><SafetyCertificateOutlined /> 规范检查</span>
            {compliance.length > 0 && <Tag color="blue">{passCount}/{compliance.length}</Tag>}
          </div>
          {compliance.length > 0 ? (
            <div className="official-check-list">
              {compliance.map((item) => <ComplianceRow key={item.key} item={item} />)}
            </div>
          ) : (
            <div className="official-side-empty">确认字段后显示版式与要素检查。</div>
          )}
        </section>

        <section className="official-side-panel">
          <div className="official-side-panel__head">
            <span><HistoryOutlined /> 最近初稿</span>
            {documents.length > 0 && <Tag>{documents.length}</Tag>}
          </div>
          {documents.length === 0 ? (
            <div className="official-side-empty">还没有生成记录。</div>
          ) : (
            <div className="official-history-list">
              {documents.slice(0, 7).map((doc) => (
                <button key={doc.id} type="button" onClick={() => void openHistoryDocument(doc)}>
                  <span>{TYPE_ICON[doc.doc_type] || <FileTextOutlined />}</span>
                  <strong>{doc.title}</strong>
                  <em>{doc.doc_type_label} · {doc.status}</em>
                </button>
              ))}
            </div>
          )}
        </section>
      </aside>

      <ArtifactPreviewDrawer
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview ? `${preview.name} · 初稿预览` : '公文初稿预览'}
      >
        {preview && <ArtifactPreviewContent preview={preview} />}
      </ArtifactPreviewDrawer>
    </div>
  );
}

function OfficialReviewPanel({
  document,
  surface,
  latest,
  previewLoading,
  onPreview,
  onDownload,
}: {
  document: OfficialDocument | null;
  surface: OfficialWritingSurface | null;
  latest: OfficialDocumentVersion | null;
  previewLoading: boolean;
  onPreview: (version: OfficialDocumentVersion) => void;
  onDownload: (version: OfficialDocumentVersion) => void;
}) {
  const draftPreview = String(surface?.draft_preview || '').trim();
  return (
    <section className="official-side-panel official-review-panel">
      <div className="official-side-panel__head">
        <span><FileDoneOutlined /> 初稿审阅区</span>
        {latest ? <Tag color="green">v{latest.version_no}</Tag> : surface ? <Tag color="blue">待生成</Tag> : <Tag>空</Tag>}
      </div>

      {document && latest ? (
        <>
          <div className="official-review-hero">
            <strong>{document.title}</strong>
            <em>{document.doc_type_label} · {document.template_key}</em>
            <p>{document.summary || latest.change_summary}</p>
          </div>
          <div className="official-review-actions">
            <Button size="small" type="primary" loading={previewLoading} onClick={() => onPreview(latest)}>预览当前版</Button>
            <Button size="small" icon={<DownloadOutlined />} onClick={() => onDownload(latest)}>下载</Button>
          </div>
          {document.draft_excerpt && (
            <div className="official-review-excerpt">
              <span>正文摘录</span>
              <p>{document.draft_excerpt}</p>
            </div>
          )}
          {document.versions && document.versions.length > 0 && (
            <div className="official-version-list">
              {document.versions.map((version) => (
                <div key={version.id} className={version.id === document.current_version_id ? 'is-current' : ''}>
                  <button type="button" onClick={() => onPreview(version)}>
                    <strong>v{version.version_no}</strong>
                    <span>{version.change_summary || version.name}</span>
                  </button>
                  <button type="button" aria-label={`下载 v${version.version_no}`} onClick={() => onDownload(version)}>
                    <DownloadOutlined />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : surface ? (
        <div className="official-review-empty">
          <strong>{surface.intent.label}确认中</strong>
          <p>{draftPreview || '确认字段后会生成完整 DOCX 初稿，随后这里会显示正文摘录和版本记录。'}</p>
        </div>
      ) : (
        <div className="official-review-empty">
          <strong>等待需求</strong>
          <p>输入一句公文需求后，Agent 会先生成确认卡；生成初稿后可继续用自然语言修改。</p>
        </div>
      )}
    </section>
  );
}

function OfficialSurfaceMessage({
  surface,
  fields,
  templateKey,
  missingCount,
  generating,
  onFieldChange,
  onTemplateChange,
  onGenerate,
  onRefresh,
}: {
  surface: OfficialWritingSurface;
  fields: Record<string, any>;
  templateKey: string;
  missingCount: number;
  generating: boolean;
  onFieldChange: (key: string, value: any) => void;
  onTemplateChange: (key: string) => void;
  onGenerate: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="official-surface-message">
      <div className="official-surface-avatar">文</div>
      <section className={`official-a2ui-card official-a2ui-card--${surface.intent.accent || 'blue'}`}>
        <OfficialA2UIRenderer
          surface={surface}
          fields={fields}
          templateKey={templateKey}
          missingCount={missingCount}
          generating={generating}
          onFieldChange={onFieldChange}
          onTemplateChange={onTemplateChange}
          onGenerate={onGenerate}
          onRefresh={onRefresh}
        />
      </section>
    </div>
  );
}

function OfficialA2UIRenderer({
  surface,
  fields,
  templateKey,
  missingCount,
  generating,
  onFieldChange,
  onTemplateChange,
  onGenerate,
  onRefresh,
}: {
  surface: OfficialWritingSurface;
  fields: Record<string, any>;
  templateKey: string;
  missingCount: number;
  generating: boolean;
  onFieldChange: (key: string, value: any) => void;
  onTemplateChange: (key: string) => void;
  onGenerate: () => void;
  onRefresh: () => void;
}) {
  const fallbackBlocks = useMemo<OfficialA2UIBlock[]>(() => [
    {
      id: 'fallback-summary',
      type: 'render_card',
      title: `${surface.intent.label}字段确认`,
      subtitle: `A2UI Surface · ${surface.component}`,
      icon: surface.intent.doc_type,
      accent: surface.intent.accent,
      badges: [
        { label: surface.intent.group === 'official' ? '规范公文' : '宣传稿件', tone: surface.intent.group === 'official' ? 'blue' : 'green' },
        { label: missingCount ? `${missingCount} 项待确认` : '可生成', tone: missingCount ? 'gold' : 'green' },
        { label: `${Math.round((surface.intent.confidence || 0) * 100)}%`, tone: 'default' },
      ],
    },
    {
      id: 'fallback-form',
      type: 'render_form',
      fields: surface.field_defs,
      values: surface.fields,
      layout: 'two_column',
    },
    {
      id: 'fallback-template',
      type: 'render_template_picker',
      value: surface.template_key,
      options: surface.template_options,
    },
    {
      id: 'fallback-preview',
      type: 'render_review_panel',
      title: '初稿方向',
      content: surface.draft_preview || '',
    },
    {
      id: 'fallback-actions',
      type: 'render_actions',
      actions: [
        { id: 'generate_docx', label: '确认并生成完整初稿', intent: 'official_doc.generate_docx', style: 'primary', icon: 'file_word' },
        { id: 'refresh_intent', label: '重新识别', intent: 'official_doc.refresh_intent', icon: 'form' },
      ],
    },
  ], [missingCount, surface]);
  const blocks = surface.a2ui?.ui_blocks?.length ? surface.a2ui.ui_blocks : (surface.ui_blocks?.length ? surface.ui_blocks : fallbackBlocks);

  function dispatchAction(action: OfficialA2UIAction) {
    if (action.disabled) return;
    if (action.intent === 'official_doc.generate_docx') {
      onGenerate();
      return;
    }
    if (action.intent === 'official_doc.refresh_intent' || action.intent === 'official_doc.refine_fields') {
      onRefresh();
      return;
    }
  }

  return (
    <div className="official-a2ui-renderer" data-schema={surface.a2ui?.schema_version || surface.version}>
      {blocks.map((block) => (
        <OfficialA2UIBlockRenderer
          key={block.id}
          block={block}
          fields={fields}
          templateKey={templateKey}
          generating={generating}
          onFieldChange={onFieldChange}
          onTemplateChange={onTemplateChange}
          onAction={dispatchAction}
        />
      ))}
    </div>
  );
}

function OfficialA2UIBlockRenderer({
  block,
  fields,
  templateKey,
  generating,
  onFieldChange,
  onTemplateChange,
  onAction,
}: {
  block: OfficialA2UIBlock;
  fields: Record<string, any>;
  templateKey: string;
  generating: boolean;
  onFieldChange: (key: string, value: any) => void;
  onTemplateChange: (key: string) => void;
  onAction: (action: OfficialA2UIAction) => void;
}) {
  if (block.type === 'render_card') {
    const icon = TYPE_ICON[block.icon || ''] || <FileTextOutlined />;
    return (
      <div className="official-a2ui-card__head official-a2ui-block" data-block-type={block.type}>
        <div className="official-a2ui-title">
          <span>{icon}</span>
          <div>
            <em>{block.subtitle || 'A2UI Surface'}</em>
            <strong>{block.title}</strong>
          </div>
        </div>
        <div className="official-a2ui-tags">
          {(block.badges || []).map((badge) => (
            <Tag key={`${badge.label}-${badge.tone}`} color={badge.tone === 'default' ? undefined : badge.tone}>{badge.label}</Tag>
          ))}
        </div>
      </div>
    );
  }

  if (block.type === 'render_extraction_evidence') {
    const items = block.items || [];
    if (!items.length) return null;
    return (
      <div className="official-a2ui-evidence official-a2ui-block" data-block-type={block.type}>
        <div className="official-a2ui-evidence__head">
          <span><AuditOutlined /></span>
          <strong>{block.title || '已识别字段'}</strong>
        </div>
        <div className="official-a2ui-evidence__grid">
          {items.map((item) => (
            <div key={`${item.field || item.label}-${item.value}`} className="official-a2ui-evidence__item">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              {item.source_text ? <em>来自：{item.source_text}</em> : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (block.type === 'render_form') {
    return (
      <div className={`official-a2ui-fields official-a2ui-fields--${block.layout || 'two_column'}`} data-block-type={block.type}>
        {(block.fields || []).map((field) => (
          <OfficialField
            key={field.key}
            field={field}
            value={fields[field.key] ?? block.values?.[field.key] ?? field.value}
            onChange={(value) => onFieldChange(field.key, value)}
          />
        ))}
      </div>
    );
  }

  if (block.type === 'render_template_picker') {
    return (
      <div className="official-template-strip-card" data-block-type={block.type}>
        {(block.options || []).map((tpl) => (
          <button
            type="button"
            key={tpl.key}
            className={templateKey === tpl.key ? 'is-active' : ''}
            onClick={() => onTemplateChange(tpl.key)}
          >
            <span>{tpl.key === 'gbt9704' ? <SafetyCertificateOutlined /> : tpl.key === 'wechat' ? <WechatOutlined /> : <ApartmentOutlined />}</span>
            <strong>{tpl.label}</strong>
          </button>
        ))}
      </div>
    );
  }

  if (block.type === 'render_review_panel') {
    const content = String(block.content || '').trim();
    if (!content) return null;
    return (
      <div className="official-draft-teaser" data-block-type={block.type}>
        <span>{block.title || '初稿方向'}</span>
        <p>{content}</p>
      </div>
    );
  }

  if (block.type === 'render_actions') {
    return (
      <div className="official-a2ui-actions" data-block-type={block.type}>
        {(block.actions || []).map((action) => (
          <Button
            key={action.id}
            type={action.style === 'primary' ? 'primary' : 'default'}
            icon={officialActionIcon(action.icon)}
            loading={generating && action.intent === 'official_doc.generate_docx'}
            disabled={action.disabled}
            onClick={() => onAction(action)}
          >
            {action.label}
          </Button>
        ))}
      </div>
    );
  }

  return null;
}

function officialActionIcon(icon?: string) {
  if (icon === 'file_word') return <FileWordOutlined />;
  if (icon === 'form') return <FormOutlined />;
  if (icon === 'download') return <DownloadOutlined />;
  return undefined;
}

function OfficialDraftMessage({
  document,
  version,
  previewLoading,
  onPreview,
  onDownload,
}: {
  document: OfficialDocument;
  version: OfficialDocumentVersion;
  previewLoading: boolean;
  onPreview: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="official-surface-message official-surface-message--draft">
      <div className="official-surface-avatar">文</div>
      <section className="official-draft-card">
        <div className="official-draft-card__icon"><FileDoneOutlined /></div>
        <div className="official-draft-card__body">
          <em>完整初稿 · DOCX</em>
          <strong>{version.name}</strong>
          <p>{document.summary || version.change_summary}</p>
        </div>
        <div className="official-draft-card__actions">
          <Button loading={previewLoading} onClick={onPreview}>预览</Button>
          <Button icon={<DownloadOutlined />} onClick={onDownload}>下载</Button>
        </div>
      </section>
    </div>
  );
}

function OfficialField({ field, value, onChange }: {
  field: OfficialWritingFieldDef;
  value: any;
  onChange: (value: any) => void;
}) {
  const status = STATUS_META[field.status] || STATUS_META.optional;
  const displayValue = fieldValue(value);
  return (
    <label className={`official-field official-field--${field.status}`}>
      <span className="official-field__label">
        <span>{field.label}</span>
        <Tooltip title={field.required ? '生成前建议确认' : '可按需补充'}>
          <Tag color={status.color}>{status.label}</Tag>
        </Tooltip>
      </span>
      {field.control === 'textarea' ? (
        <Input.TextArea
          value={displayValue}
          onChange={(event) => onChange(event.target.value)}
          autoSize={{ minRows: field.rows || 2, maxRows: 4 }}
          placeholder={field.placeholder}
        />
      ) : field.control === 'select' ? (
        <Select
          value={displayValue || undefined}
          onChange={onChange}
          placeholder={field.placeholder}
          options={field.options || []}
        />
      ) : (
        <Input
          value={displayValue}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
        />
      )}
    </label>
  );
}

function ComplianceRow({ item }: { item: OfficialWritingComplianceItem }) {
  const ok = item.status === 'pass';
  return (
    <div className={`official-check official-check--${ok ? 'pass' : 'warn'}`}>
      <span>{ok ? <CheckCircleOutlined /> : <AuditOutlined />}</span>
      <div>
        <strong>{item.label}</strong>
        <em>{item.detail}</em>
      </div>
    </div>
  );
}

function StateRow({ icon, label, active }: { icon: ReactNode; label: string; active: boolean }) {
  return (
    <div className={`official-state-row ${active ? 'is-active' : ''}`}>
      <span>{icon}</span>
      <strong>{label}</strong>
      <em>{active ? '完成' : '等待'}</em>
    </div>
  );
}
