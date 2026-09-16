import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import DOMPurify from 'dompurify';
import {
  Alert,
  Button,
  Empty,
  Input,
  Segmented,
  Select,
  Spin,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  DownloadOutlined,
  FileDoneOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SplitCellsOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  contractVersionDownloadUrl,
  fetchContractReviews,
  fetchContractReview,
  getToken,
  patchContractIssue,
  previewContractVersion,
  regenerateContractDeliverables,
  runContractReview,
  uploadContractReview,
  type ContractReviewDocument,
  type ContractReviewIssue,
  type ContractVersion,
} from '../services/api';
import MarkdownRenderer from '../components/MarkdownRenderer';
import ArtifactPreviewContent from '../components/ArtifactPreviewContent';
import '../styles/contract-review.css';

const CONTRACT_TYPES = [
  { value: 'general', label: '通用合同' },
  { value: 'sales', label: '销售合同' },
  { value: 'purchase', label: '采购合同' },
  { value: 'service', label: '技术服务合同' },
  { value: 'labor', label: '劳动合同' },
  { value: 'nda', label: '保密协议' },
];

const PERSPECTIVES = [
  { value: 'balanced', label: '均衡审查' },
  { value: 'party_a', label: '偏甲方' },
  { value: 'party_b', label: '偏乙方' },
  { value: 'strict', label: '强风控' },
];

const severityLabel: Record<string, string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
};

const issueStatusLabel: Record<string, string> = {
  open: '待处理',
  accepted: '已采纳',
  ignored: '已忽略',
};

function versionLabel(v: ContractVersion) {
  if (v.kind === 'original') return '原始合同';
  if (v.kind === 'revised') return 'AI 批注版';
  if (v.kind === 'report') return '审核报告';
  return v.kind;
}

