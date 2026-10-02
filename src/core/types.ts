// 全局共享类型定义。业务尺寸统一毫米（plan.md §2.3）。

export type PartKind = 'shaft' | 'butt' | 'ring' | 'joint' | 'grip' | 'tip' | 'endcap';

/** 杆身旋转体部件（沿轴截面旋转一周的外表面） */
export interface SegmentSpec {
  id: string;
  kind: PartKind;
  name: string;
  /** 轴向范围 mm，0 = 杆头顶端 */
  a0: number;
  a1: number;
  /** 两端半径 mm */
  r0: number;
  r1: number;
  /** 默认材质预设 id */
  matPreset: string;
  /** 是否参与印刷（生产 PNG 内容来源） */
  printEnabled: boolean;
}

/** 端面（盘面）：后把端面可印刷，皮头端面仅材质可编辑 */
export interface FaceSpec {
  id: string;
  name: string;
  /** 端面所在轴向位置 mm */
  a: number;
  radius: number;
  /** 法线方向：+1 朝杆尾（后把端面），-1 朝杆头（皮头端面） */
  normalSign: 1 | -1;
  matPreset: string;
  printEnabled: boolean;
}

export interface CueTemplate {
  id: string;
  name: string;
  family: '九球杆／花式杆／大头杆';
  tipDiameterMm: number;
  lengthMm: number;
  shaftLengthMm: number;
  buttLengthMm: number;
  jointDiameterMm: number;
  buttDiameterMm: number;
  segments: SegmentSpec[];
  faces: FaceSpec[];
  sizeStatus: '用户指定尺寸' | '已校准尺寸';
  /** 尺寸来源说明 */
  sizeSource: string;
}

export type FinishId = 'gloss' | 'semi' | 'matte';

export type SurfaceTarget =
  | { kind: 'lathe'; segId: string; a: number; angDeg: number }
  | { kind: 'face'; faceId: string; fx: number; fz: number };

/** 贴纸实例：位置与模型表面坐标绑定，不与相机绑定（plan.md §3.4） */
export interface StickerInstance {
  id: string;
  name: string;
  assetId: string;
  /** 实例级处理图（抠图结果）在 IndexedDB 的键；为空时使用素材原图 */
  processedKey?: string;
  processedRev: number;
  target: SurfaceTarget;
  /** 实际宽高 mm */
  w: number;
  h: number;
  /** 图案自身旋转（面内），deg */
  rotDeg: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
  /** 图层顺序，大者在上 */
  z: number;
  hidden: boolean;
  locked: boolean;
}

/** 部件属性覆盖（全局默认值 + 部件覆盖，plan.md §3.2） */
export interface PartOverride {
  matPreset?: string;
  color?: string;
  finish?: FinishId;
}

export interface DesignSnapshot {
  name: string;
  cueTemplateId: string;
  partOverrides: Record<string, PartOverride>;
  globalFinish: FinishId;
  stickers: StickerInstance[];
}

export interface Asset {
  id: string;
  name: string;
  source: 'upload' | 'ai';
  tags: string[];
  w: number;
  h: number;
  /** IndexedDB 中原始图像 blob 的键 */
  blobKey: string;
  createdAt: number;
  aiPrompt?: string;
  aiModel?: string;
  /** 联动方案的原始母图或分部位图案，保留任务关联以便从素材库回到方案 */
  aiJobId?: string;
  aiPartId?: string;
  originalBlobKey?: string;
  revision?: number;
  processingWarning?: string;
  removed?: boolean;
}

export interface ArtworkPart {
  id: string;
  name: string;
  kind: 'lathe' | 'face';
  wMm: number;
  hMm: number;
  role: string;
  material: string;
}

export interface ArtworkScope {
  mode: 'linked' | 'single';
  /** Missing on older jobs: preserve their original proportional placement. */
  textureMode?: 'decal' | 'wrap';
  cueTemplateId: string;
  cueTemplateName: string;
  parts: ArtworkPart[];
}

export interface ArtworkCandidate {
  id: string;
  masterAssetId?: string;
  partAssets: { partId: string; assetId: string }[];
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'needs-review';

export interface GenerationJob {
  id: string;
  status: JobStatus;
  mode: 'generate' | 'edit';
  createdAt: number;
  updatedAt: number;
  model: string;
  size: string;
  /** 输入快照（不含密钥） */
  input: {
    subject: string;
    style: string;
    palette: string;
    keep: string;
    avoid: string;
    refAssetIds: string[];
    n: number;
    /** 可选以兼容已有普通图案任务 */
    scope?: ArtworkScope;
    removeWhite?: boolean;
  };
  prompt: string;
  resultAssetIds: string[];
  candidates?: ArtworkCandidate[];
  progress?: { done: number; total: number; label: string };
  error?: string;
}

export interface DesignVersion {
  id: string;
  name: string;
  note: string;
  createdAt: number;
  cueTemplateId: string;
  snapshot: DesignSnapshot;
  thumb?: string;
}

export interface Product {
  id: string;
  name: string;
  desc: string;
  cover?: string;
  versionId: string;
  createdAt: number;
}

export interface ExportRecord {
  id: string;
  createdAt: number;
  designName: string;
  versionId?: string;
  ppi: number;
  sheetWmm: number;
  sheetHmm: number;
  pxW: number;
  pxH: number;
  blockCount: number;
  templateVersion: string;
  fileName: string;
}

export type DisplayQuality = 'fast' | 'balanced' | 'sharp';
