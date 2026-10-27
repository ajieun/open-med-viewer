import { DicomImage, DicomMetadata } from '../types';

/**
 * Cornerstone3D 解码桥接层
 *
 * 集成 @cornerstonejs/core + @cornerstonejs/dicom-image-loader，用于解码
 * 内置解析器无法处理的像素格式：
 *   - 压缩传输语法 (JPEG Baseline / JPEG Lossless / JPEG-LS / JPEG 2000 / JPEG-XL / HTJ2K)
 *   - 彩色影像 (RGB / YBR / PALETTE COLOR)
 *   - 需要复杂颜色空间与 LUT 转换的数据集
 *
 * 这些依赖体积较大（含 WASM 编解码器与 Web Worker），因此采用动态 import 懒加载：
 * 只有遇到压缩/彩色 DICOM 时才会真正加载，普通未压缩序列不受影响。
 */

type AnyLoader = any;

let loaderPromise: Promise<AnyLoader | null> | null = null;
let loaderUnavailable = false;
let wasmBasePathOverride: string | undefined;

/**
 * 自定义 WASM 编解码器目录 (默认使用 <base>/wasm/)
 * 若宿主项目把 wasm 放在其它路径，可在初始化前调用：
 * `CornerstoneImageDecoder.setWasmBasePath('/static/wasm/')`
 */
function resolveWasmBasePath(): string {
  if (wasmBasePathOverride) return wasmBasePathOverride;
  try {
    if (typeof document !== 'undefined' && document.baseURI) {
      return new URL('wasm/', document.baseURI).href;
    }
  } catch {
    // ignore
  }
  return 'wasm/';
}

/** 已知的压缩传输语法 (Encapsulated Pixel Data) */
export const COMPRESSED_TRANSFER_SYNTAXES = new Set<string>([
  '1.2.840.10008.1.2.4.50', // JPEG Baseline (Process 1)
  '1.2.840.10008.1.2.4.51', // JPEG Extended (Process 2 & 4)
  '1.2.840.10008.1.2.4.57', // JPEG Lossless (Process 14)
  '1.2.840.10008.1.2.4.70', // JPEG Lossless SV1 (Process 14, Selection Value 1)
  '1.2.840.10008.1.2.4.80', // JPEG-LS Lossless
  '1.2.840.10008.1.2.4.81', // JPEG-LS Near-Lossless
  '1.2.840.10008.1.2.4.90', // JPEG 2000 Lossless Only
  '1.2.840.10008.1.2.4.91', // JPEG 2000
  '1.2.840.10008.1.2.4.92', // JPEG 2000 Part 2 Multi-component Lossless
  '1.2.840.10008.1.2.4.93', // JPEG 2000 Part 2 Multi-component
  '1.2.840.10008.1.2.4.94', // JPIP Referenced
  '1.2.840.10008.1.2.4.95', // JPIP Referenced Deflate
  '1.2.840.10008.1.2.4.100', // MPEG2 Main Profile @ Main Level
  '1.2.840.10008.1.2.4.101', // MPEG2 Main Profile @ High Level
  '1.2.840.10008.1.2.4.102', // MPEG-4 AVC/H.264 High Profile
  '1.2.840.10008.1.2.4.103', // MPEG-4 AVC/H.264 BD-compatible
  '1.2.840.10008.1.2.4.104', // MPEG-4 AVC/H.264 High Profile 2D
  '1.2.840.10008.1.2.4.105', // MPEG-4 AVC/H.264 3D
  '1.2.840.10008.1.2.4.106', // MPEG-4 AVC/H.264 Stereo
  '1.2.840.10008.1.2.4.107', // HEVC/H.265
  '1.2.840.10008.1.2.4.108', // HEVC/H.265 BD
  '1.2.840.10008.1.2.4.110', // JPEG XL Lossless
  '1.2.840.10008.1.2.4.111', // JPEG XL
  '1.2.840.10008.1.2.4.112', // JPEG XL
  '1.2.840.10008.1.2.4.201', // High-Throughput JPEG 2000 Lossless
  '1.2.840.10008.1.2.4.202', // High-Throughput JPEG 2000
  '1.2.840.10008.1.2.4.203' // High-Throughput JPEG 2000 RPCL
]);

export interface DecodeResult {
  image: DicomImage;
  /** loader 内部解析出的数据集 (可用于补充元数据) */
  dataSet?: any;
}

