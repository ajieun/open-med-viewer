import { BaseStorageAdapter, ImageLoadProgress } from './BaseAdapter';
import { AliyunOssConfig, DicomImage } from '../types';
import { DicomParser } from '../dicom/DicomParser';

export class AliyunOssAdapter extends BaseStorageAdapter<AliyunOssConfig> {
  async testConnection(): Promise<{ success: boolean; message: string; fileCount?: number }> {
    try {
      const keys = await this.listObjectKeys();
      return {
        success: true,
        message: `阿里云 OSS 连接成功，共找到 ${keys.length} 个影像文件`,
        fileCount: keys.length
      };
    } catch (err: any) {
      return {
        success: false,
        message: `阿里云 OSS 连接失败: ${err.message || err}`
      };
    }
  }

  async loadImages(onProgress?: (progress: ImageLoadProgress) => void): Promise<DicomImage[]> {
    onProgress?.({
      loaded: 0,
      total: 0,
      percent: 0,
      stage: 'listing',
      currentName: '正在扫描阿里云 OSS 影像目录...'
    });

    const keys = await this.listObjectKeys();
    if (keys.length === 0) {
      throw new Error(`阿里云 OSS 桶 [${this.config.bucket}] 下未找到匹配的前缀或影像对象`);
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
        const headers: Record<string, string> = {};
        if (this.config.stsToken) {
          headers['x-oss-security-token'] = this.config.stsToken;
        }

        const res = await fetch(url, { headers });
        if (!res.ok) {
          throw new Error(`HTTP error ${res.status} ${res.statusText}`);
        }

        const buffer = await res.arrayBuffer();
        const decoded = await DicomParser.parseAsync(buffer, filename);
        images.push(...decoded);
      } catch (err) {
        console.warn(`加载阿里云 OSS 影像 [${key}] 异常:`, err);
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
    const cleanKey = key.replace(/^\/+/, '');
    if (this.config.endpoint) {
      const endpoint = this.config.endpoint.replace(/^https?:\/\//, '');
      return `https://${this.config.bucket}.${endpoint}/${cleanKey}`;
    }
    // 默认阿里云公网域名: https://bucket.oss-region.aliyuncs.com/key
    return `https://${this.config.bucket}.${this.config.region}.aliyuncs.com/${cleanKey}`;
  }

  private async listObjectKeys(): Promise<string[]> {
    if (this.config.keys && this.config.keys.length > 0) {
      return this.config.keys;
    }

    let listUrl = '';
    if (this.config.endpoint) {
      const endpoint = this.config.endpoint.replace(/^https?:\/\//, '');
      listUrl = `https://${this.config.bucket}.${endpoint}/`;
    } else {
      listUrl = `https://${this.config.bucket}.${this.config.region}.aliyuncs.com/`;
    }

    if (this.config.prefix) {
      listUrl += `?prefix=${encodeURIComponent(this.config.prefix)}`;
    }

    try {
      const headers: Record<string, string> = {};
      if (this.config.stsToken) {
        headers['x-oss-security-token'] = this.config.stsToken;
      }
      const res = await fetch(listUrl, { headers });
      if (!res.ok) {
        throw new Error(`获取 OSS 对象列表失败: HTTP ${res.status}`);
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
