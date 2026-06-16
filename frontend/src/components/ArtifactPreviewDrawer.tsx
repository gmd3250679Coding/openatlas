/**
 * ArtifactPreviewDrawer — 右侧滑出全屏预览 (P3.12 3.4.4)
 *
 * 不依赖 streamdown 的 fullscreen 按钮 (流式浮控件 + 浏览器 API 限制),
 * 自己实现 Ant Design Drawer 50% 宽 / 移动全屏.
 *
 * Props:
 *   open      - 是否打开
 *   onClose   - 关闭回调
 *   title     - 顶部标题 (例如 "HTML 预览" / "Mermaid 流程图")
 *   children  - 实际预览内容 (一般是原始的 Mermaid SVG / HTML iframe / Sandpack)
 */
import { Drawer } from 'antd';
import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export default function ArtifactPreviewDrawer({ open, onClose, title, children }: Props) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      placement="right"
      width="50%"
      size="default"
      styles={{
        body: { padding: 0, background: 'var(--bg-elevated, #fafafa)' },
        header: { padding: '12px 20px', borderBottom: '1px solid var(--border, #e5e7eb)' },
      }}
      // 移动端全屏
      rootClassName="artifact-preview-drawer"
      destroyOnHidden={false}
    >
      <div className="artifact-preview-body" style={{ height: '100%', overflow: 'auto', padding: 20 }}>
        {children}
      </div>
    </Drawer>
  );
}
