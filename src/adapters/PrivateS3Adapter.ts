import { BaseStorageAdapter, ImageLoadProgress } from './BaseAdapter';
import { PrivateS3Config, DicomImage } from '../types';
import { DicomParser } from '../dicom/DicomParser';

export class PrivateS3Adapter extends BaseStorageAdapter<PrivateS3Config> {
  async testConnection(): Promise<{ success: boolean; message: string; fileCount?: number }> {
    try {
      const keys = await this.listObjectKeys();
      return {
        success: true,
        message: `私有云 S3/MinIO 连接成功，找到 ${keys.length} 个影像`,
        fileCount: keys.length
      };
    } catch (err: any) {
      return {
        success: false,
        message: `私有云 S3 连接失败: ${err.message || err}`
      };
    }
  }

  async loadImages(onProgress?: (progress: ImageLoadProgress) => void): Promise<DicomImage[]> {
    onProgress?.({
      loaded: 0,
      total: 0,
      percent: 0,
      stage: 'listing',
      currentName: '正在扫描私有云 S3/MinIO 对象...'
    });

    const keys = await this.listObjectKeys();
    if (keys.length === 0) {
      throw new Error(`私有云存储桶 [${this.config.bucket}] 未找到影像对象`);
    }

    const total = keys.length;
    const images: DicomImage[] = [];

    for (let i = 0; i < total; i++) {
      const key = keys[i];
      const filename = key.split('/').pop() || key;

      onProgress?.({
        loaded: i,
        total,
        percent: Math.round((i / total) * 100),
        currentName: `下载中: ${filename}`,
        stage: 'downloading'
      });

      try {
        const url = this.buildObjectUrl(key);
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP error ${res.status} ${res.statusText}`);
        }

        const buffer = await res.arrayBuffer();
        const decoded = await DicomParser.parseAsync(buffer, filename);
        images.push(...decoded);
      } catch (err) {
        console.warn(`加载私有云 S3 影像 [${key}] 异常:`, err);
      }
    }

    onProgress?.({
      loaded: total,
      total,
      percent: 100,
      stage: 'done'
    });

    return this.sortImages(images);
  }

  private buildObjectUrl(key: string): string {
    const endpoint = this.config.endpoint.replace(/\/+$/, '');
    const cleanKey = key.replace(/^\/+/, '');
    const pathStyle = this.config.pathStyle !== false; // 默认 path style (MinIO常用)

    if (pathStyle) {
      return `${endpoint}/${this.config.bucket}/${cleanKey}`;
    } else {
      const urlObj = new URL(endpoint);
      return `${urlObj.protocol}//${this.config.bucket}.${urlObj.host}/${cleanKey}`;
    }
  }

  private async listObjectKeys(): Promise<string[]> {
    if (this.config.keys && this.config.keys.length > 0) {
      return this.config.keys;
    }

    const endpoint = this.config.endpoint.replace(/\/+$/, '');
    let listUrl = `${endpoint}/${this.config.bucket}`;
    if (this.config.prefix) {
      listUrl += `?prefix=${encodeURIComponent(this.config.prefix)}`;
    }

    try {
      const res = await fetch(listUrl);
      if (!res.ok) {
        throw new Error(`列举 S3 对象失败: HTTP ${res.status}`);
      }
      const text = await res.text();
      const keys: string[] = [];
      const regex = /<Key>(.*?)<\/Key>/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        const k = match[1];
        if (!k.endsWith('/')) {
          keys.push(k);
        }
      }
      return keys;
    } catch (err) {
      if (this.config.keys) return this.config.keys;
      throw err;
    }
  }
}