class CornerstoneImageDecoder {
  /**
   * 懒加载并初始化 cornerstone core + dicom-image-loader
   */
  static async getLoader(): Promise<AnyLoader | null> {
    if (loaderUnavailable) return null;
    if (loaderPromise) return loaderPromise;

    loaderPromise = (async () => {
      try {
        const [loaderModule, coreModule] = await Promise.all([
          import('@cornerstonejs/dicom-image-loader'),
          import('@cornerstonejs/core')
        ]);

        const loader: AnyLoader = (loaderModule as any).default || loaderModule;
        const core: AnyLoader = (coreModule as any).default || coreModule;

        try {
          core?.init?.();
        } catch (e) {
          // core 可能已被初始化，忽略
        }

        const hardware = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 1;
        const wasmBasePath = resolveWasmBasePath();
        loader.init({
          maxWebWorkers: Math.max(1, Math.min(4, Math.floor(hardware / 2))),
          wasmBasePath,
          decodeConfig: { wasmBasePath },
          // 使用经典元数据 provider，兼容性更好（新版 naturalized provider 需要额外注册）
          useLegacyMetadataProvider: true
        });
        return loader;
      } catch (e) {
        console.warn('[OpenMed] Cornerstone DICOM 解码器加载失败，将使用内置解析器:', e);
        loaderUnavailable = true;
        return null;
      }
    })();

    return loaderPromise;
  }

  static isAvailable(): boolean {
    return !loaderUnavailable;
  }

  /**
   * 指定 WASM 编解码器所在目录（需在首次解码前调用）
   */
  static setWasmBasePath(path: string): void {
    wasmBasePathOverride = path.endsWith('/') ? path : `${path}/`;
  }

  /**
   * 使用 dicom-image-loader 解码单帧 (支持压缩传输语法与彩色影像)
   */
  static async decode(buffer: ArrayBuffer, id: string): Promise<DecodeResult> {
    const loader = await this.getLoader();
    if (!loader) {
      throw new Error('Cornerstone DICOM 解码器不可用 (可能缺少 Web Worker / SharedArrayBuffer 支持)');
    }

    const blob = new Blob([new Uint8Array(buffer)], { type: 'application/dicom' });
    const imageId: string = loader.wadouri.fileManager.add(blob);

    try {
      const loadObject = loader.wadouri.loadImage(imageId);
      let image: any;
      try {
        image = await loadObject.promise;
      } catch (rejection: any) {
        // dicom-image-loader 的拒绝值形如 { error, dataSet }，这里统一成 Error
        const inner = rejection?.error ?? rejection;
        const message = inner?.message || (typeof inner === 'string' ? inner : JSON.stringify(inner));
        throw new Error(message || 'DICOM 解码失败');
      }

      const dataSet: any = image.data || tryGetCachedDataSet(loader, imageId);
      const decoded = toDicomImage(image, id, dataSet);
      return { image: decoded, dataSet };
    } finally {
      try {
        const index = Number(String(imageId).replace(/^dicomfile:/, '').split('?')[0]);
        if (!Number.isNaN(index)) loader.wadouri.fileManager.remove(index);
      } catch {
        // ignore
      }
    }
  }
}

function tryGetCachedDataSet(loader: AnyLoader, imageId: string): any {
  try {
    const cache = loader?.wadouri?.dataSetCacheManager;
    return cache?.get?.(imageId);
  } catch {
    return undefined;
  }
}

/**
 * 将 cornerstone IImage 转换为内部统一的 DicomImage 结构
 */
