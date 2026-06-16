/**
 * ArtifactCard — 统一容器 (P3.12 3.4.4)
 *
 * 把 HTML / Code / Mermaid / React artifact 装进统一壳, 头部右上角放按钮
 * (View 全屏预览 → 触发 ArtifactPreviewDrawer), 避免 streamdown 内部控件
 * 把按钮浮在左侧/破坏布局.
 *
 * 用法 (StreamRenderer 内部):
 *   <ArtifactCard kind="mermaid" title="Mermaid 流程图" onView={() => setOpen(true)}>
 *     <MermaidBlock code={code} isStreaming={false} />
 *   </ArtifactCard>
 *
 * 行为:
 *   - 顶部 header 24px 玻璃态, 类型标签 (12px chip) + 标题 (14px) + View 按钮
 *   - 内容区域 (children) 自带滚动/高亮
 *   - 不重复实现 Copy/Download — 留给孩子组件 (CodeHighlighter/MermaidBlock 各自)
 *   - 不会因为流式出现-消失-再出现导致按钮抖动
 */
import { Button, Tooltip } from 'antd';
import { FullscreenOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

export type ArtifactKind = 'code' | 'mermaid' | 'html' | 'markdown' | 'react' | 'svg';

interface Props {
  kind: ArtifactKind;
  title?: string;
  onView?: () => void;
  children: ReactNode;
}

const kindLabel: Record<ArtifactKind, { label: string; tone: string }> = {
  code: { label: '代码', tone: '#1f6feb' },
  mermaid: { label: '图表', tone: '#8b5cf6' },
  html: { label: 'HTML', tone: '#f97316' },
  markdown: { label: 'Markdown', tone: '#2563eb' },
  react: { label: 'React', tone: '#06b6d4' },
  svg: { label: 'SVG', tone: '#22c55e' },
};

export default function ArtifactCard({ kind, title, onView, children }: Props) {
  const meta = kindLabel[kind] || kindLabel.code;
  return (
    <div className={`artifact-card artifact-card-${kind}`}>
      <div className="artifact-card-header">
        <div className="artifact-card-header-left">
          <span className="artifact-card-kind" style={{ background: meta.tone }}>{meta.label}</span>
          {title && <span className="artifact-card-title">{title}</span>}
        </div>
        <div className="artifact-card-header-right">
          {onView && (
            <Tooltip title="右侧全屏预览" mouseEnterDelay={0.4}>
              <Button
                type="text"
                size="small"
                icon={<FullscreenOutlined />}
                onClick={onView}
                className="artifact-card-view-btn"
              />
            </Tooltip>
          )}
        </div>
      </div>
      <div className="artifact-card-body">{children}</div>
    </div>
  );
}
