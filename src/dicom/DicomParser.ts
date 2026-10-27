import dicomParser from 'dicom-parser';
import { DicomImage, DicomMetadata } from '../types';
import { CornerstoneImageDecoder, COMPRESSED_TRANSFER_SYNTAXES } from './CornerstoneImageDecoder';

/**
 * 压缩 (Encapsulated) 像素数据异常：需要交给 Cornerstone dicom-image-loader 解码
 */
export class EncapsulatedPixelDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncapsulatedPixelDataError';
  }
}

export class DicomParser {
  /**
   * 是否带 DICOM Part 10 前导 (128 字节 + "DICM")
   */
  static isDicom(bytes: Uint8Array): boolean {
    return (
      bytes.length >= 132 &&
      bytes[128] === 0x44 &&
      bytes[129] === 0x49 &&
      bytes[130] === 0x43 &&
      bytes[131] === 0x4d
    );
  }

  /**
   * 宽松嗅探：用于压缩包/文件夹里没有扩展名的 DICOM 文件
   */
  static looksLikeDicom(bytes: Uint8Array): boolean {
    if (DicomParser.isDicom(bytes)) return true;
    if (bytes.length < 8) return false;
    // 无前导的裸数据集：检查首个标签组是否为常见 DICOM 组
    const group = bytes[0] | (bytes[1] << 8);
    const element = bytes[2] | (bytes[3] << 8);
    const commonGroups = [0x0002, 0x0008, 0x0010, 0x0018, 0x0020, 0x0028];
    return commonGroups.includes(group) && element <= 0x0200;
  }

  /**
   * 同步解析 (仅支持未压缩传输语法，多帧返回全部帧)
   */
  static parse(buffer: ArrayBuffer, id: string = `img_${Date.now()}`): DicomImage {
    const dataSet = DicomParser.parseDataSet(new Uint8Array(buffer));
    return DicomParser.decodeNative(buffer, dataSet, id)[0];
  }

  /**
   * 推荐入口：解析单个 DICOM 文件，返回一张或多张 (多帧) 影像。
   *
   * 自动按需调度：
   *   1. 未压缩 (Implicit/Explicit VR LE/BE、Deflated) -> 内置快速解析
   *   2. 压缩 (JPEG / JPEG-LS / JPEG2000 / JXL / HTJ2K) -> Cornerstone dicom-image-loader
   *   3. 非标准 / 内嵌彩色 -> Cornerstone 兜底
   */
  static async parseAsync(buffer: ArrayBuffer, id: string = `img_${Date.now()}`): Promise<DicomImage[]> {
    const bytes = new Uint8Array(buffer);

    let dataSet: any = null;
    let dataSetError: any = null;
    try {
      dataSet = DicomParser.parseDataSet(bytes);
    } catch (e) {
      dataSetError = e;
    }

    const transferSyntax: string | undefined = dataSet?.string?.('x00020010');
    const pixelElement = dataSet?.elements?.x7fe00010;
    const encapsulated =
      pixelElement?.encapsulatedPixelData === true ||
      (!!transferSyntax && COMPRESSED_TRANSFER_SYNTAXES.has(transferSyntax));

    if (encapsulated) {
      try {
        const { image } = await CornerstoneImageDecoder.decode(buffer, id);
        return [image];
      } catch (e) {
        throw new Error(
          `压缩 DICOM 解码失败（传输语法 ${transferSyntax || '未知'}）: ${errorMessage(e)}`
        );
      }
    }

    if (dataSet) {
      try {
        return DicomParser.decodeNative(buffer, dataSet, id);
      } catch (nativeError) {
        // 内置解析失败时使用 Cornerstone 兜底（例如特殊像素格式）
        try {
          const { image } = await CornerstoneImageDecoder.decode(buffer, id);
          return [image];
        } catch {
          throw nativeError instanceof Error ? nativeError : new Error(String(nativeError));
        }
      }
    }

    try {
      const { image } = await CornerstoneImageDecoder.decode(buffer, id);
      return [image];
    } catch (e) {
      throw new Error(`DICOM 解析失败: ${errorMessage(dataSetError || e)}`);
    }
  }

