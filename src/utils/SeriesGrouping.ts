import { DicomImage } from '../types';

/**
 * 按"检查部位 / 序列"对导入的影像进行分组，供顶部页签（Tab）切换使用。
 */

export interface SeriesGroup {
  /** 稳定唯一键（用于测量数据、页签状态缓存） */
  key: string;
  /** 页签主标题，如「头颅」「胸部」 */
  label: string;
  /** 检查部位原始值 (0008,1030 / 0018,0015) */
  bodyPart?: string;
  /** 序列描述 (0008,103E) */
  description?: string;
  modality: string;
  seriesNumber: number;
  images: DicomImage[];
}

/** DICOM BodyPartExamined 常见取值 -> 中文 */
const BODY_PART_LABELS: Record<string, string> = {
  HEAD: '头颅',
  BRAIN: '头颅',
  SKULL: '头颅',
  NECK: '颈部',
  CHEST: '胸部',
  THORAX: '胸部',
  LUNG: '肺',
  HEART: '心脏',
  CARDIAC: '心脏',
  ABDOMEN: '腹部',
  ABDOMINAL: '腹部',
  LIVER: '肝脏',
  KIDNEY: '肾脏',
  RENAL: '肾脏',
  PELVIS: '盆腔',
  SPINE: '脊柱',
  CERVICAL: '颈椎',
  THORACIC: '胸椎',
  LUMBAR: '腰椎',
  SHOULDER: '肩关节',
  ARM: '上肢',
  ELBOW: '肘关节',
  WRIST: '腕关节',
  HAND: '手',
  HIP: '髋关节',
  LEG: '下肢',
  KNEE: '膝关节',
  ANKLE: '踝关节',
  FOOT: '足',
  BREAST: '乳腺',
  PROSTATE: '前列腺',
  THYROID: '甲状腺',
  CAROTID: '颈动脉',
  WHOLEBODY: '全身',
  EXTREMITY: '四肢'
};

/**
 * 将影像按序列分组（保持组内既有排序）
 */
export function groupImagesBySeries(images: DicomImage[]): SeriesGroup[] {
  const map = new Map<string, SeriesGroup>();

  for (const img of images) {
    const meta = img.metadata;
    const bodyPart = (meta.bodyPartExamined || '').toUpperCase();
    const seriesNumber = meta.seriesNumber || 1;
    const key =
      meta.seriesInstanceUID ||
      `${meta.modality || 'OT'}-${seriesNumber}-${meta.seriesDescription || ''}`;

    const existing = map.get(key);
    if (existing) {
      existing.images.push(img);
      continue;
    }

    const modality = (meta.modality as string) || 'OT';
    map.set(key, {
      key,
      label: buildLabel(bodyPart, meta.seriesDescription, modality, seriesNumber),
      bodyPart: bodyPart || undefined,
      description: meta.seriesDescription,
      modality,
      seriesNumber,
      images: [img]
    });
  }

  const groups = Array.from(map.values()).sort((a, b) => {
    if (a.seriesNumber !== b.seriesNumber) return a.seriesNumber - b.seriesNumber;
    return a.key.localeCompare(b.key);
  });

  // 处理重名页签：追加序号区分（如「头颅(2)」）
  const seen = new Map<string, number>();
  for (const g of groups) {
    const count = (seen.get(g.label) || 0) + 1;
    seen.set(g.label, count);
    if (count > 1) g.label = `${g.label}(${count})`;
  }

  return groups;
}

function buildLabel(
  bodyPart: string,
  description: string | undefined,
  modality: string,
  seriesNumber: number
): string {
  if (bodyPart) {
    const zh = BODY_PART_LABELS[bodyPart];
    return zh || bodyPart;
  }
  const desc = (description || '').trim();
  if (desc) return desc.length > 18 ? `${desc.slice(0, 18)}…` : desc;
  return `${modality} 序列 ${seriesNumber}`;
}
