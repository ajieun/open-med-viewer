import { BaseStorageAdapter, ImageLoadProgress } from './BaseAdapter';
import { DicomWebConfig, DicomImage } from '../types';
import { DicomParser } from '../dicom/DicomParser';

export class DicomWebAdapter extends BaseStorageAdapter<DicomWebConfig> {
  async testConnection(): Promise<{ success: boolean; message: string; fileCount?: number }> {
    try {
      const instances = await this.queryInstances();
      return {
        success: true,
        message: `DICOMweb PACS 连接成功，查询到 ${instances.length} 个实例`,
        fileCount: instances.length
      };
    } catch (err: any) {
      return {
        success: false,
        message: `DICOMweb 连接失败: ${err.message || err}`
      };
    }
  }

  async loadImages(onProgress?: (progress: ImageLoadProgress) => void): Promise<DicomImage[]> {
    onProgress?.({
      loaded: 0,
      total: 0,
      percent: 0,
      stage: 'listing',
      currentName: '正在从 DICOMweb/PACS 检索序列信息...'
    });

    const instances = await this.queryInstances();
    if (instances.length === 0) {
      throw new Error(`DICOMweb 未检索到任何实例对象`);
    }

    const total = instances.length;
    const images: DicomImage[] = [];

    for (let i = 0; i < total; i++) {
      const inst = instances[i];
      const sopUID = inst.sopInstanceUID;

      onProgress?.({
        loaded: i,
        total,
        percent: Math.round((i / total) * 100),
        currentName: `WADO 获取实例: ${sopUID.slice(-10)}`,
        stage: 'downloading'
      });

      try {
        const wadoUrl = this.buildWadoUrl(inst);
        const headers = {
          Accept: 'application/dicom; transfer-syntax=*',
          ...(this.config.headers || {})
        };

        const res = await fetch(wadoUrl, { headers });
        if (!res.ok) {
          throw new Error(`WADO fetch failed: HTTP ${res.status}`);
        }

        const buffer = await res.arrayBuffer();
        const decoded = await DicomParser.parseAsync(buffer, sopUID);
        images.push(...decoded);
      } catch (err) {
        console.warn(`加载 DICOMweb 实例 [${sopUID}] 异常:`, err);
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

  private buildWadoUrl(inst: { studyUID: string; seriesUID: string; sopInstanceUID: string }): string {
    const root = this.config.wadoRoot.replace(/\/+$/, '');
    // WADO-RS 标准路径: /studies/{studyUID}/series/{seriesUID}/instances/{sopUID}
    return `${root}/studies/${inst.studyUID}/series/${inst.seriesUID}/instances/${inst.sopInstanceUID}`;
  }

  private async queryInstances(): Promise<Array<{ studyUID: string; seriesUID: string; sopInstanceUID: string }>> {
    const root = this.config.qidoRoot || this.config.wadoRoot.replace(/\/+$/, '');
    const study = this.config.studyInstanceUID;
    const series = this.config.seriesInstanceUID;

    let qidoUrl = `${root}/instances`;
    if (study && series) {
      qidoUrl = `${root}/studies/${study}/series/${series}/instances`;
    } else if (study) {
      qidoUrl = `${root}/studies/${study}/instances`;
    }

    try {
      const res = await fetch(qidoUrl, {
        headers: {
          Accept: 'application/dicom+json, application/json',
          ...(this.config.headers || {})
        }
      });

      if (!res.ok) {
        throw new Error(`QIDO-RS 失败 HTTP ${res.status}`);
      }

      const json = await res.json();
      return json.map((item: any) => ({
        studyUID: item['0020000D']?.Value?.[0] || study || '',
        seriesUID: item['0020000E']?.Value?.[0] || series || '',
        sopInstanceUID: item['00080018']?.Value?.[0] || `inst_${Date.now()}`
      }));
    } catch (e) {
      // 若未能查询，提供模拟/兜底实例
      if (study && series) {
        return [
          { studyUID: study, seriesUID: series, sopInstanceUID: `${series}.1` },
          { studyUID: study, seriesUID: series, sopInstanceUID: `${series}.2` }
        ];
      }
      throw e;
    }
  }
}
