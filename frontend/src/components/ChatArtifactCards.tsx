import { useMemo, useState } from 'react';
import { Button, Dropdown, message } from 'antd';
import type { MenuProps } from 'antd';
import {
  DownOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileExcelOutlined,
  FileMarkdownOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileUnknownOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import ArtifactPreviewDrawer from './ArtifactPreviewDrawer';
import ArtifactPreviewContent from './ArtifactPreviewContent';
import { downloadProtectedFile, previewArtifact, type FilePreviewPayload } from '../services/api';

interface Props {
  artifacts?: any[];
}

export default function ChatArtifactCards({ artifacts = [] }: Props) {
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const visibleArtifacts = useMemo(
    () => artifacts.filter((item) => item && item.managed_status !== 'archived').slice(0, 8),
    [artifacts],
  );

  if (visibleArtifacts.length === 0) return null;

  const openPreview = async (artifact: any) => {
    const artifactId = artifactIdOf(artifact);
    if (!artifactId) {
      message.warning('这个交付物还没有可打开的文件 ID');
      return;
    }
    setLoadingId(artifactId);
    try {
      const payload = await previewArtifact(artifactId);
      setPreview(payload);
    } catch (ex: any) {
      message.error(`预览失败: ${ex?.message || ex}`);
    } finally {
      setLoadingId(null);
    }
  };

  const download = async (artifact: any) => {
    const artifactId = artifactIdOf(artifact);
    if (!artifactId) {
      message.warning('这个交付物还没有可下载的文件 ID');
      return;
    }
    setLoadingId(artifactId);
    try {
      const url = artifact.download_url || `/api/artifacts/${encodeURIComponent(artifactId)}/download`;
      await downloadProtectedFile(url, artifact.name || artifact.title || 'openatlas-artifact');
    } catch (ex: any) {
      message.error(`下载失败: ${ex?.message || ex}`);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <>
      <div className="chat-artifact-list" aria-label="本轮生成的交付物">
        {visibleArtifacts.map((artifact) => {
          const artifactId = artifactIdOf(artifact);
          const items: MenuProps['items'] = [
            { key: 'preview', icon: <EyeOutlined />, label: '在线预览' },
            { key: 'download', icon: <DownloadOutlined />, label: '下载到本地' },
          ];
          return (
            <div key={artifactId || `${artifact.name}-${artifact.created_at || ''}`} className="chat-artifact-card">
              <div className={`chat-artifact-card__icon chat-artifact-card__icon--${kindClass(artifact)}`}>
                {iconForArtifact(artifact)}
              </div>
              <button
                type="button"
                className="chat-artifact-card__main"
                onClick={() => void openPreview(artifact)}
                disabled={loadingId === artifactId}
                title={artifact.name || artifact.title || '交付物'}
              >
                <span className="chat-artifact-card__name">{artifact.name || artifact.title || '未命名交付物'}</span>
                <span className="chat-artifact-card__meta">{artifactMeta(artifact)}</span>
              </button>
              <Dropdown
                trigger={['click']}
                menu={{
                  items,
                  onClick: ({ key }) => {
                    if (key === 'preview') void openPreview(artifact);
                    if (key === 'download') void download(artifact);
                  },
                }}
              >
                <Button className="chat-artifact-card__action" loading={loadingId === artifactId}>
                  打开方式 <DownOutlined />
                </Button>
              </Dropdown>
            </div>
          );
        })}
      </div>

      <ArtifactPreviewDrawer
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview ? `${preview.name} · 在线预览` : '交付物预览'}
      >
        {preview && <ChatArtifactPreview preview={preview} />}
      </ArtifactPreviewDrawer>
    </>
  );
}

function ChatArtifactPreview({ preview }: { preview: FilePreviewPayload }) {
  return <ArtifactPreviewContent preview={preview} />;
}

function artifactIdOf(artifact: any): string {
  return String(artifact?.__id || artifact?.id || '').trim();
}

function artifactMeta(artifact: any): string {
  const type = typeLabel(artifact);
  const size = Number(artifact.storage_size || artifact.size || 0);
  const parts = [type];
  if (size > 0) parts.push(formatBytes(size));
  if (artifact.status && !['ready', 'active', 'generated'].includes(String(artifact.status))) {
    parts.push(statusLabel(artifact.status));
  }
  return parts.join(' · ');
}

function typeLabel(artifact: any): string {
  const name = String(artifact?.name || artifact?.title || '').toLowerCase();
  const kind = String(artifact?.kind || artifact?.preview_kind || artifact?.mime_type || '').toLowerCase();
  if (kind.includes('html') || /\.html?$/.test(name)) return '网页';
  if (kind.includes('markdown') || /\.md$/.test(name)) return '文档 · MD';
  if (kind.includes('pdf') || /\.pdf$/.test(name)) return '文档 · PDF';
  if (kind.includes('csv') || /\.csv$/.test(name)) return '表格 · CSV';
  if (kind.includes('excel') || /\.xlsx?$/.test(name)) return '表格';
  if (kind.includes('json') || /\.json$/.test(name)) return '数据 · JSON';
  if (kind.includes('image') || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) return '图片';
  return '交付物';
}

function kindClass(artifact: any): string {
  const label = typeLabel(artifact);
  if (label.includes('网页')) return 'html';
  if (label.includes('MD')) return 'markdown';
  if (label.includes('PDF')) return 'pdf';
  if (label.includes('表格')) return 'sheet';
  return 'file';
}

function iconForArtifact(artifact: any) {
  const label = typeLabel(artifact);
  if (label.includes('网页')) return <GlobalOutlined />;
  if (label.includes('MD')) return <FileMarkdownOutlined />;
  if (label.includes('PDF')) return <FilePdfOutlined />;
  if (label.includes('表格')) return <FileExcelOutlined />;
  if (label.includes('交付物')) return <FileTextOutlined />;
  return <FileUnknownOutlined />;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    ready: '可用',
    generated: '已生成',
    archived: '已归档',
    failed: '失败',
    pending: '生成中',
  };
  return map[status] || status;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}
