import { useState, useEffect } from 'react';
import { Table } from 'antd';
import { BookOutlined } from '@ant-design/icons';
import type { KnowledgeBase } from '../services/api';
import { fetchKnowledgeBases } from '../services/api';

export default function Knowledge() {
  const [data, setData] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchKnowledgeBases()
      .then((res) => setData(res))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: '32px 48px 64px' }}>
      <h1 style={{
        fontSize: 28, fontWeight: 700, color: 'var(--text-primary)',
        letterSpacing: '-0.02em', margin: 0, lineHeight: 1.2,
      }}>知识库</h1>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '6px 0 24px' }}>
        已接入 {data.filter((k) => k.status === '已接入').length} 个知识库 · 支持向量检索与全文索引
      </p>

      <Table
        dataSource={data}
        rowKey="id"
        loading={loading}
        pagination={false}
        columns={[
          {
            title: '知识库名称', dataIndex: 'name',
            render: (t: string) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 6,
                  background: 'var(--accent-soft)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--accent)',
                }}>
                  <BookOutlined />
                </div>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{t}</span>
              </div>
            ),
          },
          { title: '文档类型', dataIndex: 'type', render: (t: string) => <span style={{ color: 'var(--text-secondary)' }}>{t}</span> },
          {
            title: '文档数量', dataIndex: 'doc_count',
            render: (n: number) => <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{n.toLocaleString()}</span>,
          },
          { title: '存储大小', dataIndex: 'size', render: (t: string) => <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{t}</span> },
          {
            title: '状态', dataIndex: 'status',
            render: (status: string) => (
              <span className={`atlas-chip ${status === '已接入' ? 'atlas-chip--success' : 'atlas-chip--warning'}`}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: status === '已接入' ? 'var(--color-success)' : 'var(--color-warning)',
                }} />
                {status}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
