import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Tooltip,
  message,
} from 'antd';
import {
  ApiOutlined,
  AppstoreOutlined,
  ApartmentOutlined,
  BarChartOutlined,
  BulbOutlined,
  BranchesOutlined,
  CloudOutlined,
  CodeOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DeploymentUnitOutlined,
  DownloadOutlined,
  FileImageOutlined,
  FilePptOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ImportOutlined,
  LaptopOutlined,
  MobileOutlined,
  NodeIndexOutlined,
  PartitionOutlined,
  PlusOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  SendOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  CaptureUpdateAction,
  Excalidraw,
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
  restoreLibraryItems,
  serializeAsJSON,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import PptxGenJS from 'pptxgenjs';
import {
  createWhiteboard,
  deleteWhiteboard,
  fetchWhiteboards,
  generateWhiteboard,
  getWhiteboard,
  patchWhiteboard,
  readWhiteboard,
  refineWhiteboard,
  type WhiteboardDocument,
} from '../services/api';
import '../styles/whiteboard.css';

type ExcalidrawApi = {
  updateScene: (scene: any) => void;
  setLibrary?: (libraryItems: any[] | ((latestLibraryItems: any[]) => any[] | Promise<any[]>)) => Promise<any[]>;
  updateLibrary?: (opts: {
    libraryItems: any[];
    merge?: boolean;
    prompt?: boolean;
    openLibraryMenu?: boolean;
    defaultStatus?: 'published' | 'unpublished';
  }) => Promise<any[]>;
  addFiles?: (files: any[]) => void;
  getSceneElements: () => any[];
  getSceneElementsIncludingDeleted?: () => any[];
  getAppState: () => any;
  getFiles: () => Record<string, any>;
  scrollToContent?: (elements?: any[], opts?: any) => void;
};

type SceneState = {
  type: string;
  version: number;
  source: string;
  elements: any[];
  appState: Record<string, any>;
  files: Record<string, any>;
};

type DraftKind = 'flowchart' | 'ppt' | 'architecture' | 'wireframe';

const EMPTY_SCENE: SceneState = {
  type: 'excalidraw',
  version: 2,
  source: 'openatlas:whiteboard',
  elements: [],
  appState: {
    viewBackgroundColor: '#ffffff',
    gridSize: 20,
    name: '未命名白板',
  },
  files: {},
};

const DRAFT_KINDS: Array<{ value: DraftKind; label: string }> = [
  { value: 'flowchart', label: '流程图' },
  { value: 'ppt', label: 'PPT 草稿' },
  { value: 'architecture', label: '架构图' },
  { value: 'wireframe', label: '原型界面' },
];

const TEMPLATE_CARDS: Array<{ kind: DraftKind; title: string; prompt: string }> = [
  { kind: 'flowchart', title: '业务流程', prompt: '需求收集，方案设计，评审确认，执行交付，复盘优化' },
  { kind: 'ppt', title: '路演故事线', prompt: '问题背景，市场机会，解决方案，产品能力，商业价值，下一步计划' },
  { kind: 'architecture', title: '企业 AI 架构', prompt: '用户入口，API 网关，Atlas 服务，Agent Runtime，文件存储，审计日志' },
  { kind: 'wireframe', title: 'SaaS 工作台', prompt: '侧边导航，顶部状态，核心工作区，右侧属性，结果列表，生成按钮' },
];

const ICON_LIBRARY = [
  { key: 'user', category: '通用', label: '用户', icon: <UserOutlined />, color: '#d97706' },
  { key: 'app', category: '通用', label: '应用', icon: <AppstoreOutlined />, color: '#e11d48' },
  { key: 'mobile', category: '通用', label: '移动端', icon: <MobileOutlined />, color: '#9333ea' },
  { key: 'org', category: '通用', label: '组织', icon: <ApartmentOutlined />, color: '#64748b' },
  { key: 'server', category: 'IT', label: '服务', icon: <LaptopOutlined />, color: '#0284c7' },
  { key: 'database', category: 'IT', label: '数据库', icon: <DatabaseOutlined />, color: '#16a34a' },
  { key: 'cloud', category: 'IT', label: '云服务', icon: <CloudOutlined />, color: '#7c3aed' },
  { key: 'api', category: 'IT', label: 'API', icon: <ApiOutlined />, color: '#475569' },
  { key: 'code', category: 'IT', label: '代码', icon: <CodeOutlined />, color: '#0891b2' },
  { key: 'pipeline', category: 'IT', label: '流水线', icon: <BranchesOutlined />, color: '#0f766e' },
  { key: 'agent', category: 'AI', label: 'Agent', icon: <RobotOutlined />, color: '#4f46e5' },
  { key: 'model', category: 'AI', label: '模型', icon: <ThunderboltOutlined />, color: '#f59e0b' },
  { key: 'rag', category: 'AI', label: '检索', icon: <FileSearchOutlined />, color: '#0ea5e9' },
  { key: 'workflow', category: 'AI', label: '编排', icon: <PartitionOutlined />, color: '#10b981' },
  { key: 'security', category: 'AI', label: '治理', icon: <SafetyCertificateOutlined />, color: '#ef4444' },
  { key: 'analytics', category: 'AI', label: '分析', icon: <BarChartOutlined />, color: '#8b5cf6' },
];

type OfficialLibraryManifest = {
  libraries: Array<{
    key: string;
    name: string;
    file: string;
    upstream: string;
  }>;
};

type ExcalidrawExample = {
  key: string;
  title: string;
  kind: string;
  file: string;
  upstream: string;
  summary: string;
};

type ExcalidrawExampleManifest = {
  source: string;
  license: string;
  examples: ExcalidrawExample[];
};

const OFFICIAL_LIBRARY_MANIFEST_URL = '/excalidraw-libraries/manifest.json';
const EXCALIDRAW_EXAMPLE_MANIFEST_URL = '/excalidraw-examples/manifest.json';
let officialLibraryItemsPromise: Promise<any[]> | null = null;

function isAtlasSeededLibraryItem(item: any) {
  const id = String(item?.id || '');
  return id.startsWith('atlas-') || id.startsWith('official-excalidraw-');
}

async function loadOfficialExcalidrawLibraryItems() {
  if (!officialLibraryItemsPromise) {
    officialLibraryItemsPromise = (async () => {
      const manifestResponse = await fetch(OFFICIAL_LIBRARY_MANIFEST_URL);
      if (!manifestResponse.ok) throw new Error('无法加载 Excalidraw 素材清单');
      const manifest = await manifestResponse.json() as OfficialLibraryManifest;
      const libraryGroups = await Promise.all(manifest.libraries.map(async (library) => {
        const libraryResponse = await fetch(`/excalidraw-libraries/${library.file}`);
        if (!libraryResponse.ok) throw new Error(`无法加载素材库: ${library.name}`);
        const rawLibrary = await libraryResponse.json();
        const restoredItems = restoreLibraryItems(rawLibrary.libraryItems || rawLibrary.library || [], 'published') as any[];
        return restoredItems.map((item, index) => ({
          ...item,
          id: `official-excalidraw-${library.key}-${index}`,
          name: item.name || library.name,
          status: 'published',
        }));
      }));
      return libraryGroups.flat();
    })();
  }
  return officialLibraryItemsPromise;
}

function normalizeScene(scene: any): SceneState {
  return {
    ...EMPTY_SCENE,
    ...(scene && typeof scene === 'object' ? scene : {}),
    elements: Array.isArray(scene?.elements) ? scene.elements : [],
    appState: {
      ...EMPTY_SCENE.appState,
      ...(scene?.appState && typeof scene.appState === 'object' ? scene.appState : {}),
    },
    files: scene?.files && typeof scene.files === 'object' ? scene.files : {},
  };
}

function activeElements(elements: any[]) {
  return (elements || []).filter((element) => element && !element.isDeleted);
}

function looksLikeSkeletonElement(element: any) {
  if (!element || typeof element !== 'object') return false;
  if (element.customData?.atlasLibrarySource) return false;
  return (
    element.label ||
    element.versionNonce === undefined ||
    element.seed === undefined ||
    element.roughness === undefined
  );
}

function sceneNeedsElementRestore(scene: SceneState) {
  if (scene.source === 'openatlas:whiteboard-generator') return true;
  return activeElements(scene.elements).some(looksLikeSkeletonElement);
}

function elementBox(element: any) {
  return {
    x: Number(element?.x || 0),
    y: Number(element?.y || 0),
    w: Number(element?.width || 0),
    h: Number(element?.height || 0),
  };
}

function isPptSlideFrame(element: any) {
  if (!element || element.isDeleted) return false;
  if (!['rectangle', 'frame'].includes(element.type)) return false;
  const { w, h } = elementBox(element);
  if (w < 300 || h < 160) return false;
  const ratio = w / Math.max(1, h);
  const customKind = element.customData?.atlasKind || element.customData?.kind;
  return customKind === 'ppt-slide' || Math.abs(ratio - 16 / 9) < 0.08;
}

function findPptSlideFrames(elements: any[]) {
  return activeElements(elements)
    .filter(isPptSlideFrame)
    .sort((a, b) => {
      const ay = Number(a.y || 0);
      const by = Number(b.y || 0);
      if (Math.abs(ay - by) > 24) return ay - by;
      return Number(a.x || 0) - Number(b.x || 0);
    });
}

function elementsInsideFrame(elements: any[], frame: any) {
  const box = elementBox(frame);
  return activeElements(elements).filter((element) => {
    if (element.id === frame.id) return true;
    if (isPptSlideFrame(element)) return false;
    const item = elementBox(element);
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 300);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function safeFileTitle(title: string) {
  return (title || 'whiteboard').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'whiteboard';
}

export default function Whiteboard() {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [documents, setDocuments] = useState<WhiteboardDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [title, setTitle] = useState('未命名白板');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState('freeform');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftKind, setDraftKind] = useState<DraftKind>('flowchart');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [refineMode, setRefineMode] = useState('append');
  const [refinePrompt, setRefinePrompt] = useState('');
  const [refining, setRefining] = useState(false);
  const [promptTarget, setPromptTarget] = useState('方案');
  const [handoffPrompt, setHandoffPrompt] = useState('');
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [elementCount, setElementCount] = useState(0);
  const [examples, setExamples] = useState<ExcalidrawExample[]>([]);
  const [loadingExampleKey, setLoadingExampleKey] = useState<string | null>(null);
  const [api, setApi] = useState<ExcalidrawApi | null>(null);
  const sceneRef = useRef<SceneState>(EMPTY_SCENE);
  const suppressNextChangeRef = useRef(true);
  const suppressChangeUntilRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentDoc = useMemo(
    () => documents.find((item) => item.id === currentId) || null,
    [currentId, documents],
  );

  const loadDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const rows = await fetchWhiteboards();
      setDocuments(rows);
    } catch (e: any) {
      messageApi.error(`加载白板失败: ${e?.message || e}`);
    } finally {
      setLoadingDocs(false);
    }
  }, [messageApi]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    let cancelled = false;
    const loadExamples = async () => {
      try {
        const response = await fetch(EXCALIDRAW_EXAMPLE_MANIFEST_URL);
        if (!response.ok) throw new Error('无法加载 Excalidraw 示例清单');
        const manifest = await response.json() as ExcalidrawExampleManifest;
        if (!cancelled) setExamples(manifest.examples || []);
      } catch (e: any) {
        if (!cancelled) messageApi.warning(e?.message || 'Excalidraw 示例清单加载失败');
      }
    };
    void loadExamples();
    return () => {
      cancelled = true;
    };
  }, [messageApi]);

  const currentScene = useCallback((): SceneState => {
    if (!api) return sceneRef.current;
    const appState = api.getAppState?.() || {};
    const elements = api.getSceneElementsIncludingDeleted?.() || api.getSceneElements?.() || [];
    return {
      ...EMPTY_SCENE,
      elements,
      appState: {
        viewBackgroundColor: appState.viewBackgroundColor || '#ffffff',
        gridSize: appState.gridSize || 20,
        theme: appState.theme,
        name: title,
      },
      files: api.getFiles?.() || {},
    };
  }, [api, title]);

  const applyScene = useCallback((scene: any, opts: { generated?: boolean; nextTitle?: string; nextKind?: string } = {}) => {
    const normalized = normalizeScene(scene);
    const shouldRestoreElements = opts.generated || sceneNeedsElementRestore(normalized);
    const sketchElements = shouldRestoreElements
      ? normalized.elements.filter((element) => !element?.customData?.atlasLibrarySource)
      : normalized.elements;
    const restoredSketchElements = shouldRestoreElements
      ? (convertToExcalidrawElements(sketchElements as any, { regenerateIds: true }) as any[])
      : sketchElements;
    const nextElements = shouldRestoreElements
      ? normalized.elements.map((element) => (
        element?.customData?.atlasLibrarySource
          ? element
          : restoredSketchElements.shift()
      )).filter(Boolean)
      : sketchElements;
    const nextScene: SceneState = {
      ...normalized,
      elements: nextElements,
      appState: {
        ...normalized.appState,
        name: opts.nextTitle || title,
      },
    };
    sceneRef.current = nextScene;
    setElementCount(activeElements(nextElements).length);
    if (opts.nextTitle) setTitle(opts.nextTitle);
    if (opts.nextKind) setKind(opts.nextKind);
    if (api) {
      const files = Object.values(nextScene.files || {});
      if (files.length > 0) api.addFiles?.(files);
      suppressNextChangeRef.current = true;
      suppressChangeUntilRef.current = Date.now() + (opts.generated ? 120 : 600);
      api.updateScene({
        elements: nextScene.elements,
        appState: nextScene.appState,
        captureUpdate: opts.generated ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.NEVER,
      });
      window.setTimeout(() => api.scrollToContent?.(activeElements(nextScene.elements), { fitToContent: true }), 160);
    }
  }, [api, title]);

  const handleNew = useCallback(() => {
    setCurrentId(null);
    setTitle('未命名白板');
    setDescription('');
    setKind('freeform');
    setHandoffPrompt('');
    setDirty(false);
    applyScene(EMPTY_SCENE, { nextTitle: '未命名白板', nextKind: 'freeform' });
  }, [applyScene]);

  const handleOpen = useCallback(async (id: string) => {
    try {
      const doc = await getWhiteboard(id);
      setCurrentId(doc.id);
      setTitle(doc.title || '未命名白板');
      setDescription(doc.description || '');
      setKind(doc.kind || 'freeform');
      setHandoffPrompt('');
      applyScene(doc.scene || EMPTY_SCENE, { nextTitle: doc.title, nextKind: doc.kind });
      suppressChangeUntilRef.current = Date.now() + 1500;
      setDirty(false);
      window.setTimeout(() => setDirty(false), 900);
    } catch (e: any) {
      messageApi.error(`打开白板失败: ${e?.message || e}`);
    }
  }, [applyScene, messageApi]);

  const handleSave = useCallback(async () => {
    const scene = currentScene();
    const payload = {
      title,
      description,
      kind,
      scene,
    };
    setSaving(true);
    try {
      const saved = currentId
        ? await patchWhiteboard(currentId, payload)
        : await createWhiteboard(payload);
      setCurrentId(saved.id);
      setTitle(saved.title);
      setDescription(saved.description || '');
      setKind(saved.kind || kind);
      setDirty(false);
      await loadDocuments();
      messageApi.success('白板已保存');
    } catch (e: any) {
      messageApi.error(`保存失败: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  }, [currentId, currentScene, description, kind, loadDocuments, messageApi, title]);

  const handleDelete = useCallback(async () => {
    if (!currentId) return;
    try {
      await deleteWhiteboard(currentId);
      messageApi.success('白板已删除');
      await loadDocuments();
      handleNew();
    } catch (e: any) {
      messageApi.error(`删除失败: ${e?.message || e}`);
    }
  }, [currentId, handleNew, loadDocuments, messageApi]);

  const handleGenerate = useCallback(async (override?: { kind: DraftKind; prompt: string; title?: string }) => {
    const nextKind = override?.kind || draftKind;
    const prompt = override?.prompt ?? draftPrompt;
    if (!prompt.trim()) {
      messageApi.warning('请输入生成目标');
      return;
    }
    setGenerating(true);
    try {
      const result = await generateWhiteboard({ kind: nextKind, prompt, title: override?.title || title });
      applyScene(result.scene, {
        generated: true,
        nextTitle: result.title || title,
        nextKind,
      });
      setKind(nextKind);
      setDirty(true);
      setHandoffPrompt('');
      messageApi.success('已生成白板初稿');
    } catch (e: any) {
      messageApi.error(`生成失败: ${e?.message || e}`);
    } finally {
      setGenerating(false);
    }
  }, [applyScene, draftKind, draftPrompt, messageApi, title]);

  const insertIcon = useCallback((item: typeof ICON_LIBRARY[number]) => {
    if (!api) return;
    const appState = api.getAppState?.() || {};
    const x = Math.round((-Number(appState.scrollX || 0)) + 220 + Math.random() * 80);
    const y = Math.round((-Number(appState.scrollY || 0)) + 180 + Math.random() * 80);
    const skeleton = [
      {
        type: item.key === 'user' || item.key === 'cloud' ? 'ellipse' : 'rectangle',
        x,
        y,
        width: 150,
        height: 82,
        strokeColor: item.color,
        backgroundColor: '#ffffff',
        fillStyle: 'solid',
        roundness: { type: 3 },
        label: {
          text: item.label,
          fontSize: 18,
          textAlign: 'center',
          verticalAlign: 'middle',
        },
      },
    ];
    const generated = convertToExcalidrawElements(skeleton as any, { regenerateIds: true }) as any[];
    const nextElements = [...(api.getSceneElementsIncludingDeleted?.() || api.getSceneElements()), ...generated];
    api.updateScene({ elements: nextElements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    sceneRef.current = currentScene();
    setElementCount(activeElements(nextElements).length);
    setDirty(true);
  }, [api, currentScene]);

  const handleRefine = useCallback(async () => {
    if (!refinePrompt.trim()) {
      messageApi.warning('请输入二次编辑要求');
      return;
    }
    if (!api) return;
    setRefining(true);
    try {
      const result = await refineWhiteboard({
        scene: currentScene(),
        instruction: refinePrompt,
        mode: refineMode,
        title,
      });
      const patch = convertToExcalidrawElements(result.patch_elements as any, { regenerateIds: true }) as any[];
      const scene = currentScene();
      const nextElements = [...scene.elements, ...patch];
      api.updateScene({ elements: nextElements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      window.setTimeout(() => api.scrollToContent?.(patch, { fitToContent: true }), 80);
      sceneRef.current = { ...scene, elements: nextElements };
      setElementCount(activeElements(nextElements).length);
      setDirty(true);
      messageApi.success('已追加二次编辑建议');
    } catch (e: any) {
      messageApi.error(`精修失败: ${e?.message || e}`);
    } finally {
      setRefining(false);
    }
  }, [api, currentScene, messageApi, refineMode, refinePrompt, title]);

  const exportJson = useCallback(() => {
    const scene = currentScene();
    const raw = serializeAsJSON(scene.elements as any, scene.appState as any, scene.files as any, 'local');
    downloadBlob(new Blob([raw], { type: 'application/json' }), `${safeFileTitle(title)}.excalidraw`);
  }, [currentScene, title]);

  const exportImage = useCallback(async (format: 'png' | 'svg') => {
    const scene = currentScene();
    const elements = activeElements(scene.elements);
    if (elements.length === 0) {
      messageApi.warning('画布为空');
      return;
    }
    if (format === 'png') {
      const blob = await exportToBlob({
        elements: elements as any,
        appState: { ...scene.appState, exportBackground: true },
        files: scene.files as any,
        mimeType: 'image/png',
        exportPadding: 24,
      });
      downloadBlob(blob, `${safeFileTitle(title)}.png`);
      return;
    }
    const svg = await exportToSvg({
      elements: elements as any,
      appState: { ...scene.appState, exportBackground: true },
      files: scene.files as any,
      exportPadding: 24,
    });
    const raw = new XMLSerializer().serializeToString(svg);
    downloadBlob(new Blob([raw], { type: 'image/svg+xml' }), `${safeFileTitle(title)}.svg`);
  }, [currentScene, messageApi, title]);

  const exportPptx = useCallback(async () => {
    const scene = currentScene();
    const elements = activeElements(scene.elements);
    if (elements.length === 0) {
      messageApi.warning('画布为空');
      return;
    }
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'OpenAtlas';
    pptx.subject = 'Atlas creative whiteboard export';
    pptx.title = title;
    pptx.company = 'OpenAtlas';
    const slideFrames = findPptSlideFrames(elements);
    if (slideFrames.length > 1) {
      for (const frame of slideFrames) {
        const slideElements = elementsInsideFrame(elements, frame);
        const blob = await exportToBlob({
          elements: slideElements as any,
          appState: { ...scene.appState, exportBackground: true },
          files: scene.files as any,
          mimeType: 'image/png',
          exportPadding: 8,
          maxWidthOrHeight: 2400,
        });
        const data = await blobToDataUrl(blob);
        const slide = pptx.addSlide();
        slide.background = { color: 'FFFFFF' };
        slide.addImage({ data, x: 0, y: 0, w: 13.33, h: 7.5, sizing: { type: 'contain', x: 0, y: 0, w: 13.33, h: 7.5 } });
      }
      await pptx.writeFile({ fileName: `${safeFileTitle(title)}.pptx` });
      return;
    }
    const blob = await exportToBlob({
      elements: elements as any,
      appState: { ...scene.appState, exportBackground: true },
      files: scene.files as any,
      mimeType: 'image/png',
      exportPadding: 32,
      maxWidthOrHeight: 2400,
    });
    const data = await blobToDataUrl(blob);
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addImage({ data, x: 0.25, y: 0.2, w: 12.83, h: 7.1, sizing: { type: 'contain', x: 0.25, y: 0.2, w: 12.83, h: 7.1 } });
    slide.addNotes(`Exported from Atlas 创意白板: ${title}`);
    await pptx.writeFile({ fileName: `${safeFileTitle(title)}.pptx` });
  }, [currentScene, messageApi, title]);

  const handleImportFile = useCallback(async (file: File) => {
    try {
      const raw = await file.text();
      const json = JSON.parse(raw);
      const nextTitle = file.name.replace(/\.excalidraw$|\.json$/i, '') || '导入白板';
      setCurrentId(null);
      setTitle(nextTitle);
      setDescription('');
      setKind('freeform');
      applyScene(json, { nextTitle, nextKind: 'freeform' });
      setDirty(true);
      messageApi.success('白板文件已导入');
    } catch (e: any) {
      messageApi.error(`导入失败: ${e?.message || e}`);
    }
  }, [applyScene, messageApi]);

  const handleLoadExample = useCallback(async (example: ExcalidrawExample) => {
    setLoadingExampleKey(example.key);
    try {
      const response = await fetch(`/excalidraw-examples/${example.file}`);
      if (!response.ok) throw new Error(`无法加载示例: ${example.title}`);
      const scene = await response.json();
      setCurrentId(null);
      setTitle(example.title);
      setDescription(example.summary || '');
      setKind(example.kind || 'freeform');
      setHandoffPrompt('');
      applyScene(scene, { nextTitle: example.title, nextKind: example.kind || 'freeform' });
      setDirty(true);
      messageApi.success('已载入 Excalidraw 示例');
    } catch (e: any) {
      messageApi.error(e?.message || '载入示例失败');
    } finally {
      setLoadingExampleKey(null);
    }
  }, [applyScene, messageApi]);

  const buildPrompt = useCallback(async () => {
    try {
      const result = await readWhiteboard({ scene: currentScene(), target: promptTarget, title });
      setHandoffPrompt(result.prompt);
      setPromptModalOpen(true);
    } catch (e: any) {
      messageApi.error(`转换失败: ${e?.message || e}`);
    }
  }, [currentScene, messageApi, promptTarget, title]);

  const copyPrompt = useCallback(async () => {
    if (!handoffPrompt.trim()) return;
    await navigator.clipboard.writeText(handoffPrompt);
    messageApi.success('提示词已复制');
  }, [handoffPrompt, messageApi]);

  const sendToAtlas = useCallback(() => {
    if (!handoffPrompt.trim()) return;
    localStorage.setItem('atlas.whiteboard.handoff', JSON.stringify({
      title,
      prompt: handoffPrompt,
      source: currentId,
      created_at: new Date().toISOString(),
    }));
    navigate('/overview?whiteboard=handoff');
  }, [currentId, handoffPrompt, navigate, title]);

  return (
    <div className="whiteboard-page">
      {contextHolder}
      <input
        ref={fileInputRef}
        type="file"
        accept=".excalidraw,.json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void handleImportFile(file);
        }}
      />
      <aside className="whiteboard-docs">
        <div className="whiteboard-docs-head">
          <div>
            <div className="admin-kicker">Creative Canvas</div>
            <h1 className="whiteboard-title">创意白板</h1>
          </div>
          <Tooltip title="新建白板">
            <Button icon={<PlusOutlined />} onClick={handleNew} />
          </Tooltip>
        </div>
        <div className="whiteboard-doc-list">
          {loadingDocs ? (
            <div className="whiteboard-muted">加载中...</div>
          ) : documents.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无白板" />
          ) : documents.map((doc) => (
            <button
              key={doc.id}
              className={`whiteboard-doc-item ${doc.id === currentId ? 'is-active' : ''}`}
              onClick={() => void handleOpen(doc.id)}
            >
              <span className="whiteboard-doc-name">{doc.title}</span>
              <span className="whiteboard-doc-meta">{doc.kind || 'freeform'} · {doc.element_count || 0}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="whiteboard-main">
        <div className="whiteboard-toolbar">
          <div className="whiteboard-name">
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
              variant="borderless"
            />
            <span>{currentDoc ? '已打开' : '本地草稿'} · {elementCount} 元素 {dirty ? '· 未保存' : ''}</span>
          </div>
          <div className="whiteboard-toolbar-actions">
            <Tooltip title="导入 .excalidraw">
              <Button icon={<ImportOutlined />} onClick={() => fileInputRef.current?.click()} />
            </Tooltip>
            <Tooltip title="保存">
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()} />
            </Tooltip>
            <Tooltip title="导出 JSON">
              <Button icon={<DownloadOutlined />} onClick={exportJson} />
            </Tooltip>
            <Tooltip title="导出 PNG">
              <Button icon={<FileImageOutlined />} onClick={() => void exportImage('png')} />
            </Tooltip>
            <Tooltip title="导出 SVG">
              <Button icon={<FileTextOutlined />} onClick={() => void exportImage('svg')} />
            </Tooltip>
            <Tooltip title="导出 PPTX">
              <Button icon={<FilePptOutlined />} onClick={() => void exportPptx()} />
            </Tooltip>
            <Popconfirm title="删除当前白板？" okText="删除" cancelText="取消" disabled={!currentId} onConfirm={() => void handleDelete()}>
              <Button icon={<DeleteOutlined />} disabled={!currentId} danger />
            </Popconfirm>
          </div>
        </div>

        <div className="whiteboard-canvas-wrap">
          <Excalidraw
            excalidrawAPI={(nextApi) => {
              const nextExcalidrawApi = nextApi as unknown as ExcalidrawApi;
              setApi(nextExcalidrawApi);
              const installOfficialLibrary = async () => {
                const officialLibraryItems = await loadOfficialExcalidrawLibraryItems();
                if (nextExcalidrawApi.setLibrary) {
                  await nextExcalidrawApi.setLibrary((latestLibraryItems = []) => [
                    ...latestLibraryItems.filter((item) => !isAtlasSeededLibraryItem(item)),
                    ...officialLibraryItems,
                  ]);
                  return;
                }
                await nextExcalidrawApi.updateLibrary?.({
                  libraryItems: officialLibraryItems,
                  merge: true,
                  prompt: false,
                  defaultStatus: 'published',
                });
              };
              void installOfficialLibrary().catch((e) => {
                messageApi.warning(e?.message || 'Excalidraw 素材库加载失败');
              });
            }}
            initialData={EMPTY_SCENE as any}
            langCode="zh-CN"
            aiEnabled={false}
            onChange={(elements, appState, files) => {
              sceneRef.current = {
                ...EMPTY_SCENE,
                elements: elements as any[],
                appState: {
                  viewBackgroundColor: appState.viewBackgroundColor || '#ffffff',
                  gridSize: appState.gridSize || 20,
                  theme: appState.theme,
                  name: title,
                },
                files: files as any,
              };
              setElementCount(activeElements(elements as any[]).length);
              if (suppressNextChangeRef.current || Date.now() < suppressChangeUntilRef.current) {
                suppressNextChangeRef.current = false;
              } else {
                setDirty(true);
              }
            }}
          />
        </div>
      </main>

      <aside className="whiteboard-skills">
        <section className="whiteboard-panel">
          <div className="whiteboard-panel-title">
            <BulbOutlined />
            Atlas Skills
          </div>
          <Select
            value={draftKind}
            onChange={setDraftKind}
            options={DRAFT_KINDS}
          />
          <Input.TextArea
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
            rows={4}
            placeholder="例如：帮我梳理企业客户从线索到交付的流程"
          />
          <Button type="primary" icon={<NodeIndexOutlined />} loading={generating} onClick={() => void handleGenerate()}>
            生成初稿
          </Button>
        </section>

        <section className="whiteboard-panel">
          <div className="whiteboard-panel-title">
            <DeploymentUnitOutlined />
            二次编辑
          </div>
          <Select
            value={refineMode}
            onChange={setRefineMode}
            options={[
              { value: 'append', label: '追加建议' },
              { value: 'polish', label: '文案精修' },
              { value: 'restructure', label: '结构重排' },
              { value: 'replace', label: '替换草案' },
            ]}
          />
          <Input.TextArea
            value={refinePrompt}
            onChange={(e) => setRefinePrompt(e.target.value)}
            rows={3}
            placeholder="例如：补充风险、假设和下一步行动"
          />
          <Button icon={<DeploymentUnitOutlined />} loading={refining} onClick={() => void handleRefine()}>
            追加修改建议
          </Button>
        </section>

        <section className="whiteboard-panel">
          <div className="whiteboard-panel-title">
            <SendOutlined />
            画布转提示词
          </div>
          <Select
            value={promptTarget}
            onChange={setPromptTarget}
            options={[
              { value: '方案', label: '方案' },
              { value: '代码', label: '代码' },
              { value: 'PPT 文案', label: 'PPT 文案' },
              { value: '流程说明', label: '流程说明' },
            ]}
          />
          <Button icon={<SendOutlined />} onClick={() => void buildPrompt()}>
            生成并发送
          </Button>
        </section>

        <section className="whiteboard-panel">
          <div className="whiteboard-panel-title">
            <AppstoreOutlined />
            图标库
          </div>
          {['通用', 'IT', 'AI'].map((group) => (
            <div key={group} className="whiteboard-icon-group">
              <div className="whiteboard-icon-group-title">{group}</div>
              <div className="whiteboard-icon-grid">
                {ICON_LIBRARY.filter((item) => item.category === group).map((item) => (
                  <Tooltip title={item.label} key={item.key}>
                    <button className="whiteboard-icon-btn" onClick={() => insertIcon(item)} style={{ color: item.color }}>
                      {item.icon}
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="whiteboard-panel">
          <div className="whiteboard-panel-title">
            <FolderOpenOutlined />
            模板库
          </div>
          <div className="whiteboard-template-grid">
            {TEMPLATE_CARDS.map((item) => (
              <button
                key={`${item.kind}-${item.title}`}
                className="whiteboard-template-card"
                onClick={() => void handleGenerate({ kind: item.kind, prompt: item.prompt, title: item.title })}
              >
                <span>{item.title}</span>
                <small>{DRAFT_KINDS.find((k) => k.value === item.kind)?.label}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="whiteboard-panel">
          <div className="whiteboard-panel-title">
            <FileSearchOutlined />
            Excalidraw 最佳实践
          </div>
          <div className="whiteboard-best-practice">
            <span>开放 JSON</span>
            <span>MIT 模板</span>
            <span>官方素材库</span>
          </div>
          <div className="whiteboard-example-list">
            {examples.map((example) => (
              <button
                key={example.key}
                className="whiteboard-example-card"
                onClick={() => void handleLoadExample(example)}
                disabled={loadingExampleKey === example.key}
              >
                <span>{example.title}</span>
                <small>{example.summary}</small>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <Modal
        open={promptModalOpen}
        title="画布提示词"
        onCancel={() => setPromptModalOpen(false)}
        footer={[
          <Button key="copy" onClick={() => void copyPrompt()}>复制</Button>,
          <Button key="send" type="primary" onClick={sendToAtlas}>发送到工作台</Button>,
        ]}
        width={760}
      >
        <Input.TextArea value={handoffPrompt} onChange={(e) => setHandoffPrompt(e.target.value)} rows={14} />
      </Modal>
    </div>
  );
}
