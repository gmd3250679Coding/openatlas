/**
 * canvasApi.ts — M4.4 双模联动 service 单例
 *
 * 跨组件 (CommandCenter ↔ CollaborationCanvas) 互高亮的轻量桥:
 * - focusNode(employeeId)  → 画布节点 .highlight-pulse 3s
 * - blurAll()              → 清所有高亮
 * - scrollToMessage(msgId) → 气泡 scrollIntoView + .highlight-pulse 3s
 * - onAllDone(fn)          → 订阅 "所有节点 done" 事件 (M4.4.3 summary)
 *
 * 不用 Redux/Context, 用 module-level event emitter 模式 — 最小改动, 0 依赖
 */

type CanvasNodeId = string | number;
type MessageId = string | number;

type BlurFn = () => void;
type FocusFn = (nodeId: CanvasNodeId) => void;
type ScrollFn = (msgId: MessageId) => void;
type AllDoneFn = () => void;

interface CanvasApi {
  // 画布侧注册 (CollaborationCanvas mount 时)
  registerCanvas: (focus: FocusFn, blur: BlurFn) => () => void;
  // 群聊侧注册 (CommandCenter mount 时)
  registerChat: (scroll: ScrollFn) => () => void;
  // M4.4.3 任务完成订阅
  subscribeAllDone: (fn: AllDoneFn) => () => void;

  // 群聊调用: 气泡 click → 画布节点 pulse
  focusNode: (nodeId: CanvasNodeId) => void;
  // 群聊调用: 清所有画布高亮
  blurAll: () => void;
  // 画布调用: 节点 click → 气泡 scroll + pulse
  scrollToMessage: (msgId: MessageId) => void;
  // 画布调用: 所有节点 done → 触发 M4.4.3 summary
  emitAllDone: () => void;
}

let canvasFocus: FocusFn | null = null;
let canvasBlur: BlurFn | null = null;
let chatScroll: ScrollFn | null = null;
const allDoneSubscribers: Set<AllDoneFn> = new Set();

export const canvasApi: CanvasApi = {
  registerCanvas(focus, blur) {
    canvasFocus = focus;
    canvasBlur = blur;
    return () => {
      if (canvasFocus === focus) canvasFocus = null;
      if (canvasBlur === blur) canvasBlur = null;
    };
  },

  registerChat(scroll) {
    chatScroll = scroll;
    return () => {
      if (chatScroll === scroll) chatScroll = null;
    };
  },

  subscribeAllDone(fn) {
    allDoneSubscribers.add(fn);
    return () => {
      allDoneSubscribers.delete(fn);
    };
  },

  focusNode(nodeId) {
    canvasFocus?.(nodeId);
  },

  blurAll() {
    canvasBlur?.();
  },

  scrollToMessage(msgId) {
    chatScroll?.(msgId);
  },

  emitAllDone() {
    allDoneSubscribers.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error('[canvasApi] allDone subscriber error:', e);
      }
    });
  },
};

export default canvasApi;
