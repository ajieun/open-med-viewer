import { BaseStorageAdapter, ImageLoadProgress } from './BaseAdapter';
import { HuaweiObsConfig, DicomImage } from '../types';
import { DicomParser } from '../dicom/DicomParser';

export class HuaweiObsAdapter extends BaseStorageAdapter<HuaweiObsConfig> {
  async testConnection(): Promise<{ success: boolean; message: string; fileCount?: number }> {
    try {
      const keys = await this.listObjectKeys();
      return {
        success: true,
        message: `华为云 OBS 连接成功，找到 ${keys.length} 个影像文件`,
        fileCount: keys.length
      };
    } catch (err: any) {
      return {
        success: false,
        message: `华为云 OBS 连接失败: ${err.message || err}`
      };
    }
  }

  async loadImages(onProgress?: (progress: ImageLoadProgress) => void): Promise<DicomImage[]> {
    onProgress?.({
      loaded: 0,
      total: 0,
      percent: 0,
      stage: 'listing',
      currentName: '正在扫描华为云 OBS 目录...'
    });

    const keys = await this.listObjectKeys();
    if (keys.length === 0) {
      throw new Error(`华为云 OBS 桶 [${this.config.bucket}] 下未找到匹配的前缀或影像对象`);
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
        if (this.config.securityToken) {
          headers['x-obs-security-token'] = this.config.securityToken;
        }

        const res = await fetch(url, { headers });
        if (!res.ok) {
          throw new Error(`HTTP error ${res.status} ${res.statusText}`);
        }

        const buffer = await res.arrayBuffer();
        const decoded = await DicomParser.parseAsync(buffer, filename);
        images.push(...decoded);
      } catch (err) {
        console.warn(`加载华为云 OBS 影像 [${key}] 异常:`, err);
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
    const endpoint = this.config.endpoint.replace(/^https?:\/\//, '');
    const cleanKey = key.replace(/^\/+/, '');
    // 华为云 OBS 标准域名格式: https://bucket.endpoint/key
    return `https://${this.config.bucket}.${endpoint}/${cleanKey}`;
  }

  private async listObjectKeys(): Promise<string[]> {
    if (this.config.keys && this.config.keys.length > 0) {
      return this.config.keys;
    }

    // 通过 OBS REST API 列出对象: GET https://bucket.endpoint/?prefix=xxx
    const endpoint = this.config.endpoint.replace(/^https?:\/\//, '');
    let listUrl = `https://${this.config.bucket}.${endpoint}/`;
    if (this.config.prefix) {
      listUrl += `?prefix=${encodeURIComponent(this.config.prefix)}`;
    }

    try {
      const headers: Record<string, string> = {};
      if (this.config.securityToken) {
        headers['x-obs-security-token'] = this.config.securityToken;
      }
      const res = await fetch(listUrl, { headers });
      if (!res.ok) {
        throw new Error(`获取对象列表失败: HTTP ${res.status}`);
      }
      const text = await res.text();
      // 解析 XML 中的 <Key>
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
      // 若因 CORS 限制列举，支持预配置 keys
      if (this.config.keys) return this.config.keys;
      throw err;
    }
  }
}
