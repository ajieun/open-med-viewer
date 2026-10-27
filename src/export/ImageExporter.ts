import { Viewport } from '../engine/Viewport';
import { Measurement, DicomImage } from '../types';

export interface ExportImageOptions {
  format?: 'image/png' | 'image/jpeg';
  quality?: number;
  filename?: string;
}

export class ImageExporter {
  /**
   * 导出当前视口图像为 PNG / JPEG 文件
   */
  static exportViewportImage(viewport: Viewport, options: ExportImageOptions = {}): void {
    const canvas = viewport.getCanvas();
    const format = options.format || 'image/png';
    const quality = options.quality || 0.95;
    const filename = options.filename || `DICOM_Snapshot_${Date.now()}.${format === 'image/jpeg' ? 'jpg' : 'png'}`;

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, format, quality);
  }

  /**
   * 导出所有测量与标注数据为标准 JSON 格式 (便于持久化存入云端/PACS报告库)
   */
  static exportMeasurementsJson(measurements: Measurement[], imageInfo?: { patientId?: string; studyDate?: string }): void {
    const payload = {
      exportTime: new Date().toISOString(),
      patientId: imageInfo?.patientId || 'UNKNOWN',
      studyDate: imageInfo?.studyDate || 'UNKNOWN',
      count: measurements.length,
      measurements
    };

    const str = JSON.stringify(payload, null, 2);
    const blob = new Blob([str], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Measurements_${imageInfo?.patientId || 'DICOM'}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * 导出 DICOM 完整元数据为 JSON
   */
  static exportDicomMetadata(image: DicomImage): void {
    const jsonStr = JSON.stringify(image.metadata, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DICOM_Metadata_${image.metadata.patientId || 'TAGS'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
