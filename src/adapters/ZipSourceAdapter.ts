import { BaseStorageAdapter, ImageLoadProgress } from './BaseAdapter';
import { ZipSourceConfig, DicomImage } from '../types';
import { DicomParser } from '../dicom/DicomParser';
import { ZipReader, ZipEntry } from '../utils/ZipReader';

/** 明确的影像扩展名 */
const IMAGE_EXT_RE = /\.(dcm|dicom|ima|img|dc3)$/i;
const STANDARD_IMG_RE = /\.(png|jpe?g|bmp|webp|tiff?)$/i;
const ZIP_RE = /\.zip$/i;
const IGNORED_RE = /(^|\/)(__MACOSX|\.DS_Store|\._|Thumbs\.db)/i;
/** 明确不是影像的文件，直接跳过避免无谓解包嗅探 */
const SKIP_EXT_RE = /\.(txt|rtf|xml|json|csv|html?|pdf|log|ini|cfg|db|sql|lnk|url|md|docx?|xlsx?|pptx?|exe|dll|zipx|7z|rar|tar|gz)$/i;
const DICOMDIR_RE = /(^|\/)DICOMDIR$/i;

interface FlatEntry {
  name: string;
  entry: ZipEntry;
  reader: ZipReader;
}

interface ParseFailure {
  name: string;
  message: string;
}

export interface ZipSeriesInfo {
  seriesInstanceUID: string;
  seriesNumber: number;
  seriesDescription?: string;
  modality?: string;
  count: number;
}

/**
 * ZIP 压缩包影像适配器
 *
 * 支持从本地或远程 .zip 中批量导入影像：
 *   - DICOM (含无扩展名 / 无 Part10 前导的裸数据集、压缩传输语法、多帧)
 *   - 常规影像 (PNG/JPG/BMP/WebP/TIFF)
 *   - 嵌套 ZIP、任意目录层级
 *   - 多序列自动分组 + 层面自然排序
 */
export class ZipSourceAdapter extends BaseStorageAdapter<ZipSourceConfig> {
  private reader: ZipReader | null = null;

  async testConnection(): Promise<{ success: boolean; message: string; fileCount?: number }> {
    try {
      const flat = await this.collectEntries();
      const candidates = flat.filter((f) => this.isImageCandidate(f.name, false));
      if (candidates.length === 0) {
        return {
          success: false,
          message: `压缩包内未发现影像文件（共 ${flat.length} 个条目，已忽略 DICOMDIR/文本/系统文件）`,
          fileCount: 0
        };
      }
      const nameless = flat.filter((f) => !IMAGE_EXT_RE.test(f.name) && !STANDARD_IMG_RE.test(f.name)).length;
      return {
        success: true,
        message: `压缩包解析成功：共 ${flat.length} 个条目，${candidates.length} 个可导入影像${nameless > 0 ? `（其中 ${nameless} 个待内容嗅探）` : ''}`,
        fileCount: candidates.length
      };
    } catch (e: any) {
      return { success: false, message: `ZIP 解析失败: ${e?.message || e}` };
    }
  }

  async loadImages(onProgress?: (progress: ImageLoadProgress) => void): Promise<DicomImage[]> {
    const flat = await this.collectEntries();
    if (flat.length === 0) {
      throw new Error('压缩包为空或仅包含目录结构');
    }

    const maxImages = this.config.maxImages ?? 2000;
    const images: DicomImage[] = [];
    const failures: ParseFailure[] = [];
    let attempted = 0;
    let skipped = 0;

    for (let i = 0; i < flat.length && images.length < maxImages; i++) {
      const item = flat[i];

      // 1. 明确可跳过 / 明确可解析的条目快速判定
      if (SKIP_EXT_RE.test(item.name) || DICOMDIR_RE.test(item.name)) {
        skipped++;
        continue;
      }

      onProgress?.({
        loaded: images.length,
        total: flat.length,
        percent: Math.round((i / flat.length) * 100),
        currentName: `解包并解析: ${item.name}`,
        stage: 'parsing'
      });

      let bytes: Uint8Array;
      try {
        bytes = await item.reader.extract(item.entry);
      } catch (e: any) {
        failures.push({ name: item.name, message: `解包失败: ${e?.message || e}` });
        continue;
      }

      const isStandard = STANDARD_IMG_RE.test(item.name);
      const isDicomName = IMAGE_EXT_RE.test(item.name);
      const isDicomContent = !isStandard && DicomParser.looksLikeDicom(bytes);

      // 2. 既不是已知影像扩展名，内容也不像 DICOM -> 跳过
      if (!isStandard && !isDicomName && !isDicomContent) {
        skipped++;
        continue;
      }

      attempted++;
      try {
        if (isStandard) {
          const img = await this.decodeImageElement(bytes, item.name);
          images.push(DicomParser.fromImageElement(img, item.name));
        } else {
          const decoded = await DicomParser.parseAsync(toArrayBuffer(bytes), item.name);
          images.push(...decoded);
        }
      } catch (err: any) {
        failures.push({ name: item.name, message: err?.message || String(err) });
      }
    }

    onProgress?.({ loaded: images.length, total: images.length, percent: 100, stage: 'done' });

    if (images.length === 0) {
      const detail = failures
        .slice(0, 5)
        .map((f) => `  · ${f.name}: ${f.message}`)
        .join('\n');
      throw new Error(
        `压缩包内未解析出任何可用影像（尝试 ${attempted} 个，跳过 ${skipped} 个非影像条目）` +
          (detail ? `\n失败明细:\n${detail}` : '\n请确认压缩包内为 DICOM 或常见影像文件')
      );
    }

    if (failures.length > 0) {
      console.warn(
        `[OpenMed] 压缩包内有 ${failures.length} 个文件解析失败，已跳过：`,
        failures.slice(0, 10)
      );
    }

    return this.sortSeries(images);
  }

