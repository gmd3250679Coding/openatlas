/**
 * types/dispatch.ts — Phase B 拆分 (2026-06-04)
 *
 * 统一 Atlas CommandCenter 三栏的 dispatch 数据模型,把 CommandCenter 内部
 * Tunnel(用 lines / done 字段)和 DispatchPanel 的 TunnelSpec(用 outputLines /
 * isComplete 字段)的命名差异收敛到单一真相,后续 RightAside 直接渲染
 * DispatchPanel,不再做手搓的 <aside>。
 *
 * 旧 Tunnel/TunnelSpec 字段映射:
 *   lines        <-> outputLines
 *   done         <-> isComplete
 *   status       <-> status(同名字段保留)
 *   id / name / avatar / color / department / task — 不变
 */
export interface DispatchTunnel {
  id: string;
  name: string;
  avatar: string;
  color: string;
  department: string;
  status: string;
  task: string;
  /** 调度过程行(接收问题/分析意图/调用模型/生成回复完成等),从老 Tunnel.lines 改名 */
  outputLines: string[];
  /** 是否已完成,从老 Tunnel.done 改名 */
  isComplete: boolean;
}

/** 派生的"对话结论"行(由 法务智囊 处理完成 / 回复长度 360 字 / 完成时间 ...) */
export type DispatchConclusion = string;

/** 当前会话生成的虚拟文件占位(Phase 1 没真落盘,只显示文件名) */
export type DispatchFile = string;

export interface DispatchState {
  tunnels: DispatchTunnel[];
  conclusions: DispatchConclusion[];
  files: DispatchFile[];
}