function formatSize(size: number) {
  if (!size) return '-';
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

async function downloadVersion(version: ContractVersion) {
  const token = getToken();
  const resp = await fetch(contractVersionDownloadUrl(version.id), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new Error(`下载失败：${resp.status}`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = version.name || 'contract-file';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 100);
}

export default function ContractReview() {
  const [contracts, setContracts] = useState<ContractReviewDocument[]>([]);
  const [current, setCurrent] = useState<ContractReviewDocument | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [preview, setPreview] = useState<any>(null);
  const [revisedPreview, setRevisedPreview] = useState<any>(null);
  const [contractType, setContractType] = useState('general');
  const [perspective, setPerspective] = useState('balanced');
  const [focus, setFocus] = useState('');
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [docPreviewMode, setDocPreviewMode] = useState<'review' | 'original'>('review');
  const paragraphRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const pendingLocateRef = useRef<ContractReviewIssue | null>(null);
  const pendingLocateSourceRef = useRef<HTMLElement | null>(null);
  const scrollSyncRef = useRef<{ locked: boolean; releaseTimer?: number }>({ locked: false });
  const locateGuideTimerRef = useRef<number | null>(null);
  const locateGuideElRef = useRef<SVGSVGElement | null>(null);

  const versions = current?.versions || [];
  const issues = current?.issues || [];
  const originalVersion = useMemo(() => versions.find((v) => v.kind === 'original'), [versions]);
  const revisedVersion = useMemo(() => versions.find((v) => v.kind === 'revised'), [versions]);
  const reportVersion = useMemo(() => versions.find((v) => v.kind === 'report'), [versions]);
  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) || null,
    [versions, selectedVersionId],
  );
  const visibleVersions = useMemo(() => {
    const byKind = new Map<string, ContractVersion>();
    versions.forEach((version) => {
      const previous = byKind.get(version.kind);
      if (!previous || version.version_no > previous.version_no) {
        byKind.set(version.kind, version);
      }
    });
    const orderedKinds = ['revised', 'report', 'original'];
    const rows = orderedKinds
      .map((kind) => byKind.get(kind))
      .filter(Boolean) as ContractVersion[];
    if (selectedVersion && !rows.some((version) => version.id === selectedVersion.id)) {
      rows.unshift(selectedVersion);
    }
    return rows;
  }, [selectedVersion, versions]);

  const loadContracts = async () => {
    setLoading(true);
    try {
      const rows = await fetchContractReviews();
      setContracts(rows);
      if (!current && rows[0]) {
        const detail = await fetchContractReview(rows[0].id);
        setCurrent(detail);
        setSelectedVersionId(detail.current_version_id || detail.versions?.[0]?.id || '');
      }
    } catch (err: any) {
      message.error(err?.message || '加载合同列表失败');
    } finally {
      setLoading(false);
    }
  };

  const refreshCurrent = async (id = current?.id) => {
    if (!id) return;
    const detail = await fetchContractReview(id);
    setCurrent(detail);
    setContracts((prev) => [detail, ...prev.filter((item) => item.id !== detail.id)]);
    if (!selectedVersionId) setSelectedVersionId(detail.current_version_id || detail.versions?.[0]?.id || '');
  };

  useEffect(() => {
    loadContracts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const shell = previewShellRef.current;
    const originalPane = shell?.querySelector<HTMLElement>('.contract-preview-pane-original');
    const revisedPane = shell?.querySelector<HTMLElement>('.contract-preview-pane-revised');
    if (!originalPane || !revisedPane || selectedVersion?.kind === 'report') return;

    const syncScroll = (source: HTMLElement, target: HTMLElement) => {
      const state = scrollSyncRef.current;
      if (state.locked) return;
      const sourceMax = Math.max(0, source.scrollHeight - source.clientHeight);
      const targetMax = Math.max(0, target.scrollHeight - target.clientHeight);
      const ratio = sourceMax > 0 ? source.scrollTop / sourceMax : 0;
      state.locked = true;
      target.scrollTop = ratio * targetMax;
      if (state.releaseTimer) window.clearTimeout(state.releaseTimer);
      state.releaseTimer = window.setTimeout(() => {
        state.locked = false;
      }, 80);
    };

    const onOriginalScroll = () => syncScroll(originalPane, revisedPane);
    const onRevisedScroll = () => syncScroll(revisedPane, originalPane);
    originalPane.addEventListener('scroll', onOriginalScroll, { passive: true });
    revisedPane.addEventListener('scroll', onRevisedScroll, { passive: true });
    return () => {
      originalPane.removeEventListener('scroll', onOriginalScroll);
      revisedPane.removeEventListener('scroll', onRevisedScroll);
      if (scrollSyncRef.current.releaseTimer) {
        window.clearTimeout(scrollSyncRef.current.releaseTimer);
      }
      scrollSyncRef.current.locked = false;
    };
  }, [current?.id, preview, revisedPreview, selectedVersion?.kind]);

  useEffect(() => {
    const versionId = selectedVersionId || current?.current_version_id || current?.versions?.[0]?.id;
    if (!versionId) {
      setPreview(null);
      return;
    }
    let mounted = true;
    previewContractVersion(versionId)
      .then((payload) => { if (mounted) setPreview(payload); })
      .catch(() => { if (mounted) setPreview(null); });
    return () => { mounted = false; };
  }, [selectedVersionId, current?.id, current?.current_version_id, current?.versions]);

  useEffect(() => {
    if (!revisedVersion?.id) {
      setRevisedPreview(null);
      return;
    }
    let mounted = true;
    previewContractVersion(revisedVersion.id)
      .then((payload) => { if (mounted) setRevisedPreview(payload); })
      .catch(() => { if (mounted) setRevisedPreview(null); });
    return () => { mounted = false; };
  }, [revisedVersion?.id]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const detail = await uploadContractReview(file, { contractType, reviewPerspective: perspective });
      setCurrent(detail);
      setSelectedVersionId(detail.current_version_id || detail.versions?.[0]?.id || '');
      setContracts((prev) => [detail, ...prev.filter((item) => item.id !== detail.id)]);
      message.success('合同已上传，建议立即执行 AI 审核');
    } catch (err: any) {
      message.error(err?.message || '上传失败');
    } finally {
      setUploading(false);
    }
    return false;
  };

  const handleReview = async () => {
    if (!current) return;
    setReviewing(true);
    try {
      const detail = await runContractReview(current.id, {
        contract_type: contractType,
        review_perspective: perspective,
        review_template: 'standard',
        focus: focus.split(/[，,\s]+/).map((x) => x.trim()).filter(Boolean),
      });
      setCurrent(detail);
      setContracts((prev) => [detail, ...prev.filter((item) => item.id !== detail.id)]);
      setSelectedVersionId(detail.current_version_id || detail.versions?.[0]?.id || '');
      message.success('AI 审核完成，已生成审查报告和 Word 修订稿');
    } catch (err: any) {
      message.error(err?.message || '审核失败');
    } finally {
      setReviewing(false);
    }
  };

  const handleSelectContract = async (doc: ContractReviewDocument) => {
    setLoading(true);
    try {
      const detail = await fetchContractReview(doc.id);
      setCurrent(detail);
      setContractType(detail.contract_type || 'general');
      setPerspective(detail.review_perspective || 'balanced');
      setSelectedVersionId(detail.current_version_id || detail.versions?.[0]?.id || '');
    } catch (err: any) {
      message.error(err?.message || '打开合同失败');
    } finally {
      setLoading(false);
    }
  };

  const removeLocateGuide = () => {
    locateGuideElRef.current?.remove();
    locateGuideElRef.current = null;
  };

  useEffect(() => () => {
    if (locateGuideTimerRef.current) window.clearTimeout(locateGuideTimerRef.current);
    removeLocateGuide();
  }, []);

  const showLocateGuide = (source: HTMLElement | null | undefined, target: HTMLElement | null | undefined) => {
    if (!source || !target) return;
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
    const sourceRect = source.getBoundingClientRect();
    const sourceVisible = sourceRect.bottom >= 0 && sourceRect.top <= window.innerHeight;
    const sourceFallbackRect = source.closest('.contract-right-panel')?.getBoundingClientRect();
    const sourceAnchor = sourceVisible ? sourceRect : (sourceFallbackRect || sourceRect);
    const targetRect = target.getBoundingClientRect();
    const targetFallbackRect = target.closest('.contract-preview-pane-original, .contract-preview-pane-revised')?.getBoundingClientRect();
    const targetAnchor = targetRect.bottom >= 0 && targetRect.top <= window.innerHeight ? targetRect : (targetFallbackRect || targetRect);
    const x1 = sourceAnchor.left + (sourceVisible ? sourceAnchor.width / 2 : 24);
    const y1 = clamp(sourceAnchor.top + sourceAnchor.height / 2, 70, window.innerHeight - 42);
    const x2 = targetAnchor.left + targetAnchor.width / 2;
    const y2 = clamp(targetAnchor.top + Math.min(targetAnchor.height / 2, 80), 70, window.innerHeight - 42);
    if (!Number.isFinite(x1 + y1 + x2 + y2)) return;
    removeLocateGuide();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const haloPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const sourceDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const targetDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const midX = (x1 + x2) / 2;
    const pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    svg.classList.add('contract-locate-guide');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', String(window.innerWidth));
    svg.setAttribute('height', String(window.innerHeight));
    svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    haloPath.setAttribute('d', pathD);
    haloPath.classList.add('guide-halo');
    path.setAttribute('d', pathD);
    path.classList.add('guide-line');
    sourceDot.setAttribute('cx', String(x1));
    sourceDot.setAttribute('cy', String(y1));
    sourceDot.setAttribute('r', '4');
    sourceDot.classList.add('guide-source');
    targetDot.setAttribute('cx', String(x2));
    targetDot.setAttribute('cy', String(y2));
    targetDot.setAttribute('r', '5');
    targetDot.classList.add('guide-target');
    svg.append(haloPath, path, sourceDot, targetDot);
    document.body.appendChild(svg);
    locateGuideElRef.current = svg;
    if (locateGuideTimerRef.current) window.clearTimeout(locateGuideTimerRef.current);
    locateGuideTimerRef.current = window.setTimeout(removeLocateGuide, 3600);
  };

  const scrollTargetIntoPane = (target: HTMLElement) => {
    const pane = target.closest<HTMLElement>('.contract-preview-pane-original, .contract-preview-pane-revised');
    if (!pane) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const paneRect = pane.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = pane.scrollTop + (targetRect.top - paneRect.top) - (pane.clientHeight / 2) + (targetRect.height / 2);
    pane.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
  };

  const pulseTargets = (targets: HTMLElement[], sourceElement?: HTMLElement | null) => {
    const markTargets = () => {
      targets.forEach((target) => {
        target.classList.add('is-pulsing');
        window.setTimeout(() => target.classList.remove('is-pulsing'), 1600);
      });
    };
    targets.forEach((target) => {
      scrollTargetIntoPane(target);
    });
    markTargets();
    window.setTimeout(markTargets, 80);
    if (sourceElement && targets.length > 0) {
      const target = targets[targets.length - 1];
      window.setTimeout(() => {
        showLocateGuide(sourceElement, target);
        window.setTimeout(markTargets, 0);
      }, 650);
    }
  };

  const findBlocksByText = (needles: string[]) => {
    const revisedPane = previewShellRef.current?.querySelector<HTMLElement>('.contract-preview-pane-revised');
    if (!revisedPane) return [];
    const terms = needles
      .map((item) => String(item || '').replace(/^建议新增条款：|^建议增加：|^建议修订：/, '').trim())
      .filter((item) => item.length >= 6);
    if (terms.length === 0) return [];
    return Array.from(revisedPane.querySelectorAll<HTMLElement>('.docx-preview-block, .contract-paragraph'))
      .filter((node) => {
        const text = node.textContent || '';
        return terms.some((term) => text.includes(term.slice(0, Math.min(term.length, 48))));
      });
  };

  const locateIssueCore = (issue: ContractReviewIssue, sourceElement?: HTMLElement | null) => {
    if (issue.paragraph_index != null) {
      const index = String(issue.paragraph_index);
      const domTargets = Array.from(previewShellRef.current?.querySelectorAll<HTMLElement>(
        `.docx-preview-block[data-index="${index}"], .contract-paragraph[data-index="${index}"]`,
      ) || []);
      const fallback = paragraphRefs.current[issue.paragraph_index];
      const targets = fallback && !domTargets.includes(fallback) ? [...domTargets, fallback] : domTargets;
      if (targets.length > 0) {
        pulseTargets(targets, sourceElement);
        if (targets.length > 1) message.success('已同步定位原始合同和修订稿中的对应位置');
        return;
      }
      message.warning('当前预览未找到对应段落，请确认版本预览已加载完成');
      return;
    }

    if (issue.status === 'accepted' && revisedVersion?.id) {
      const targets = findBlocksByText([issue.proposed_revision, issue.title]);
      if (targets.length > 0) {
        pulseTargets(targets, sourceElement);
        message.success('已定位到修订稿中写入的补充条款');
        return;
      }
      setSelectedVersionId(revisedVersion.id);
      message.info('这条建议已采纳，请稍等修订稿预览加载后再次定位');
      return;
    }

    message.info('这条建议是全文缺失项，采纳后会写入 Word 修订建议版并支持定位');
  };

  const locateIssue = (issue: ContractReviewIssue, sourceElement?: HTMLElement | null) => {
    if (docPreviewMode === 'original') {
      pendingLocateRef.current = issue;
      pendingLocateSourceRef.current = sourceElement || null;
      setDocPreviewMode('review');
      if (selectedVersion?.kind === 'report' && (revisedVersion?.id || originalVersion?.id)) {
        setSelectedVersionId(revisedVersion?.id || originalVersion?.id || '');
      }
      message.info('正在切回审查定位模式并定位该建议');
      return;
    }
    if (selectedVersion?.kind === 'report' && (revisedVersion?.id || originalVersion?.id)) {
      pendingLocateRef.current = issue;
      pendingLocateSourceRef.current = sourceElement || null;
      setSelectedVersionId(revisedVersion?.id || originalVersion?.id || '');
      message.info('正在切回合同双屏预览并定位该建议');
      return;
    }
    locateIssueCore(issue, sourceElement);
  };

  useEffect(() => {
    if (!pendingLocateRef.current || selectedVersion?.kind === 'report' || docPreviewMode !== 'review') return;
    const timer = window.setTimeout(() => {
      const issue = pendingLocateRef.current;
      pendingLocateRef.current = null;
      const source = pendingLocateSourceRef.current;
      pendingLocateSourceRef.current = null;
      if (issue) locateIssueCore(issue, source);
    }, 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVersion?.kind, selectedVersionId, revisedPreview, preview, docPreviewMode]);

  const updateIssueStatus = async (issue: ContractReviewIssue, status: 'accepted' | 'ignored' | 'open') => {
    try {
      const updated = await patchContractIssue(issue.id, status);
      setCurrent((prev) => prev ? {
        ...prev,
        issues: (prev.issues || []).map((item) => item.id === updated.id ? updated : item),
      } : prev);
      if (current?.id) {
        setRegenerating(true);
        const detail = await regenerateContractDeliverables(current.id);
        setCurrent(detail);
        setContracts((prev) => [detail, ...prev.filter((item) => item.id !== detail.id)]);
        const nextRevised = detail.versions?.find((v) => v.kind === 'revised');
        setSelectedVersionId(nextRevised?.id || detail.current_version_id || detail.versions?.[0]?.id || '');
        const statusText = status === 'accepted'
          ? '已采纳，并写入 Word 批注修订版'
          : status === 'ignored'
            ? '已忽略，并从 Word 批注修订版移除'
            : '已恢复待处理，并同步更新交付物';
        message.success(statusText);
      }
    } catch (err: any) {
      message.error(err?.message || '更新建议状态失败');
    } finally {
      setRegenerating(false);
    }
  };

  const handleRegenerateDeliverables = async () => {
    if (!current) return;
    setRegenerating(true);
    try {
      const detail = await regenerateContractDeliverables(current.id);
      setCurrent(detail);
      setContracts((prev) => [detail, ...prev.filter((item) => item.id !== detail.id)]);
      setSelectedVersionId(detail.current_version_id || detail.versions?.[0]?.id || '');
      message.success('已根据当前建议状态重新生成报告和 Word 批注版');
    } catch (err: any) {
      message.error(err?.message || '重新生成失败');
    } finally {
      setRegenerating(false);
    }
  };

  const renderPreviewContent = (payload: any, mode: 'single' | 'revised' = 'single') => {
    if (!payload?.content) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={payload?.preview_kind === 'pdf_text' ? 'PDF 深度解析将在后续版本支持，请先上传 DOCX 体验完整审查' : '暂无可预览正文'}
        />
      );
    }
    if (payload?.preview_kind === 'docx_html') {
      const safeHtml = DOMPurify.sanitize(String(payload.content || ''), {
        ADD_ATTR: ['data-index', 'style'],
      });
      return (
        <div
          className={`contract-preview-docx ${mode === 'revised' ? 'is-revised' : ''}`}
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      );
    }
    const paragraphs = String(payload.content).split(/\n+/).map((line) => line.trim()).filter(Boolean);
    return (
      <div className={`contract-preview-text ${mode === 'revised' ? 'is-revised' : ''}`}>
        {paragraphs.map((line, index) => (
          <div
            key={`${mode}-${index}`}
            ref={(node) => {
              if (mode === 'single') paragraphRefs.current[index + 1] = node;
            }}
            className="contract-paragraph"
            data-index={index + 1}
          >
            <span className="contract-paragraph-index">{index + 1}</span>
            <p>{line}</p>
          </div>
        ))}
      </div>
    );
  };

  const renderReportPreview = (payload: any) => {
    const content = String(payload?.content || '');
    if (!content) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可预览的审核报告" />;
    }
    return (
      <div className="contract-report-preview">
        <MarkdownRenderer content={content} />
      </div>
    );
  };

  const renderOriginalStylePreview = () => {
    const payload = selectedVersion?.kind === 'revised'
      ? (revisedPreview || preview)
      : selectedVersion?.kind === 'original'
        ? (current?.source_preview || preview)
        : (preview || current?.source_preview);
    if (!payload) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可预览版本" />;
    }
    return (
      <div className="contract-original-preview-host">
        <ArtifactPreviewContent preview={payload} />
      </div>
    );
  };

  return (
    <div className={`contract-review-page ${leftCollapsed ? 'contract-left-collapsed' : ''}`}>
      <aside className="contract-left-panel">
        <div className="contract-panel-header">
          <div className="contract-left-title">
            <h2>合同智能审核</h2>
          </div>
          <div className="contract-left-actions">
            <Tooltip title={leftCollapsed ? '展开合同侧栏' : '收起合同侧栏'}>
              <Button
                icon={leftCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setLeftCollapsed((value) => !value)}
                aria-label={leftCollapsed ? '展开合同侧栏' : '收起合同侧栏'}
              />
            </Tooltip>
            <Tooltip title="刷新列表">
              <Button className="contract-refresh-button" icon={<ReloadOutlined />} onClick={loadContracts} loading={loading} />
            </Tooltip>
          </div>
        </div>

        <div className="contract-left-content">
          <div className="contract-upload-box">
            <Upload
              accept=".docx,.pdf"
              maxCount={1}
              showUploadList={false}
              beforeUpload={(file) => {
                handleUpload(file);
                return false;
              }}
            >
              <Button type="primary" icon={<UploadOutlined />} loading={uploading} block>
                上传合同
              </Button>
            </Upload>
            <p>支持 DOCX / PDF，单文件不超过 10MB。当前优先支持 DOCX 深度解析与 Word 修订稿。</p>
          </div>

          <div className="contract-controls">
            <label>合同类型</label>
            <Select value={contractType} options={CONTRACT_TYPES} onChange={setContractType} />
            <label>审查视角</label>
            <Select value={perspective} options={PERSPECTIVES} onChange={setPerspective} />
            <label>重点关注</label>
            <Input
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="如 付款、违约、知识产权"
            />
            <Button
              type="primary"
              icon={<SafetyCertificateOutlined />}
              disabled={!current}
              loading={reviewing}
              onClick={handleReview}
            >
              AI 审核
            </Button>
          </div>

          <div className="contract-list">
            <div className="contract-section-title">合同文件</div>
            {contracts.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无合同" />}
            {contracts.map((doc) => (
              <button
                key={doc.id}
                className={`contract-list-item ${current?.id === doc.id ? 'active' : ''}`}
                onClick={() => handleSelectContract(doc)}
              >
                <FileProtectOutlined />
                <span>
                  <strong>{doc.title}</strong>
                  <em>{doc.status} · {doc.issue_count || 0} 条建议</em>
                </span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="contract-main-panel">
        {!current ? (
          <div className="contract-empty-state">
            <FileDoneOutlined />
            <h2>上传一份合同开始审核</h2>
            <p>Atlas 会解析合同正文，生成结构化风险建议、审查报告和 Word 修订建议版。</p>
          </div>
        ) : (
          <>
            <div className="contract-doc-toolbar">
              <div>
                <h1>{current.title}</h1>
                <span>{current.summary}</span>
              </div>
              <div className="contract-toolbar-actions">
                <Select
                  className="contract-version-select"
                  value={selectedVersionId || undefined}
                  placeholder="选择版本"
                  onChange={setSelectedVersionId}
                  options={versions.map((v) => ({ value: v.id, label: `${versionLabel(v)} · v${v.version_no}` }))}
                />
                {selectedVersionId && (
                  <Button
                    className="contract-download-button"
                    icon={<DownloadOutlined />}
                    onClick={() => {
                      const version = versions.find((v) => v.id === selectedVersionId);
                      if (version) downloadVersion(version).catch((err) => message.error(err?.message || '下载失败'));
                    }}
                  >
                    下载
                  </Button>
                )}
                {selectedVersion?.kind !== 'report' && (
                  <Segmented
                    size="small"
                    value={docPreviewMode}
                    onChange={(value) => setDocPreviewMode(value as 'review' | 'original')}
                    options={[
                      { label: '审查定位', value: 'review' },
                      { label: '原版预览', value: 'original' },
                    ]}
                  />
                )}
              </div>
            </div>

            {current.status === 'pdf_uploaded' && (
              <Alert
                type="info"
                showIcon
                message="PDF 已上传，但本阶段暂不做 PDF 深度解析"
                description="你可以下载原文件留档；完整 AI 审核建议先使用 DOCX 合同体验。"
              />
            )}

            <div className="contract-version-strip">
              {visibleVersions.map((version) => (
                <button
                  key={version.id}
                  className={`contract-version-chip ${selectedVersionId === version.id ? 'active' : ''}`}
                  onClick={() => setSelectedVersionId(version.id)}
                >
                  <FileTextOutlined />
                  <span>{versionLabel(version)}</span>
                  <em>{formatSize(version.size)}</em>
                </button>
              ))}
            </div>

            <div className="contract-preview-shell" ref={previewShellRef}>
              {reviewing || loading ? (
                <div className="contract-loading"><Spin /> 正在处理合同...</div>
              ) : selectedVersion?.kind === 'report' ? (
                renderReportPreview(preview)
              ) : docPreviewMode === 'original' ? (
                renderOriginalStylePreview()
              ) : revisedVersion && originalVersion ? (
                <div className="contract-dual-preview">
                  <section className="contract-preview-pane-original">
                    <header><FolderOpenOutlined /> 原始合同</header>
                    {renderPreviewContent(current.source_preview || preview, 'single')}
                  </section>
                  <section className="contract-preview-pane-revised">
                    <header><SplitCellsOutlined /> AI 批注修订建议版</header>
                    {renderPreviewContent(revisedPreview || (selectedVersionId === revisedVersion.id ? preview : null), 'revised')}
                  </section>
                </div>
              ) : (
                renderPreviewContent(preview, 'single')
              )}
            </div>
          </>
        )}
      </main>

      <aside className="contract-right-panel">
        <div className="contract-panel-header compact">
          <div>
            <h2>审查建议</h2>
          </div>
          <Tag color="blue">{issues.length} 条</Tag>
        </div>
        {current && issues.length > 0 && (
          <Button
            type="primary"
            block
            loading={regenerating}
            onClick={handleRegenerateDeliverables}
          >
            按当前建议重新生成交付物
          </Button>
        )}
        {reportVersion && (
          <Button
            icon={<FileTextOutlined />}
            block
            onClick={() => setSelectedVersionId(reportVersion.id)}
          >
            在线预览审核报告
          </Button>
        )}
        {reportVersion && (
          <Button
            icon={<DownloadOutlined />}
            block
            onClick={() => downloadVersion(reportVersion).catch((err) => message.error(err?.message || '下载失败'))}
          >
            下载审查报告
          </Button>
        )}
        {revisedVersion && (
          <Button
            icon={<DownloadOutlined />}
            block
            onClick={() => downloadVersion(revisedVersion).catch((err) => message.error(err?.message || '下载失败'))}
          >
            下载 Word 批注版
          </Button>
        )}
        <div className="contract-issue-list">
          {issues.length === 0 && (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无审查建议，上传 DOCX 后点击 AI 审核" />
          )}
          {issues.map((issue) => (
            <article key={issue.id} className={`contract-issue-card severity-${issue.severity} status-${issue.status}`}>
              <button
                className="contract-issue-main"
                title={`定位到合同位置：${issue.title}`}
                aria-label={`定位到合同位置：${issue.title}`}
                onClick={(event: MouseEvent<HTMLButtonElement>) => locateIssue(issue, event.currentTarget)}
              >
                <div className="contract-issue-title-row">
                  <Tag color={issue.severity === 'high' ? 'red' : issue.severity === 'medium' ? 'orange' : 'green'}>
                    {severityLabel[issue.severity] || issue.severity}
                  </Tag>
                  <Tag color={issue.status === 'accepted' ? 'green' : issue.status === 'ignored' ? 'default' : 'blue'}>
                    {issueStatusLabel[issue.status] || issue.status}
                  </Tag>
                  <span>{issue.category}</span>
                </div>
                <h3>{issue.title}</h3>
                <p>{issue.risk}</p>
                <em>{issue.clause_ref}</em>
              </button>
              <div className="contract-issue-detail">
                {issue.excerpt && <blockquote>{issue.excerpt}</blockquote>}
                <strong>建议</strong>
                <p>{issue.recommendation}</p>
                <strong>拟修订</strong>
                <p>{issue.proposed_revision}</p>
              </div>
              <div className="contract-issue-actions">
                <Button
                  size="small"
                  title={`定位到合同位置：${issue.title}`}
                  aria-label={`定位到合同位置：${issue.title}`}
                  onClick={(event: MouseEvent<HTMLElement>) => locateIssue(issue, event.currentTarget)}
                >
                  定位
                </Button>
                <Button size="small" icon={<CheckCircleOutlined />} onClick={() => updateIssueStatus(issue, 'accepted')}>采纳</Button>
                <Button size="small" onClick={() => updateIssueStatus(issue, 'ignored')}>忽略</Button>
              </div>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}
