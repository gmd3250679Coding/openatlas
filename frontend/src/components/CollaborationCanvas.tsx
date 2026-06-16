/**
 * CollaborationCanvas — M4.3 协作画布 + M4.4 双模联动桥
 * React Flow + ELK DAG 自动布局,展示多 Agent 接力/并行的可视化拓扑。
 * 节点状态:idle / thinking / running / done / error 5 类
 *   (与 M4.1 SSE 7 类事件对应:meta/token/tool/done/error + agent_join/leave/thinking)
 *
 * 范围(M4.3):
 *   - 浮动按钮 + 全屏 Modal 容器
 *   - 1 个 user 节点 + 2-3 个 employee 节点的 demo 拓扑
 *   - ELK.js 自动布局(分层有向图)
 *   - 节点状态 5 类视觉 + 切换 demo
 *   - 玻璃态 4 层 modal 风格,沿用 M3.5 motion token
 *
 * 范围(M4.4 增量):
 *   - forwardRef 暴露 focusNode / blurAll API 给 CommandCenter
 *   - useEffect 注册到 canvasApi (群聊 click → 画布节点 pulse 3s)
 *   - 全节点 done → emitAllDone → CommandCenter 收 system summary 消息
 *
 * 范围(M4.5.1 增量):
 *   - props.conversationId + initialCanvasState 入参 (CommandCenter 注入)
 *   - 打开时若有 initialCanvasState → setNodes/setEdges 恢复
 *   - nodes/edges 变化 → debounce 500ms 调 patchCanvasState(conversationId, ...)
 *   - onBeforeUnload flush pending debounce (防丢未保存)
 */
import { useEffect, useState, useCallback, useImperativeHandle, forwardRef, useRef, useMemo, type CSSProperties, type ReactNode } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  type Node,
  type Edge,
  type NodeProps,
  type NodeChange,
  type EdgeChange,
  type Connection,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { Modal, Button, Input, message } from 'antd';
import { ApartmentOutlined, CloseOutlined, ReloadOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { canvasApi } from '../services/canvasApi';
import { fetchEmployees, patchCanvasState, getCanvasState, logCanvasEvent, saveSessionTemplate, type Employee } from '../services/api';

// ─── 节点状态机 ───
type AgentStatus = 'idle' | 'thinking' | 'running' | 'done' | 'error';

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: '#8B8FA3',
  thinking: '#8B7FE8',     // --accent
  running: '#3B82F6',     // blue
  done: '#10B981',        // green
  error: '#EF4444',       // red
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: '待命',
  thinking: '思考中',
  running: '执行中',
  done: '完成',
  error: '失败',
};

interface AgentNodeData extends Record<string, unknown> {
  label: string;
  role: 'user' | 'employee';
  status: AgentStatus;
  avatar?: string;
  detail?: string;
  employeeId?: string;
  executionMode?: 'relay' | 'parallel' | 'single';
  outputType?: string;
  defaultPrompt?: string;
  skills?: string[];
  failureStrategy?: 'continue_with_next_employee' | 'stop_on_error';
}

