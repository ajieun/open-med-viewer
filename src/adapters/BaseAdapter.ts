import { DicomImage } from '../types';

export interface ImageLoadProgress {
  loaded: number;
  total: number;
  percent: number;
  currentName?: string;
  stage?: 'connecting' | 'listing' | 'downloading' | 'parsing' | 'done';
}

export abstract class BaseStorageAdapter<TConfig> {
  protected config: TConfig;

  constructor(config: TConfig) {
    this.config = config;
  }

  abstract testConnection(): Promise<{ success: boolean; message: string; fileCount?: number }>;

  abstract loadImages(onProgress?: (progress: ImageLoadProgress) => void): Promise<DicomImage[]>;

  /**
   * 按层厚/层面位置或序列号自动将影像排序
   */
  protected sortImages(images: DicomImage[]): DicomImage[] {
    return images.sort((a, b) => {
      if (a.metadata.sliceLocation !== undefined && b.metadata.sliceLocation !== undefined) {
        return a.metadata.sliceLocation - b.metadata.sliceLocation;
      }
      if (a.metadata.instanceNumber !== undefined && b.metadata.instanceNumber !== undefined) {
        return a.metadata.instanceNumber - b.metadata.instanceNumber;
      }
      return a.id.localeCompare(b.id);
    });
  }
}
