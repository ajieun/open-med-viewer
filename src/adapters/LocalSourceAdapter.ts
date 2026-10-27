import { BaseStorageAdapter, ImageLoadProgress } from './BaseAdapter';
import { LocalSourceConfig, DicomImage } from '../types';
import { DicomParser } from '../dicom/DicomParser';

const STANDARD_IMG_RE = /\.(png|jpe?g|bmp|webp|tiff?)$/i;
const DICOM_NAME_RE = /\.(dcm|dicom|ima|img|dc3|dcm30)$/i;
const SKIP_RE = /(^|\.)(_DS_Store|DS_Store)$|^(\.)|\.(txt|xml|json|csv|md|pdf|zip)$/i;

export class LocalSourceAdapter extends BaseStorageAdapter<LocalSourceConfig> {
  async testConnection(): Promise<{ success: boolean; message: string; fileCount?: number }> {
    const files = this.getFiles();
    return {
      success: files.length > 0,
      message: files.length > 0 ? `检测到 ${files.length} 个本地文件` : '未选择本地文件',
      fileCount: files.length
    };
  }

  async loadImages(onProgress?: (progress: ImageLoadProgress) => void): Promise<DicomImage[]> {
    const fileList = this.getFiles();
    if (fileList.length === 0) {
      throw new Error('未选择任何本地影像文件');
    }

    const images: DicomImage[] = [];
    const failures: { name: string; message: string }[] = [];
    const total = fileList.length;
    let skipped = 0;

    for (let i = 0; i < total; i++) {
      const file = fileList[i];
      onProgress?.({
        loaded: images.length,
        total,
        percent: Math.round((i / total) * 100),
        currentName: file.name,
        stage: 'parsing'
      });

      if (SKIP_RE.test(file.name)) {
        skipped++;
        continue;
      }

      try {
        if (STANDARD_IMG_RE.test(file.name)) {
          const img = await this.loadImageElement(file);
          images.push(DicomParser.fromImageElement(img, file.name));
          continue;
        }

        const buffer = await file.arrayBuffer();

        // 无扩展名的 DICOM 文件（常见于 PACS 导出）通过内容嗅探识别
        const bytes = new Uint8Array(buffer);
        const knownDicom = DICOM_NAME_RE.test(file.name);
        if (!knownDicom && !DicomParser.looksLikeDicom(bytes)) {
          skipped++;
          continue;
        }

        const decoded = await DicomParser.parseAsync(buffer, file.name);
        images.push(...decoded);
      } catch (err: any) {
        failures.push({ name: file.name, message: err?.message || String(err) });
      }
    }

    onProgress?.({ loaded: images.length, total: images.length, percent: 100, stage: 'done' });

    if (images.length === 0) {
      const detail = failures
        .slice(0, 5)
        .map((f) => `  · ${f.name}: ${f.message}`)
        .join('\n');
      throw new Error(
        `未解析出任何可用影像（共 ${total} 个文件，跳过 ${skipped} 个非影像文件）` +
          (detail ? `\n失败明细:\n${detail}` : '')
      );
    }

    if (failures.length > 0) {
      console.warn(`[OpenMed] ${failures.length} 个本地文件解析失败，已跳过：`, failures.slice(0, 10));
    }

    return this.sortImages(images);
  }

  private getFiles(): File[] {
    if (!this.config.files) return [];
    if (this.config.files instanceof FileList) {
      return Array.from(this.config.files);
    }
    return this.config.files as File[];
  }

  private loadImageElement(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }
}
