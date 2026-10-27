/**
 * OpenMedViewer (全能医学影像阅片器) - 核心类型定义
 * Framework-Agnostic Medical Imaging Viewer Core Types
 */

export type Modality = 'CT' | 'MR' | 'CR' | 'DX' | 'XA' | 'US' | 'NM' | 'PT' | 'MG' | 'OT';

export interface Point2D {
  x: number;
  y: number;
}

export interface Vector2D {
  x: number;
  y: number;
}

export interface DicomMetadata {
  patientName?: string;
  patientId?: string;
  patientBirthDate?: string;
  patientSex?: string;
  studyDate?: string;
  studyTime?: string;
  studyDescription?: string;
  seriesDescription?: string;
  /** 检查部位 BodyPartExamined (0018,0015)，如 HEAD / CHEST / ABDOMEN */
  bodyPartExamined?: string;
  modality?: Modality | string;
  seriesNumber?: number;
  instanceNumber?: number;
  sliceThickness?: number;
  sliceLocation?: number;
  imagePositionPatient?: [number, number, number];
  imageOrientationPatient?: [number, number, number, number, number, number];
  pixelSpacing?: [number, number]; // [rowSpacing, columnSpacing] in mm
  rows: number;
  columns: number;
  bitsAllocated: number;
  bitsStored: number;
  highBit: number;
  pixelRepresentation: number; // 0 = unsigned, 1 = 2's complement signed
  samplesPerPixel: number;
  photometricInterpretation: 'MONOCHROME1' | 'MONOCHROME2' | 'RGB' | 'PALETTE COLOR' | string;
  windowCenter: number[];
  windowWidth: number[];
  rescaleIntercept: number;
  rescaleSlope: number;
  sopInstanceUID?: string;
  seriesInstanceUID?: string;
  studyInstanceUID?: string;
  /** 多帧 DICOM (超声/XA/造影) 的帧数 */
  numberOfFrames?: number;
  /** 传输语法 UID (判断是否压缩) */
  transferSyntaxUID?: string;
  rawTags?: Record<string, { vr: string; value: any; name?: string }>;
}

export interface DicomImage {
  id: string;
  metadata: DicomMetadata;
  pixelData: Int16Array | Uint16Array | Uint8Array | Uint8ClampedArray | Float32Array;
  width: number;
  height: number;
  minPixelValue: number;
  maxPixelValue: number;
  defaultWindowCenter: number;
  defaultWindowWidth: number;
}

export interface ViewportState {
  zoom: number;
  pan: Point2D;
  rotation: number; // in degrees, e.g. 0, 90, 180, 270
  flipH: boolean;
  flipV: boolean;
  invert: boolean;
  windowCenter: number;
  windowWidth: number;
  currentImageIndex: number;
  colormap: 'grayscale' | 'hot-iron' | 'rainbow' | 'pet' | 'bone';
}

export type ToolType =
  | 'none'
  | 'windowLevel'
  | 'pan'
  | 'zoom'
  | 'rotate'
  | 'length'
  | 'angle'
  | 'cobbAngle'
  | 'rectangleRoi'
  | 'ellipseRoi'
  | 'freehandRoi'
  | 'arrow'
  | 'text'
  | 'probe'
  | 'magnify'
  | 'crosshair'
  | 'eraser';

export interface MeasurementData {
  lengthMm?: number;
  angleDeg?: number;
  cobbAngleDeg?: number;
  areaMm2?: number;
  meanHU?: number;
  minHU?: number;
  maxHU?: number;
  stdDevHU?: number;
  probeHU?: number;
  probeCoord?: Point2D;
  text?: string;
}

export interface Measurement {
  id: string;
  type: ToolType;
  imageIndex: number;
  points: Point2D[];
  color?: string;
  data: MeasurementData;
  active?: boolean;
  locked?: boolean;
}

export interface PresetWindowLevel {
  name: string;
  nameZh: string;
  windowCenter: number;
  windowWidth: number;
  modality?: Modality;
}

export type ViewportLayout = '1x1' | '1x2' | '2x1' | '2x2' | '1x3' | '3x3';

// ==================== 云存储与数据源配置类型 ====================

export type CloudSourceType =
  | 'local'
  | 'zip'
  | 'huaweiObs'
  | 'aliyunOss'
  | 'privateS3'
  | 'dicomWeb'
  | 'directUrl'
  | 'syntheticDemo';

export interface LocalSourceConfig {
  type: 'local';
  files?: File[] | FileList;
}

export interface HuaweiObsConfig {
  type: 'huaweiObs';
  endpoint: string; // e.g. "obs.cn-north-4.myhuaweicloud.com"
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  securityToken?: string;
  prefix?: string;
  keys?: string[]; // specific object keys
  usePresignedUrls?: boolean;
}

export interface AliyunOssConfig {
  type: 'aliyunOss';
  region: string; // e.g. "oss-cn-hangzhou"
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  stsToken?: string;
  endpoint?: string;
  prefix?: string;
  keys?: string[];
  usePresignedUrls?: boolean;
}

export interface PrivateS3Config {
  type: 'privateS3'; // MinIO, Ceph, etc.
  endpoint: string; // e.g. "http://192.168.1.100:9000"
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  pathStyle?: boolean; // default true for MinIO
  prefix?: string;
  keys?: string[];
}

export interface DicomWebConfig {
  type: 'dicomWeb';
  wadoRoot: string; // e.g. "https://pacs.hospital.org/dicom-web"
  qidoRoot?: string;
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
  headers?: Record<string, string>; // Bearer auth, custom tokens
}

export interface ZipSourceConfig {
  type: 'zip';
  /** 本地选择的 ZIP 压缩包 (File/Blob) */
  file?: File | Blob;
  /** 或直接指定远程 ZIP 下载地址 */
  url?: string;
  headers?: Record<string, string>;
  /** 是否递归解析 ZIP 内嵌套的 ZIP 包，默认 true */
  recursive?: boolean;
  /** 最大导入影像张数，超出部分将被忽略，默认 1000 */
  maxImages?: number;
}

export interface DirectUrlConfig {
  type: 'directUrl';
  urls: string[];
  headers?: Record<string, string>;
}

export interface SyntheticDemoConfig {
  type: 'syntheticDemo';
  sliceCount?: number;
  modality?: 'CT' | 'MR';
}

export type UnifiedImageSourceConfig =
  | LocalSourceConfig
  | ZipSourceConfig
  | HuaweiObsConfig
  | AliyunOssConfig
  | PrivateS3Config
  | DicomWebConfig
  | DirectUrlConfig
  | SyntheticDemoConfig;

// ==================== 事件系统类型 ====================

export interface ViewerEvents {
  imageLoaded: { image: DicomImage; index: number; total: number };
  imageChanged: { image: DicomImage; index: number };
  viewportUpdated: { state: ViewportState };
  toolChanged: { activeTool: ToolType };
  measurementAdded: { measurement: Measurement };
  measurementUpdated: { measurement: Measurement };
  measurementRemoved: { measurementId: string };
  measurementsCleared: void;
  layoutChanged: { layout: ViewportLayout };
  cineStateChanged: { isPlaying: boolean; fps: number; frame: number };
  error: { code: string; message: string; details?: any };
}