export function toDicomImage(image: any, id: string, dataSet?: any): DicomImage {
  const width: number = image.width || image.columns || 0;
  const height: number = image.height || image.rows || 0;
  if (!width || !height) {
    throw new Error('Cornerstone 解码结果缺少影像尺寸');
  }

  const isColor = image.color === true;
  let pixelData: Int16Array | Uint16Array | Uint8Array | Float32Array;
  let minPixelValue = image.minPixelValue ?? 0;
  let maxPixelValue = image.maxPixelValue ?? 255;

  if (isColor) {
    // 彩色影像 (内镜/超声/病理/彩色 DICOM): 使用 loader 渲染好的 canvas 转灰度亮度
    const canvas: HTMLCanvasElement = image.getCanvas();
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const out = new Uint16Array(canvas.width * canvas.height);
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.round(
        0.299 * imgData.data[i * 4] + 0.587 * imgData.data[i * 4 + 1] + 0.114 * imgData.data[i * 4 + 2]
      );
    }
    pixelData = out;
    minPixelValue = 0;
    maxPixelValue = 255;
  } else {
    const raw = image.getPixelData() as any;
    pixelData = raw instanceof Float32Array ? raw : raw;
    minPixelValue = image.minPixelValue ?? computeMin(raw);
    maxPixelValue = image.maxPixelValue ?? computeMax(raw);
  }

  const slope = typeof image.slope === 'number' ? image.slope : 1;
  const intercept = typeof image.intercept === 'number' ? image.intercept : 0;
  const windowCenter = toNumberArray(image.windowCenter);
  const windowWidth = toNumberArray(image.windowWidth);

  const fallbackWC = windowCenter[0] ?? Math.round((minPixelValue * slope + intercept + maxPixelValue * slope + intercept) / 2);
  const fallbackWW = windowWidth[0] ?? Math.max(1, Math.round((maxPixelValue - minPixelValue) * slope));

  const metadata: DicomMetadata = {
    rows: height,
    columns: width,
    bitsAllocated: dataSet?.uint16?.('x00280100') || 16,
    bitsStored: dataSet?.uint16?.('x00280101') || 16,
    highBit: dataSet?.uint16?.('x00280102') || 15,
    pixelRepresentation: dataSet?.uint16?.('x00280103') ?? (slope !== 1 || intercept !== 0 ? 1 : 0),
    samplesPerPixel: isColor ? 3 : 1,
    photometricInterpretation: dataSet?.string?.('x00280004') || (isColor ? 'RGB' : 'MONOCHROME2'),
    windowCenter: windowCenter.length ? windowCenter : [fallbackWC],
    windowWidth: windowWidth.length ? windowWidth : [fallbackWW],
    rescaleIntercept: intercept,
    rescaleSlope: slope,
    pixelSpacing: parsePixelSpacing(dataSet?.string?.('x00280030')),
    sliceThickness: parseFloatSafe(dataSet?.string?.('x00180050')),
    sliceLocation: parseFloatSafe(dataSet?.string?.('x00201041')),
    patientName: dataSet?.string?.('x00100010') || 'ANONYMOUS',
    patientId: dataSet?.string?.('x00100020') || 'UNKNOWN',
    patientBirthDate: dataSet?.string?.('x00100030'),
    patientSex: dataSet?.string?.('x00100040'),
    studyDate: dataSet?.string?.('x00080020'),
    studyTime: dataSet?.string?.('x00080030'),
    studyDescription: dataSet?.string?.('x00081030'),
    seriesDescription: dataSet?.string?.('x0008103e'),
    bodyPartExamined: dataSet?.string?.('x00180015')?.trim() || undefined,
    modality: dataSet?.string?.('x00080060') || 'OT',
    seriesNumber: dataSet?.intString?.('x00200011') || 1,
    instanceNumber: dataSet?.intString?.('x00200013') || 1,
    seriesInstanceUID: dataSet?.string?.('x0020000e'),
    studyInstanceUID: dataSet?.string?.('x0020000d'),
    sopInstanceUID: dataSet?.string?.('x00080018'),
    numberOfFrames: parseIntSafe(dataSet?.string?.('x00280008')),
    transferSyntaxUID: dataSet?.string?.('x00020010')
  };

  return {
    id,
    metadata,
    pixelData,
    width,
    height,
    minPixelValue,
    maxPixelValue,
    defaultWindowCenter: fallbackWC,
    defaultWindowWidth: fallbackWW
  };
}

function toNumberArray(value: any): number[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map(Number).filter((v) => !Number.isNaN(v));
  const n = Number(value);
  return Number.isNaN(n) ? [] : [n];
}

function computeMin(data: any): number {
  let min = Infinity;
  for (let i = 0; i < data.length; i++) if (data[i] < min) min = data[i];
  return min === Infinity ? 0 : min;
}

function computeMax(data: any): number {
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i];
  return max === -Infinity ? 255 : max;
}

function parsePixelSpacing(value?: string): [number, number] | undefined {
  if (!value) return undefined;
  const parts = value.split('\\').map(Number);
  if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
    return [parts[0], parts[1]];
  }
  return undefined;
}

function parseFloatSafe(value?: string): number | undefined {
  if (!value) return undefined;
  const n = parseFloat(value);
  return Number.isNaN(n) ? undefined : n;
}

function parseIntSafe(value?: string): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

export { CornerstoneImageDecoder };