  /**
   * 解析数据集 (带容错)
   */
  private static parseDataSet(bytes: Uint8Array): any {
    try {
      return dicomParser.parseDicom(bytes);
    } catch (firstError) {
      try {
        return dicomParser.parseDicom(bytes, { untilTag: '' } as any);
      } catch {
        throw new Error(`DICOM 解析失败: ${errorMessage(firstError)}`);
      }
    }
  }

  /**
   * 未压缩像素数据解码 (支持 8/16/32 位、有符号/无符号、RGB、多帧)
   */
  private static decodeNative(buffer: ArrayBuffer, dataSet: any, id: string): DicomImage[] {
    const meta = DicomParser.extractMetadata(dataSet);

    if (!meta.rows || !meta.columns) {
      throw new Error('无效 DICOM: 缺失 Rows 或 Columns 维度');
    }

    const rows = meta.rows;
    const columns = meta.columns;
    const samples = Math.max(1, meta.samplesPerPixel);
    const frames = Math.max(1, meta.numberOfFrames || 1);

    const pixelElement = dataSet.elements.x7fe00010;
    const floatElement = dataSet.elements.x7fe00008 || dataSet.elements.x7fe00009;
    const element = pixelElement || floatElement;

    if (!element) {
      throw new Error('无效 DICOM: 缺少 PixelData (7FE0,0010)');
    }
    if (element.encapsulatedPixelData) {
      throw new EncapsulatedPixelDataError(
        `压缩像素数据（传输语法 ${meta.transferSyntaxUID || '未知'}）需要外部解码器`
      );
    }

    const bitsAllocated = floatElement ? (floatElement === dataSet.elements.x7fe00009 ? 64 : 32) : meta.bitsAllocated || 16;
    const bytesPerSample = bitsAllocated <= 8 ? 1 : bitsAllocated <= 16 ? 2 : bitsAllocated <= 32 ? 4 : 8;

    const samplesPerFrame = rows * columns * samples;
    const frameBytes = samplesPerFrame * bytesPerSample;
    const expectedBytes = frameBytes * frames;

    const dataOffset: number = element.dataOffset;
    const declaredLength: number = element.length > 0 ? element.length : 0;
    const available = declaredLength > 0
      ? Math.min(declaredLength, buffer.byteLength - dataOffset)
      : buffer.byteLength - dataOffset;

    if (available < frameBytes) {
      throw new Error(
        `像素数据长度不足: 需要 ${frameBytes} 字节，实际仅 ${Math.max(0, available)} 字节`
      );
    }

    // 16/32/64 位数据要求起点按元素大小对齐，否则复制到新的对齐缓冲区
    let viewBuffer: ArrayBuffer = buffer;
    let baseOffset = dataOffset;
    const copyLength = Math.min(available, expectedBytes);
    if (dataOffset % bytesPerSample !== 0) {
      const copy = new Uint8ClampedArray(copyLength);
      copy.set(new Uint8Array(buffer, dataOffset, copyLength));
      viewBuffer = copy.buffer;
      baseOffset = 0;
    }

    const isMonochrome1 = String(meta.photometricInterpretation).toUpperCase() === 'MONOCHROME1';
    const images: DicomImage[] = [];
    const actualFrames = Math.max(1, Math.min(frames, Math.floor(copyLength / frameBytes)));

    for (let frame = 0; frame < actualFrames; frame++) {
      const frameOffset = baseOffset + frame * frameBytes;
      const raw = createTypedArray(viewBuffer, frameOffset, samplesPerFrame, bitsAllocated, meta.pixelRepresentation);

      const converted = samples > 1
        ? colorToLuminance(raw, rows * columns, samples)
        : raw;

      const { min, max } = minMax(converted);

      let wc = meta.windowCenter[0];
      let ww = meta.windowWidth[0];

      if (!ww || ww <= 0 || Number.isNaN(ww)) {
        const huMin = min * meta.rescaleSlope + meta.rescaleIntercept;
        const huMax = max * meta.rescaleSlope + meta.rescaleIntercept;
        ww = Math.max(1, huMax - huMin);
        wc = (huMin + huMax) / 2;
      }

      const frameMeta: DicomMetadata = {
        ...meta,
        photometricInterpretation: isMonochrome1 ? 'MONOCHROME1' : meta.photometricInterpretation,
        instanceNumber: (meta.instanceNumber || 1) + frame
      };

      images.push({
        id: actualFrames > 1 ? `${id}#${frame + 1}` : id,
        metadata: frameMeta,
        pixelData: converted,
        width: columns,
        height: rows,
        minPixelValue: min,
        maxPixelValue: max,
        defaultWindowCenter: wc,
        defaultWindowWidth: ww
      });
    }

    return images;
  }