// ─── 自定义节点 ───
function AgentNode({ data, selected }: NodeProps<Node<AgentNodeData>>) {
  const d = data as AgentNodeData;
  const isUser = d.role === 'user';
  const accent = isUser ? '#8B7FE8' : STATUS_COLOR[d.status];
  const bg = isUser ? 'var(--accent-soft)' : 'var(--bg-elevated)';

  return (
    <div
      style={{
        background: bg,
        border: `2px solid ${selected ? accent : isUser ? 'transparent' : 'var(--border-subtle)'}`,
        borderRadius: 14,
        padding: '12px 16px',
        minWidth: 180,
        boxShadow: selected
          ? `0 0 0 4px rgba(139,127,232,0.12), 0 8px 24px rgba(0,0,0,0.08)`
          : '0 2px 8px rgba(0,0,0,0.04)',
        transition: 'all var(--motion-base) var(--motion-ease)',
        fontFamily: 'var(--font-sans)',
        position: 'relative',
        opacity: d.status === 'idle' ? 0.7 : 1,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: accent, width: 8, height: 8, border: '2px solid white' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 32, height: 32, borderRadius: '50%',
            background: isUser ? 'var(--accent)' : '#4F46E5',
            color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700,
          }}
        >
          {d.avatar || (isUser ? 'U' : d.label.charAt(0))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {d.label}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
            {d.detail || (isUser ? '发起任务' : '协作 Agent')}
          </div>
        </div>
      </div>
      <div
        style={{
          position: 'absolute', top: 8, right: 8,
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', borderRadius: 10,
          background: `${STATUS_COLOR[d.status]}20`,
          color: STATUS_COLOR[d.status],
          fontSize: 10, fontWeight: 600,
        }}
      >
        <span
          style={{
            width: 5, height: 5, borderRadius: '50%',
            background: STATUS_COLOR[d.status],
            animation: d.status === 'thinking' || d.status === 'running'
              ? 'pulse 1.2s ease-in-out infinite'
              : 'none',
          }}
        />
        {STATUS_LABEL[d.status]}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: accent, width: 8, height: 8, border: '2px solid white' }}
      />
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

// ─── 初始 demo 拓扑:user → [法务智囊 → 财务精灵] 接力 ───
const INITIAL_NODES: Node<AgentNodeData>[] = [
  {
    id: 'user',
    type: 'agent',
    position: { x: 0, y: 0 },
    data: { label: '用户', role: 'user', status: 'done', avatar: 'U', detail: '发起任务' },
  },
  {
    id: 'emp-1',
    type: 'agent',
    position: { x: 0, y: 0 },
    data: { label: '法务智囊', role: 'employee', status: 'done', detail: 'ID 1 · 法务部' },
  },
  {
    id: 'emp-2',
    type: 'agent',
    position: { x: 0, y: 0 },
    data: { label: '财务精灵', role: 'employee', status: 'done', detail: 'ID 2 · 财务部' },
  },
];

const INITIAL_EDGES: Edge[] = [
  { id: 'e-u1', source: 'user', target: 'emp-1', animated: false, style: { stroke: '#8B8FA3' } },
  { id: 'e-u2', source: 'user', target: 'emp-2', animated: false, style: { stroke: '#8B8FA3' } },
  { id: 'e-12', source: 'emp-1', target: 'emp-2', animated: false, style: { stroke: '#8B8FA3' } },
];

function normalizeCanvasState(
  rawNodes: Array<Record<string, unknown>>,
  rawEdges: Array<Record<string, unknown>>,
): { nodes: Node<AgentNodeData>[]; edges: Edge[] } {
  const nodes: Node<AgentNodeData>[] = rawNodes.map((raw, index) => {
    const data = (raw.data && typeof raw.data === 'object' ? raw.data : {}) as Record<string, unknown>;
    const id = String(raw.id || `node-${index + 1}`);
    const pos = (raw.position && typeof raw.position === 'object' ? raw.position : {}) as Record<string, unknown>;
    const role = data.role === 'user' || raw.type === 'user' ? 'user' : 'employee';
    const label = String(data.label || raw.label || raw.employeeName || raw.name || (role === 'user' ? '用户' : id));
    const employeeId = raw.employeeId || data.employeeId;
    return {
      id,
      type: 'agent',
      position: {
        x: typeof pos.x === 'number' ? pos.x : index * 260,
        y: typeof pos.y === 'number' ? pos.y : index * 90,
      },
      data: {
        label,
        role,
        status: (['idle', 'thinking', 'running', 'done', 'error'].includes(String(data.status || raw.status))
          ? String(data.status || raw.status)
          : role === 'user' ? 'done' : 'idle') as AgentStatus,
        avatar: String(data.avatar || raw.avatar || label.charAt(0)),
        employeeId: employeeId ? String(employeeId) : undefined,
        detail: String(data.detail || raw.detail || (employeeId ? `ID ${employeeId}` : role === 'user' ? '发起任务' : '协作 Agent')),
        executionMode: (data.executionMode || data.execution_mode || 'relay') as AgentNodeData['executionMode'],
        outputType: String(data.outputType || data.output_type || 'markdown'),
        defaultPrompt: String(data.defaultPrompt || data.default_prompt || ''),
        skills: Array.isArray(data.skills) ? data.skills.map(String) : [],
        failureStrategy: (data.failureStrategy || data.failure_strategy || 'continue_with_next_employee') as AgentNodeData['failureStrategy'],
      },
    };
  });
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = rawEdges
    .map((raw, index) => ({
      id: String(raw.id || `edge-${index + 1}`),
      source: String(raw.source || ''),
      target: String(raw.target || ''),
      animated: Boolean(raw.animated),
      style: (raw.style && typeof raw.style === 'object') ? raw.style as Edge['style'] : { stroke: '#8B8FA3' },
    }))
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  return { nodes, edges };
}

function isDemoCanvasState(nodes: Node<AgentNodeData>[], edges: Edge[]) {
  const labels = new Set(nodes.map((node) => String(node.data?.label || '')));
  const ids = new Set(nodes.map((node) => node.id));
  return (
    nodes.length === 3 &&
    edges.length === 3 &&
    ids.has('user') &&
    ids.has('emp-1') &&
    ids.has('emp-2') &&
    labels.has('法务智囊') &&
    labels.has('财务精灵')
  );
}

// ─── ELK 自动布局 ───
async function layoutWithElk(
  nodes: Node<AgentNodeData>[],
  edges: Edge[]
): Promise<Node<AgentNodeData>[]> {
  const elk = new ELK();
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.spacing.nodeNode': '40',
    },
    children: nodes.map((n) => ({ id: n.id, width: 220, height: 80 })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const layout = await elk.layout(graph);
  const positioned = new Map<string, { x: number; y: number }>();
  layout.children?.forEach((c) => {
    positioned.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
  });
  return nodes.map((n) => {
    const pos = positioned.get(n.id);
    return pos ? { ...n, position: pos } : n;
  });
}

// ─── 主组件 ───
interface Props {
  open: boolean;
  onClose: () => void;
  // M4.5.1: 由 CommandCenter 注入,debounce 调 patchCanvasState
  conversationId?: number | string | null;
  // M4.5.1: 打开时用服务端 canvas_state 恢复 React state (CommandCenter 注入)
  initialCanvasState?: {
    nodes: Node<AgentNodeData>[] | Array<Record<string, unknown>>;
    edges: Edge[] | Array<Record<string, unknown>>;
    version: number;
  } | null;
  sessionParticipants?: {
    employee_id?: string | null;
    participant_ids?: string[];
  } | null;
}

/**
 * M4.4: 暴露给 CommandCenter 的 imperative API
 * - focusNode(employeeId): 画布对应节点 pulse 3s
 * - blurAll(): 清所有高亮
 * - getStatusCount(): 返 {done, total} 供浮动按钮 badge
 */
export interface CanvasHandle {
  focusNode: (employeeId: string | number) => void;
  blurAll: () => void;
  getStatusCount: () => { done: number; total: number };
}

const CollaborationCanvas = forwardRef<CanvasHandle, Props>(function CollaborationCanvasImpl(
  { open, onClose, conversationId, initialCanvasState, sessionParticipants },
  ref
) {
  const [nodes, setNodes] = useState<Node<AgentNodeData>[]>(INITIAL_NODES);
  const [edges, setEdges] = useState<Edge[]>(INITIAL_EDGES);
  const [layouted, setLayouted] = useState(false);
  // M4.3.1: 员工 palette 状态 + 员工列表
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  // M4.5.1: debounce 写入后端 (500ms, 防拖拽时 N req/s)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>(''); // 去重:状态未变不发请求
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('从协作画布保存的多员工协作方案');
  const [templateCategory, setTemplateCategory] = useState('collaboration');
  const [templateVisibility, setTemplateVisibility] = useState<'private' | 'tenant'>('private');
  const [templateStrategy, setTemplateStrategy] = useState<'relay' | 'parallel' | 'single'>('relay');
  const [templateFailureStrategy, setTemplateFailureStrategy] = useState<'continue_with_next_employee' | 'stop_on_error'>('continue_with_next_employee');
  const [templateOutputType, setTemplateOutputType] = useState('markdown');
  const [templateDefaultPrompt, setTemplateDefaultPrompt] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) || null, [nodes, selectedNodeId]);
  const [messageApi, messageContextHolder] = message.useMessage();

  const buildSessionTopology = useCallback((): { nodes: Node<AgentNodeData>[]; edges: Edge[] } | null => {
    const orderedIds = [
      sessionParticipants?.employee_id,
      ...(sessionParticipants?.participant_ids || []),
    ].filter((id): id is string => Boolean(id));
    const uniqueIds = Array.from(new Set(orderedIds));
    if (uniqueIds.length === 0) return null;

    const byUuid = new Map(allEmployees.map((emp) => [String(emp.__id), emp]));
    const employeeNodes: Node<AgentNodeData>[] = uniqueIds.map((employeeId, index) => {
      const emp = byUuid.get(employeeId);
      const label = emp?.name || emp?.display_name || `员工 ${index + 1}`;
      return {
        id: `employee-${employeeId}`,
        type: 'agent',
        position: { x: 0, y: 0 },
        data: {
          label,
          role: 'employee',
          status: 'done',
          avatar: emp?.avatar_char || emp?.avatar || label.charAt(0),
          employeeId,
          detail: `${index === 0 ? '主员工' : `接力 ${index}`} · ${emp?.department?.name || '未分配'}`,
          executionMode: 'relay',
          outputType: 'markdown',
          defaultPrompt: '',
          skills: [],
          failureStrategy: 'continue_with_next_employee',
        },
      };
    });

    const nodes: Node<AgentNodeData>[] = [
      {
        id: 'user',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: { label: '用户', role: 'user', status: 'done', avatar: 'U', detail: '发起任务' },
      },
      ...employeeNodes,
    ];
    const edges: Edge[] = employeeNodes.map((node, index) => ({
      id: index === 0 ? `e-user-${node.id}` : `e-${employeeNodes[index - 1].id}-${node.id}`,
      source: index === 0 ? 'user' : employeeNodes[index - 1].id,
      target: node.id,
      animated: false,
      style: { stroke: '#8B8FA3' },
    }));
    return { nodes, edges };
  }, [allEmployees, sessionParticipants]);

  // M4.3.1: 受控 — 节点/边变化同步入 React state (拖拽/删除/连接)
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds) as Node<AgentNodeData>[]),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      // 阻止 self-loop (source === target)
      if (connection.source === connection.target) {
        messageApi.warning('不能连接节点到自己');
        return;
      }
      setEdges((eds) => addEdge({ ...connection, animated: false, style: { stroke: '#8B7FE8' } }, eds));
      messageApi.success(`已连接 ${connection.source} → ${connection.target}`);

      // M5 (Event Log): connect 事件 best-effort log (D27)
      if (conversationId) {
        logCanvasEvent(conversationId, {
          event_type: 'connect',
          edge_id: `e-${connection.source}-${connection.target}`,
          node_id: connection.target ?? undefined,
          payload: { source: connection.source, target: connection.target },
        } as any).catch((e) => console.warn('[M5] log connect failed:', e));
      }
    },
    [conversationId, messageApi]
  );

  // M5 (Event Log): 节点 click — 必 log (D27)
  // 弹员工卡 (复用 M3 sidebar 详情模式) + 写 event log
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node<AgentNodeData>) => {
      setSelectedNodeId(node.id);
      console.log('[M5] node clicked:', node.id, node.data);
      // 1) log 写后端
      if (conversationId) {
        const employeeId = String((node.data as AgentNodeData)?.employeeId || '');
        logCanvasEvent(conversationId, {
          event_type: 'click',
          employee_id: employeeId || undefined,
          node_id: node.id,
          payload: {
            label: (node.data as any)?.label ?? node.id,
            employee_id: employeeId || undefined,
            position: node.position,
          },
        } as any)
          .then((evt: any) => console.log('[M5] event logged:', evt?.id))
          .catch((e) => console.warn('[M5] log click failed:', e));
      }
      // 2) 弹员工卡 — 用 message.info 简单弹 (D25 简化为浮窗)
      const label = (node.data as any)?.label ?? node.id;
      messageApi.info({
        content: `员工: ${label} (${node.id})`,
        duration: 2,
        style: { marginTop: '20vh' },
      });
    },
    [conversationId, messageApi]
  );

  const updateSelectedNodeData = useCallback((patch: Partial<AgentNodeData>) => {
    if (!selectedNodeId) return;
    setNodes((prev) => prev.map((node) => (
      node.id === selectedNodeId
        ? { ...node, data: { ...node.data, ...patch } }
        : node
    )));
  }, [selectedNodeId]);

  // M4.3.1: 拉员工列表 (palette 数据源)
  useEffect(() => {
    fetchEmployees()
      .then((list) => setAllEmployees(Array.isArray(list) ? list : []))
      .catch((e) => {
        console.warn('[M4.3.1] fetchEmployees failed:', e);
        setAllEmployees([]);
      });
  }, []);

  // M4.5.1: 打开 + 注入 initialCanvasState → 恢复 React state;空/旧 demo 时按真实会话参与者生成拓扑
  useEffect(() => {
    if (!open) return;
    const hasState = Boolean(initialCanvasState && (initialCanvasState.nodes.length > 0 || initialCanvasState.edges.length > 0));
    let normalized = hasState
      ? normalizeCanvasState(
          initialCanvasState!.nodes as Array<Record<string, unknown>>,
          initialCanvasState!.edges as Array<Record<string, unknown>>,
        )
      : null;
    const sessionTopology = buildSessionTopology();
    if (!normalized || (sessionTopology && isDemoCanvasState(normalized.nodes, normalized.edges))) {
      normalized = sessionTopology || { nodes: INITIAL_NODES, edges: INITIAL_EDGES };
    }
    setNodes(normalized.nodes);
    setEdges(normalized.edges);
    setLayouted(false); // 触发 ELK 重 layout 校正位置
    // 记录上次保存,避免 debounce 上来就调一次"重复写"
    lastSavedRef.current = JSON.stringify({
      nodes: normalized.nodes,
      edges: normalized.edges,
    });
  }, [open, initialCanvasState, buildSessionTopology]);

  // M4.3.1: addNode — 选中 palette 员工 → 加节点 (随机位置, 走 ELK 重 layout)
  const addNode = useCallback(
    (emp: Employee) => {
      const employeeId = emp.__id || String(emp.id);
      const id = `employee-${employeeId}-${Date.now()}`;
      const newNode: Node<AgentNodeData> = {
        id,
        type: 'agent',
        position: { x: 80 + Math.random() * 240, y: 80 + Math.random() * 240 },
        data: {
          label: emp.name,
          role: 'employee',
          status: 'idle',
          avatar: emp.avatar_char,
          employeeId,
          detail: `ID ${emp.id} · ${emp.department?.name || '未分配'}`,
          executionMode: 'relay',
          outputType: 'markdown',
          defaultPrompt: '',
          skills: [],
          failureStrategy: 'continue_with_next_employee',
        },
      };
      setNodes((prev) => [...prev, newNode]);
      setSelectedNodeId(id);
      setLayouted(false); // 触发 ELK 重 layout
      setPaletteOpen(false);
      messageApi.success(`已添加节点: ${emp.name}`);
    },
    [messageApi]
  );

  // ELK 布局(打开时跑 1 次 + addNode 后重跑)
  useEffect(() => {
    if (!open || layouted) return;
    layoutWithElk(nodes, edges).then((positioned) => {
      setNodes(positioned);
      setLayouted(true);
    });
  }, [open, layouted, nodes, edges]);

  // M4.5.1: nodes/edges 变化 → debounce 500ms 调 patchCanvasState
  useEffect(() => {
    if (!open || !conversationId) return;
    const serialized = JSON.stringify({ nodes, edges });
    // 去重:跟上次保存一致不重发
    if (serialized === lastSavedRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveStatus('saving');
    debounceRef.current = setTimeout(() => {
      patchCanvasState(conversationId, {
        nodes: nodes as unknown as Array<Record<string, unknown>>,
        edges: edges as unknown as Array<Record<string, unknown>>,
        version: 1,
      })
        .then(() => {
          lastSavedRef.current = serialized;
          setSaveStatus('saved');
          // 1.5s 后回 idle (避免 UI 一直闪 saved)
          setTimeout(() => setSaveStatus('idle'), 1500);
        })
        .catch((e) => {
          console.warn('[M4.5.1] patchCanvasState failed:', e);
          setSaveStatus('error');
        });
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [nodes, edges, open, conversationId]);

  // M4.5.1: 卸载/关闭时清掉 pending timer + 卸载时同步 flush
  useEffect(() => {
    const flushOnUnload = () => {
      if (!conversationId || !debounceRef.current) return;
      // 同步发 (beacon API, 不阻塞 unload)
      try {
        const payload = JSON.stringify({
          nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
          edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
          version: 1,
        });
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(`/api/sessions/${conversationId}/canvas-state`, blob);
      } catch {
        // best-effort, ignore
      }
    };
    window.addEventListener('beforeunload', flushOnUnload);
    return () => {
      window.removeEventListener('beforeunload', flushOnUnload);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [conversationId, nodes, edges]);

  // demo 状态切换:模拟 SSE agent_thinking/running/done 序列。
  // 优先在当前画布拓扑上播放，避免把模板节点替换成固定 demo 节点。
  const runDemo = useCallback(() => {
    const baseNodes = nodes.length > 0 ? nodes : INITIAL_NODES;
    const baseEdges = edges.length > 0 ? edges : INITIAL_EDGES;
    const employeeNodeIds = baseNodes.filter((n) => n.data?.role !== 'user').map((n) => n.id);
    const firstEmployeeId = employeeNodeIds[0] || baseNodes[1]?.id || baseNodes[0]?.id;
    const secondEmployeeId = employeeNodeIds[1] || employeeNodeIds[0] || baseNodes[0]?.id;

    setLayouted(false);
    messageApi.info('正在预览当前协作方案的执行状态');
    setNodes(baseNodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        status: n.data?.role === 'user' ? 'done' : n.id === firstEmployeeId ? 'thinking' : 'idle',
      },
    })));
    setEdges(baseEdges.map((e, idx) => ({
      ...e,
      animated: e.target === firstEmployeeId || idx === 0,
      style: { ...(e.style || {}), stroke: e.target === firstEmployeeId || idx === 0 ? '#8B7FE8' : '#8B8FA3' },
    })));

    // 1.5s 后首个员工完成,下个员工思考中
    setTimeout(() => {
      setNodes((prev) => prev.map((n) => {
        if (n.id === firstEmployeeId) return { ...n, data: { ...n.data, status: 'done' } };
        if (n.id === secondEmployeeId) return { ...n, data: { ...n.data, status: 'thinking' } };
        return n;
      }));
      setEdges((prev) => prev.map((e) =>
        e.target === secondEmployeeId ? { ...e, animated: true, style: { ...(e.style || {}), stroke: '#8B7FE8' } } : e
      ));
    }, 1500);

    // 3s 后下个员工执行中
    setTimeout(() => {
      setNodes((prev) => prev.map((n) =>
        n.id === secondEmployeeId ? { ...n, data: { ...n.data, status: 'running' } } : n
      ));
    }, 3000);

    // 5s 后 emp-2 done,全 done → M4.4.3 emit summary
    setTimeout(() => {
      setNodes((prev) => prev.map((n) => ({ ...n, data: { ...n.data, status: 'done' } })));
      setEdges((prev) => prev.map((e) => ({ ...e, animated: false, style: { stroke: '#10B981' } })));
      setLayouted(true);
      // M4.4.3: 全节点 done → 触发 canvasApi.emitAllDone → CommandCenter 收 summary
      canvasApi.emitAllDone();
    }, 5000);
  }, [edges, messageApi, nodes]);

  const reset = useCallback(() => {
    const sessionTopology = buildSessionTopology();
    setNodes(sessionTopology?.nodes || INITIAL_NODES);
    setEdges(sessionTopology?.edges || INITIAL_EDGES);
    setLayouted(false);
  }, [buildSessionTopology]);

  const openTemplateModal = useCallback(() => {
    if (!conversationId) {
      messageApi.warning('请先进入一个会话再保存方案');
      return;
    }
    setTemplateName(`协作方案-${new Date().toLocaleDateString('zh-CN')}`);
    setTemplateModalOpen(true);
  }, [conversationId, messageApi]);

  const handleSaveTemplate = useCallback(async () => {
    if (!conversationId) {
      messageApi.warning('请先进入一个会话再保存方案');
      return;
    }
    const name = templateName.trim();
    if (!name) {
      messageApi.warning('请填写方案名称');
      return;
    }
    try {
      await patchCanvasState(conversationId, { nodes, edges, version: 1 });
      await saveSessionTemplate(conversationId, {
        name,
        description: templateDescription.trim(),
        category: templateCategory.trim() || 'collaboration',
        visibility: templateVisibility,
        strategy: templateStrategy,
        failure_strategy: templateFailureStrategy,
        output_type: templateOutputType.trim() || 'markdown',
        default_prompt: templateDefaultPrompt.trim(),
      });
      setTemplateModalOpen(false);
      messageApi.success('已保存为可复用协作方案');
    } catch (e: any) {
      messageApi.error(`保存方案失败: ${e?.message || e}`);
    }
  }, [conversationId, edges, messageApi, nodes, templateCategory, templateDefaultPrompt, templateDescription, templateFailureStrategy, templateName, templateOutputType, templateStrategy, templateVisibility]);

  // M4.4: 暴露 imperative API 给 CommandCenter
  useImperativeHandle(
    ref,
    () => ({
      focusNode(employeeId) {
        // 在画布 DOM 树中找对应节点,加 highlight class 3s
        const id = String(employeeId);
        // 1. 试 emp-{id}
        let nodeEl = document.querySelector(`[data-id="emp-${id}"]`);
        // 2. 试原 id
        if (!nodeEl) nodeEl = document.querySelector(`[data-id="${id}"]`);
        // 3. fallback: 在 React Flow 内部找 .react-flow__node
        if (!nodeEl) {
          const all = document.querySelectorAll('.react-flow__node');
          for (const el of Array.from(all)) {
            if ((el.getAttribute('data-id') || '').endsWith(`-${id}`) ||
                (el.getAttribute('data-id') || '').includes(String(id))) {
              nodeEl = el;
              break;
            }
          }
        }
        if (nodeEl) {
          nodeEl.classList.add('m44-highlight');
          setTimeout(() => nodeEl.classList.remove('m44-highlight'), 3000);
        }
      },
      blurAll() {
        document.querySelectorAll('.m44-highlight').forEach((el) => el.classList.remove('m44-highlight'));
      },
      getStatusCount() {
        const total = nodes.length;
        const done = nodes.filter((n) => n.data.status === 'done').length;
        return { done, total };
      },
    }),
    [nodes]
  );

  // M4.4: 注册到 canvasApi (命令中心 group 卸载时 unregister)
  useEffect(() => {
    const unregister = canvasApi.registerCanvas(
      (id) => {
        // 通过 ref 暴露的 focusNode
        const handle = (ref as { current: CanvasHandle | null })?.current;
        if (handle) handle.focusNode(id);
      },
      () => {
        const handle = (ref as { current: CanvasHandle | null })?.current;
        if (handle) handle.blurAll();
      }
    );
    return unregister;
  }, [ref]);

  return (
    <>
    {messageContextHolder}
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="92vw"
      style={{ top: 24 }}
      styles={{
        body: { height: '82vh', padding: 0, background: 'var(--bg-primary)', overflow: 'visible' /* M4.3.1: 不裁剪节点拖拽事件 */ },
        content: { background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' },
      }}
      closable={false}
      title={null}
    >
      {/* 顶部工具栏 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 24px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-elevated)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ApartmentOutlined style={{ color: 'var(--accent)', fontSize: 18 }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            协作画布
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 8 }}>
            编排员工接力或并行协作，配置节点能力并保存复用
          </span>
          {/* M4.5.1: 保存状态指示器 */}
          {conversationId && (
            <span
              data-m45-1-save-status={saveStatus}
              style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 6,
                background: saveStatus === 'saving' ? 'rgba(139,127,232,0.12)' :
                            saveStatus === 'saved' ? 'rgba(16,185,129,0.12)' :
                            saveStatus === 'error' ? 'rgba(239,68,68,0.12)' : 'transparent',
                color: saveStatus === 'saving' ? '#8B7FE8' :
                       saveStatus === 'saved' ? '#10B981' :
                       saveStatus === 'error' ? '#EF4444' : 'var(--text-tertiary)',
                fontWeight: 600,
                transition: 'all var(--motion-base) var(--motion-ease)',
              }}
            >
              {saveStatus === 'saving' ? '保存中…' :
               saveStatus === 'saved' ? '已保存' :
               saveStatus === 'error' ? '保存失败' : '自动保存已开启'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* M4.3.1: + 员工 palette 开关 */}
          <Button
            type={paletteOpen ? 'primary' : 'text'}
            icon={<PlusOutlined />}
            onClick={() => setPaletteOpen((p) => !p)}
            aria-label="添加员工节点"
            data-m44-1-toggle="true"
            style={paletteOpen ? { background: 'var(--accent)' } : { color: 'var(--text-secondary)' }}
          >
            添加员工
          </Button>
          <Button
            type="text"
            icon={<ReloadOutlined />}
            onClick={reset}
            aria-label="重置协作画布"
            style={{ color: 'var(--text-secondary)' }}
          >
            重置
          </Button>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={runDemo}
            aria-label="预览执行协作方案"
            style={{ background: 'var(--accent)' }}
          >
            预览执行
          </Button>
          <Button
            type="text"
            onClick={openTemplateModal}
            aria-label="保存为协作方案"
            style={{ color: 'var(--text-secondary)' }}
          >
            保存为方案
          </Button>
          <Button
            type="text"
            icon={<CloseOutlined />}
            onClick={onClose}
            aria-label="关闭协作画布"
            style={{ color: 'var(--text-secondary)' }}
          />
        </div>
      </div>

      {/* M4.3.1: + 员工 palette 侧栏 (玻璃态 240px 左抽屉) */}
      {paletteOpen && (
        <div
          data-m44-1-palette="true"
          style={{
            position: 'absolute', top: 60, left: 0, bottom: 0,
            width: 240, zIndex: 40,
            background: 'var(--bg-elevated)',
            borderRight: '1px solid var(--border-subtle)',
            boxShadow: '4px 0 16px rgba(0,0,0,0.06)',
            overflowY: 'auto',
            padding: 12,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, padding: '4px 8px' }}>
            添加员工节点
          </div>
          {allEmployees.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 8px' }}>
              加载中 / 无员工
            </div>
          ) : (
            allEmployees.map((emp) => (
              <button
                key={emp.id}
                onClick={() => addNode(emp)}
                data-m44-1-palette-item={emp.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '8px 10px',
                  border: 'none', borderRadius: 8, cursor: 'pointer',
                  background: 'transparent', textAlign: 'left',
                  transition: 'all var(--motion-fast) var(--motion-ease)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <div
                  style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: emp.department?.color || '#4F46E5', color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, flexShrink: 0,
                  }}
                >
                  {emp.avatar_char}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {emp.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {emp.department?.name || '未分配'}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {selectedNode && (
        <div
          data-canvas-node-panel="true"
          style={{
            position: 'absolute', top: 76, right: 16, bottom: 16,
            width: 360, maxWidth: 'calc(100% - 32px)', zIndex: 45,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            boxShadow: '-6px 10px 30px rgba(15,23,42,0.10)',
            overflowY: 'auto',
            padding: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>节点属性</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3, lineHeight: 1.35, wordBreak: 'break-all' }}>
                {selectedNode.id}
              </div>
            </div>
            <Button
              size="small"
              type="text"
              icon={<CloseOutlined />}
              onClick={() => setSelectedNodeId(null)}
              style={{ flexShrink: 0, color: 'var(--text-secondary)' }}
            />
          </div>
          <div style={{ display: 'grid', gap: 14 }}>
            <PropertySectionTitle>基础信息</PropertySectionTitle>
            <PropertyField label="节点名称">
              <Input
                value={String(selectedNode.data.label || '')}
                onChange={(e) => updateSelectedNodeData({ label: e.target.value })}
              />
            </PropertyField>
            <PropertyField label="节点角色">
              <select
                value={selectedNode.data.role}
                onChange={(e) => updateSelectedNodeData({ role: e.target.value as 'user' | 'employee' })}
                style={fieldSelectStyle}
              >
                <option value="user">用户输入</option>
                <option value="employee">数字员工</option>
              </select>
            </PropertyField>
            <PropertySectionTitle>执行配置</PropertySectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <PropertyField label="执行方式">
                <select
                  value={selectedNode.data.executionMode || 'relay'}
                  onChange={(e) => updateSelectedNodeData({ executionMode: e.target.value as AgentNodeData['executionMode'] })}
                  style={fieldSelectStyle}
                >
                  <option value="relay">接力</option>
                  <option value="parallel">并行</option>
                  <option value="single">单步</option>
                </select>
              </PropertyField>
              <PropertyField label="输出类型">
                <select
                  value={selectedNode.data.outputType || 'markdown'}
                  onChange={(e) => updateSelectedNodeData({ outputType: e.target.value })}
                  style={fieldSelectStyle}
                >
                  <option value="markdown">Markdown</option>
                  <option value="html">HTML</option>
                  <option value="table">表格</option>
                  <option value="json">JSON</option>
                  <option value="report">报告</option>
                  <option value="artifact">输出物</option>
                </select>
              </PropertyField>
            </div>
            <PropertyField label="失败策略">
              <select
                value={selectedNode.data.failureStrategy || 'continue_with_next_employee'}
                onChange={(e) => updateSelectedNodeData({ failureStrategy: e.target.value as AgentNodeData['failureStrategy'] })}
                style={fieldSelectStyle}
              >
                <option value="continue_with_next_employee">失败后继续下个员工</option>
                <option value="stop_on_error">失败即停止</option>
              </select>
            </PropertyField>
            <PropertyField label="绑定 Skill">
              <Input
                value={(selectedNode.data.skills || []).join(', ')}
                onChange={(e) => updateSelectedNodeData({ skills: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                placeholder="document-extraction, financial-modeling"
              />
            </PropertyField>
            <PropertySectionTitle>节点提示</PropertySectionTitle>
            <PropertyField label="节点默认提示">
              <Input.TextArea
                value={selectedNode.data.defaultPrompt || ''}
                onChange={(e) => updateSelectedNodeData({ defaultPrompt: e.target.value })}
                rows={5}
                placeholder="只对当前节点生效，例如：提取附件关键指标并输出 Markdown 表格。"
              />
            </PropertyField>
            <div style={{ padding: 10, borderRadius: 8, background: 'rgba(139,127,232,0.08)', color: 'var(--text-secondary)', fontSize: 11, lineHeight: 1.6 }}>
              保存为方案后，这些属性会成为协作方案的一部分。节点 Skill、输出类型和失败策略可用于后续真实接力执行。
            </div>
          </div>
        </div>
      )}

      {/* 画布 */}
      <div style={{ width: '100%', height: 'calc(100% - 60px)' }}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}  // M5 (Event Log): 节点 click handler
            nodesDraggable
            nodesConnectable
            edgesFocusable
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.3}
            maxZoom={1.5}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(139,127,232,0.15)" />
            <Controls
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
              }}
            />
            <MiniMap
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                pointerEvents: 'none',
              }}
              maskColor="rgba(0,0,0,0.4)"
              nodeColor={(n) => {
                const data = n.data as AgentNodeData;
                return data.role === 'user' ? '#8B7FE8' : STATUS_COLOR[data.status];
              }}
            />
            <Panel position="bottom-left">
              <div
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 10,
                  padding: '10px 14px',
                  fontSize: 11,
                  color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  节点状态机
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(['idle', 'thinking', 'running', 'done', 'error'] as AgentStatus[]).map((s) => (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: STATUS_COLOR[s],
                        }}
                      />
                      {STATUS_LABEL[s]} · {s}
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </Modal>
    <Modal
      open={templateModalOpen}
      title="保存为可复用协作方案"
      okText="保存方案"
      cancelText="取消"
      onOk={handleSaveTemplate}
      onCancel={() => setTemplateModalOpen(false)}
      destroyOnHidden
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          方案名称
          <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="例如：标书评审三员工接力" />
        </label>
        <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          描述
          <Input.TextArea
            value={templateDescription}
            onChange={(e) => setTemplateDescription(e.target.value)}
            rows={3}
            placeholder="说明这个编排适合复用在哪些场景"
          />
        </label>
        <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          分类
          <Input value={templateCategory} onChange={(e) => setTemplateCategory(e.target.value)} placeholder="collaboration" />
        </label>
        <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          可见性
          <select
            value={templateVisibility}
            onChange={(e) => setTemplateVisibility(e.target.value as 'private' | 'tenant')}
            style={{ height: 32, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-primary)', color: 'var(--text-primary)', padding: '0 8px' }}
          >
            <option value="private">仅自己可见</option>
            <option value="tenant">租户内可见</option>
          </select>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            执行方式
            <select
              value={templateStrategy}
              onChange={(e) => setTemplateStrategy(e.target.value as 'relay' | 'parallel' | 'single')}
              style={{ height: 32, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-primary)', color: 'var(--text-primary)', padding: '0 8px' }}
            >
              <option value="relay">接力执行</option>
              <option value="parallel">并行协作</option>
              <option value="single">单员工</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            失败策略
            <select
              value={templateFailureStrategy}
              onChange={(e) => setTemplateFailureStrategy(e.target.value as 'continue_with_next_employee' | 'stop_on_error')}
              style={{ height: 32, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-primary)', color: 'var(--text-primary)', padding: '0 8px' }}
            >
              <option value="continue_with_next_employee">失败后继续下个员工</option>
              <option value="stop_on_error">失败即停止</option>
            </select>
          </label>
        </div>
        <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          输出物类型
          <Input value={templateOutputType} onChange={(e) => setTemplateOutputType(e.target.value)} placeholder="markdown / report / table / artifact" />
        </label>
        <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          默认提示
          <Input.TextArea
            value={templateDefaultPrompt}
            onChange={(e) => setTemplateDefaultPrompt(e.target.value)}
            rows={3}
            placeholder="复用该方案时默认追加给员工链路的提示，可为空"
          />
        </label>
      </div>
    </Modal>
    </>
  );
});

CollaborationCanvas.displayName = 'CollaborationCanvas';
export default CollaborationCanvas;

const fieldSelectStyle: CSSProperties = {
  height: 32,
  borderRadius: 6,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  padding: '0 8px',
  width: '100%',
};

function PropertyField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function PropertySectionTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{
      marginTop: 2,
      paddingTop: 2,
      fontSize: 11,
      fontWeight: 800,
      color: 'var(--text-tertiary)',
      textTransform: 'uppercase',
      letterSpacing: 'var(--ls-uppercase)',
    }}>
      {children}
    </div>
  );
}
