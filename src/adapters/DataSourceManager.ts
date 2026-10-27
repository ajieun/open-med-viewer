import { UnifiedImageSourceConfig, DicomImage } from '../types';
import { BaseStorageAdapter, ImageLoadProgress } from './BaseAdapter';
import { LocalSourceAdapter } from './LocalSourceAdapter';
import { ZipSourceAdapter } from './ZipSourceAdapter';
import { HuaweiObsAdapter } from './HuaweiObsAdapter';
import { AliyunOssAdapter } from './AliyunOssAdapter';
import { PrivateS3Adapter } from './PrivateS3Adapter';
import { DicomWebAdapter } from './DicomWebAdapter';
import { DicomParser } from '../dicom/DicomParser';
import { SyntheticDicomGenerator } from '../dicom/SyntheticDicom';

export class DataSourceManager {
  /**
   * 根据用户传入的配置对象动态创建对应的数据源适配器并加载影像
   */
  static async loadFromConfig(
    config: UnifiedImageSourceConfig,
    onProgress?: (progress: ImageLoadProgress) => void
  ): Promise<DicomImage[]> {
    if (config.type === 'syntheticDemo') {
      onProgress?.({
        loaded: 0,
        total: config.sliceCount || 16,
        percent: 0,
        stage: 'listing',
        currentName: '正在初始化高保真 16-bit 颅脑 CT 容积数据...'
      });

      const images = SyntheticDicomGenerator.generateBrainCtSeries(config.sliceCount || 16, 256);

      onProgress?.({
        loaded: images.length,
        total: images.length,
        percent: 100,
        stage: 'done'
      });

      return images;
    }

    if (config.type === 'directUrl') {
      const urls = config.urls;
      const total = urls.length;
      const images: DicomImage[] = [];

      for (let i = 0; i < total; i++) {
        const url = urls[i];
        const filename = url.split('/').pop() || `img_${i + 1}.dcm`;
        onProgress?.({
          loaded: i,
          total,
          percent: Math.round((i / total) * 100),
          currentName: `下载中: ${filename}`,
          stage: 'downloading'
        });

        const res = await fetch(url, { headers: config.headers });
        if (!res.ok) throw new Error(`Fetch ${url} failed HTTP ${res.status}`);

        const isStandard = /\.(png|jpe?g|webp|bmp)$/i.test(filename);
        if (isStandard) {
          const blob = await res.blob();
          const img = await this.blobToImage(blob);
          images.push(DicomParser.fromImageElement(img, filename));
        } else {
          const buffer = await res.arrayBuffer();
          const decoded = await DicomParser.parseAsync(buffer, filename);
          images.push(...decoded);
        }
      }

      onProgress?.({
        loaded: total,
        total,
        percent: 100,
        stage: 'done'
      });

      return images;
    }

    const adapter = this.createAdapter(config);
    return await adapter.loadImages(onProgress);
  }

  /**
   * 测试数据源连通性
   */
  static async testConnection(config: UnifiedImageSourceConfig): Promise<{ success: boolean; message: string; fileCount?: number }> {
    if (config.type === 'syntheticDemo') {
      return { success: true, message: '内置医学容积生成器就绪', fileCount: config.sliceCount || 16 };
    }
    if (config.type === 'directUrl') {
      return { success: true, message: `已指定 ${config.urls.length} 个直接 URL`, fileCount: config.urls.length };
    }
    const adapter = this.createAdapter(config);
    return await adapter.testConnection();
  }

  private static createAdapter(config: UnifiedImageSourceConfig): BaseStorageAdapter<any> {
    switch (config.type) {
      case 'local': {
        // 若本地选择的是 .zip 压缩包，自动转交 ZIP 适配器解包
        const zipFile = DataSourceManager.pickZipFile(config.files);
        if (zipFile) {
          return new ZipSourceAdapter({ type: 'zip', file: zipFile });
        }
        return new LocalSourceAdapter(config);
      }
      case 'zip':
        return new ZipSourceAdapter(config);
      case 'huaweiObs':
        return new HuaweiObsAdapter(config);
      case 'aliyunOss':
        return new AliyunOssAdapter(config);
      case 'privateS3':
        return new PrivateS3Adapter(config);
      case 'dicomWeb':
        return new DicomWebAdapter(config);
      default:
        throw new Error(`不支持的数据源类型: ${(config as any).type}`);
    }
  }

  private static pickZipFile(files?: File[] | FileList): File | null {
    if (!files) return null;
    const list = files instanceof FileList ? Array.from(files) : files;
    return list.find((f) => /\.zip$/i.test(f.name)) || null;
  }

  private static blobToImage(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
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