  /**
   * 列出压缩包内识别出的序列概览
   */
  async listSeries(): Promise<ZipSeriesInfo[]> {
    const images = await this.loadImages();
    const map = new Map<string, ZipSeriesInfo>();
    for (const img of images) {
      const uid = img.metadata.seriesInstanceUID || `SERIES_${img.metadata.seriesNumber || 1}`;
      const exist = map.get(uid);
      if (exist) {
        exist.count++;
        continue;
      }
      map.set(uid, {
        seriesInstanceUID: uid,
        seriesNumber: img.metadata.seriesNumber || 1,
        seriesDescription: img.metadata.seriesDescription,
        modality: img.metadata.modality,
        count: 1
      });
    }
    return Array.from(map.values()).sort((a, b) => a.seriesNumber - b.seriesNumber);
  }

  // ==================== 内部实现 ====================

  private isImageCandidate(name: string, sniffed = false): boolean {
    if (SKIP_EXT_RE.test(name) || DICOMDIR_RE.test(name)) return false;
    return sniffed || IMAGE_EXT_RE.test(name) || STANDARD_IMG_RE.test(name);
  }

  private async getReader(): Promise<ZipReader> {
    if (this.reader) return this.reader;

    if (this.config.file) {
      this.reader = await ZipReader.open(this.config.file);
    } else if (this.config.url) {
      this.reader = await ZipReader.open(this.config.url, this.config.headers);
    } else {
      throw new Error('未指定 ZIP 压缩包: 请传入 file 或 url');
    }
    return this.reader;
  }

  /**
   * 扁平化收集所有条目 (含嵌套 ZIP，受 recursive 控制)
   */
  private async collectEntries(): Promise<FlatEntry[]> {
    const reader = await this.getReader();
    const recursive = this.config.recursive !== false;
    const out: FlatEntry[] = [];

    const walk = async (r: ZipReader, prefix: string, depth: number) => {
      for (const entry of r.getEntries()) {
        if (entry.isDirectory) continue;
        if (IGNORED_RE.test(entry.name)) continue;
        const name = `${prefix}${entry.name}`;

        if (ZIP_RE.test(entry.name)) {
          if (!recursive || depth >= 3) continue;
          try {
            const bytes = await r.extract(entry);
            const nested = await ZipReader.open(bytes);
            await walk(nested, `${name}#/`, depth + 1);
          } catch (e) {
            console.warn(`嵌套压缩包 [${name}] 解析失败:`, e);
          }
          continue;
        }

        out.push({ name, entry, reader: r });
      }
    };

    await walk(reader, '', 0);
    out.sort((a, b) => naturalCompare(a.name, b.name));
    return out;
  }

  /**
   * 多序列排序: 先按 SeriesNumber/SeriesInstanceUID 分组，组内再按层面顺序排
   */
  private sortSeries(images: DicomImage[]): DicomImage[] {
    const groups = new Map<string, DicomImage[]>();
    const keyOf = (img: DicomImage) =>
      `${String(img.metadata.seriesNumber ?? 0).padStart(6, '0')}::${img.metadata.seriesInstanceUID || 'default'}`;

    for (const img of images) {
      const key = keyOf(img);
      const list = groups.get(key);
      if (list) list.push(img);
      else groups.set(key, [img]);
    }

    const sortedKeys = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
    const result: DicomImage[] = [];
    for (const key of sortedKeys) {
      const list = groups.get(key)!;
      list.sort((a, b) => {
        if (a.metadata.instanceNumber !== undefined && b.metadata.instanceNumber !== undefined) {
          const d = a.metadata.instanceNumber - b.metadata.instanceNumber;
          if (d !== 0) return d;
        }
        if (a.metadata.sliceLocation !== undefined && b.metadata.sliceLocation !== undefined) {
          const d = a.metadata.sliceLocation - b.metadata.sliceLocation;
          if (d !== 0) return d;
        }
        return naturalCompare(a.id, b.id);
      });
      result.push(...list);
    }

    return result;
  }

  private decodeImageElement(bytes: Uint8Array, name: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const mime = mimeFromName(name);
      const blob = new Blob([new Uint8Array(bytes)], { type: mime });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`图片解码失败: ${name}`));
      };
      img.src = url;
    });
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'bmp':
      return 'image/bmp';
    case 'webp':
      return 'image/webp';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    default:
      return 'application/octet-stream';
  }
}

/**
 * 自然序比较: IMG_2 排在 IMG_10 之前
 */
export function naturalCompare(a: string, b: string): number {
  const ax: (string | number)[] = [];
  const bx: (string | number)[] = [];
  a.replace(/(\d+)|(\D+)/g, (_, num: string | undefined, str: string | undefined) => {
    ax.push(num ? parseInt(num, 10) : str!.toLowerCase());
    return '';
  });
  b.replace(/(\d+)|(\D+)/g, (_, num: string | undefined, str: string | undefined) => {
    bx.push(num ? parseInt(num, 10) : str!.toLowerCase());
    return '';
  });

  for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
    const av = ax[i];
    const bv = bx[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av === bv) continue;
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av) < String(bv) ? -1 : 1;
  }
  return 0;
}