  private static extractMetadata(dataSet: any): DicomMetadata {
    const rows = dataSet.uint16('x00280010') || 0;
    const columns = dataSet.uint16('x00280011') || 0;
    const bitsAllocated = dataSet.uint16('x00280100') || 16;
    const bitsStored = dataSet.uint16('x00280101') || 12;
    const highBit = dataSet.uint16('x00280102') ?? bitsStored - 1;
    const pixelRepresentation = dataSet.uint16('x00280103') ?? 0;
    const samplesPerPixel = dataSet.uint16('x00280002') || 1;
    const photometricInterpretation = (dataSet.string('x00280004') || 'MONOCHROME2').trim();

    const rescaleIntercept = parseFloat(dataSet.string('x00281052') || '0') || 0;
    const rescaleSlope = parseFloat(dataSet.string('x00281053') || '1') || 1;

    const windowCenter = parseNumberList(dataSet.string('x00281050'));
    const windowWidth = parseNumberList(dataSet.string('x00281051'));

    const spacingStr = dataSet.string('x00280030');
    let pixelSpacing: [number, number] | undefined;
    if (spacingStr) {
      const parts = spacingStr.split('\\').map(Number);
      if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
        pixelSpacing = [parts[0], parts[1]];
      }
    }

    return {
      rows,
      columns,
      bitsAllocated,
      bitsStored,
      highBit,
      pixelRepresentation,
      samplesPerPixel,
      photometricInterpretation,
      windowCenter,
      windowWidth,
      rescaleIntercept,
      rescaleSlope,
      pixelSpacing,
      sliceLocation: toFloat(dataSet.string('x00201041')),
      sliceThickness: toFloat(dataSet.string('x00180050')),
      patientName: dataSet.string('x00100010') || 'ANONYMOUS',
      patientId: dataSet.string('x00100020') || 'UNKNOWN',
      patientBirthDate: dataSet.string('x00100030'),
      patientSex: dataSet.string('x00100040'),
      studyDate: dataSet.string('x00080020'),
      studyTime: dataSet.string('x00080030'),
      studyDescription: dataSet.string('x00081030'),
      seriesDescription: dataSet.string('x0008103e'),
      bodyPartExamined: dataSet.string('x00180015')?.trim() || undefined,
      modality: (dataSet.string('x00080060') || 'OT').trim(),
      instanceNumber: dataSet.intString('x00200013') || 1,
      seriesNumber: dataSet.intString('x00200011') || 1,
      seriesInstanceUID: dataSet.string('x0020000e'),
      studyInstanceUID: dataSet.string('x0020000d'),
      sopInstanceUID: dataSet.string('x00080018'),
      numberOfFrames: parseIntSafe(dataSet.string('x00280008')) || 1,
      transferSyntaxUID: dataSet.string('x00020010') || '1.2.840.10008.1.2.1',
      rawTags: {}
    };
  }

  /**
   * 从普通图片 (JPG, PNG) 转换为 DicomImage 结构 (用于兼容普通病理/内镜/超声等非DICOM截图)
   */
  static fromImageElement(img: HTMLImageElement, id: string = `std_${Date.now()}`): DicomImage {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const numPixels = canvas.width * canvas.height;
    const pixelData = new Uint16Array(numPixels);
    for (let i = 0; i < numPixels; i++) {
      const r = imgData.data[i * 4];
      const g = imgData.data[i * 4 + 1];
      const b = imgData.data[i * 4 + 2];
      pixelData[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }

    const metadata: DicomMetadata = {
      patientName: 'Standard^Image',
      patientId: 'STD-001',
      studyDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      modality: 'OT',
      rows: canvas.height,
      columns: canvas.width,
      bitsAllocated: 8,
      bitsStored: 8,
      highBit: 7,
      pixelRepresentation: 0,
      samplesPerPixel: 1,
      photometricInterpretation: 'MONOCHROME2',
      windowCenter: [128],
      windowWidth: [256],
      rescaleIntercept: 0,
      rescaleSlope: 1,
      pixelSpacing: [0.5, 0.5],
      numberOfFrames: 1
    };

    return {
      id,
      metadata,
      pixelData,
      width: canvas.width,
      height: canvas.height,
      minPixelValue: 0,
      maxPixelValue: 255,
      defaultWindowCenter: 128,
      defaultWindowWidth: 256
    };
  }

  /**
   * 从已解码的 RGBA 像素构建影像 (供彩色影像路径复用)
   */
  static fromRGBA(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    id: string,
    metadata?: Partial<DicomMetadata>
  ): DicomImage {
    const pixelData = new Uint16Array(width * height);
    for (let i = 0; i < pixelData.length; i++) {
      pixelData[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
    }

    const meta: DicomMetadata = {
      rows: height,
      columns: width,
      bitsAllocated: 8,
      bitsStored: 8,
      highBit: 7,
      pixelRepresentation: 0,
      samplesPerPixel: 1,
      photometricInterpretation: 'MONOCHROME2',
      windowCenter: [128],
      windowWidth: [256],
      rescaleIntercept: 0,
      rescaleSlope: 1,
      ...metadata
    };

    return {
      id,
      metadata: meta,
      pixelData,
      width,
      height,
      minPixelValue: 0,
      maxPixelValue: 255,
      defaultWindowCenter: 128,
      defaultWindowWidth: 256
    };
  }
}

// ==================== 工具函数 ====================

function createTypedArray(
  buffer: ArrayBuffer,
  offset: number,
  length: number,
  bitsAllocated: number,
  pixelRepresentation: number
): Int16Array | Uint16Array | Uint8Array | Float32Array {
  if (bitsAllocated <= 8) {
    return new Uint8Array(buffer, offset, length);
  }
  if (bitsAllocated <= 16) {
    return pixelRepresentation === 1
      ? new Int16Array(buffer, offset, length)
      : new Uint16Array(buffer, offset, length);
  }
  if (bitsAllocated <= 32) {
    return pixelRepresentation === 1 || pixelRepresentation === 3
      ? new Int32Array(buffer, offset, length) as any
      : new Float32Array(buffer, offset, length);
  }
  return new Float64Array(buffer, offset, length) as any;
}

/**
 * RGB / YBR 彩色 (多通道) 转灰度亮度
 */
function colorToLuminance(
  raw: Int16Array | Uint16Array | Uint8Array | Float32Array,
  pixelCount: number,
  samples: number
): Uint16Array {
  const out = new Uint16Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const base = i * samples;
    const r = raw[base] || 0;
    const g = raw[base + 1] ?? r;
    const b = raw[base + 2] ?? r;
    out[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return out;
}

function minMax(data: { length: number; [index: number]: number }): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return { min: 0, max: 255 };
  return { min, max };
}

function parseNumberList(value?: string): number[] {
  if (!value) return [];
  return value
    .split('\\')
    .map((v) => Number(v))
    .filter((v) => !Number.isNaN(v));
}

function toFloat(value?: string): number | undefined {
  if (!value) return undefined;
  const n = parseFloat(value);
  return Number.isNaN(n) ? undefined : n;
}

function parseIntSafe(value?: string): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

function errorMessage(e: any): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
