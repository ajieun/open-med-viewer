import { DicomImage, DicomMetadata } from '../types';

export class SyntheticDicomGenerator {
  /**
   * 生成真实解剖结构的合成 16 位 CT 颅脑多层序列 (支持完整 HU 值、骨窗、脑窗、肺窗即时切换测试)
   */
  static generateBrainCtSeries(sliceCount: number = 16, size: number = 256): DicomImage[] {
    const images: DicomImage[] = [];
    const rows = size;
    const cols = size;
    const rescaleIntercept = -1024;
    const rescaleSlope = 1;

    for (let s = 0; s < sliceCount; s++) {
      const zProgress = s / (sliceCount - 1); // 0 (颅底) 到 1 (颅顶)
      const sliceLocation = -40 + s * 5; // mm
      const pixelData = new Int16Array(rows * cols);

      const cx = cols / 2;
      const cy = rows / 2;
      const rHeadX = size * (0.34 + 0.04 * Math.sin(zProgress * Math.PI));
      const rHeadY = size * (0.42 + 0.03 * Math.sin(zProgress * Math.PI));
      const skullThickness = size * 0.025;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const idx = y * cols + x;
          const dx = (x - cx) / rHeadX;
          const dy = (y - cy) / rHeadY;
          const distSq = dx * dx + dy * dy;

          let hu = -1000; // 默认体外空气 HU = -1000

          if (distSq <= 1.0) {
            const dist = Math.sqrt(distSq);
            // 头皮表皮脂肪与软组织
            if (dist > 0.94) {
              hu = -50 + Math.random() * 30; // 皮下脂肪
            } else if (dist > 0.86) {
              // 颅骨皮质与松质骨 (高密度 CT 值 800 - 1500 HU)
              hu = 900 + Math.random() * 400;
            } else {
              // 颅内脑实质 (基底节区/灰质/白质 30 - 45 HU)
              const noise = (Math.random() - 0.5) * 4;
              hu = 36 + noise;

              // 脑白质 / 灰质差异
              const brainRadius = dist / 0.86;
              if (brainRadius > 0.7) {
                hu += 5; // 脑皮质灰质稍高
              }

              // 侧脑室与三脑室系统 (低密度脑脊液 CSF: 0 ~ +15 HU)
              const ventZFactor = Math.sin(zProgress * Math.PI);
              if (ventZFactor > 0.25) {
                const vx1 = (x - (cx - size * 0.08)) / (size * 0.05 * ventZFactor);
                const vy1 = (y - (cy - size * 0.05)) / (size * 0.16 * ventZFactor);
                const vLeft = vx1 * vx1 + vy1 * vy1;

                const vx2 = (x - (cx + size * 0.08)) / (size * 0.05 * ventZFactor);
                const vy2 = (y - (cy - size * 0.05)) / (size * 0.16 * ventZFactor);
                const vRight = vx2 * vx2 + vy2 * vy2;

                if (vLeft < 1.0 || vRight < 1.0) {
                  hu = 6 + (Math.random() - 0.5) * 4;
                }
              }

              // 脑中线结构 (大脑镰，轻微高密度 50-60 HU)
              if (Math.abs(x - cx) < 1.5 && y > cy - rHeadY * 0.7 && y < cy + rHeadY * 0.7) {
                hu = 55 + Math.random() * 5;
              }

              // 模拟病灶 (在中间层面第 7-10 层放置一处微小高密度硬膜外血肿/钙化或低密度缺血梗死灶)
              if (s >= 6 && s <= 9) {
                const lx = (x - (cx + size * 0.2)) / (size * 0.06);
                const ly = (y - (cy + size * 0.1)) / (size * 0.06);
                if (lx * lx + ly * ly < 1.0) {
                  // 高密度病灶 (急性格局，HU ~ 75)
                  hu = 75 + (Math.random() - 0.5) * 6;
                }
              }
            }
          }

          // 转换为原始存储值: storedValue = (HU - rescaleIntercept) / rescaleSlope
          const rawValue = Math.round((hu - rescaleIntercept) / rescaleSlope);
          pixelData[idx] = rawValue;
        }
      }

      const metadata: DicomMetadata = {
        patientName: 'ZHANG^SAN',
        patientId: 'CT-20261026-9921',
        patientBirthDate: '19850618',
        patientSex: 'M',
        studyDate: '20261026',
        studyTime: '093015',
        studyDescription: 'Head CT Plain Routine',
        seriesDescription: 'Brain Axial 5.0mm Standard',
        modality: 'CT',
        seriesNumber: 2,
        instanceNumber: s + 1,
        sliceThickness: 5.0,
        sliceLocation,
        imagePositionPatient: [-128, -128, sliceLocation],
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        pixelSpacing: [0.488281, 0.488281],
        rows,
        columns: cols,
        bitsAllocated: 16,
        bitsStored: 12,
        highBit: 11,
        pixelRepresentation: 0,
        samplesPerPixel: 1,
        photometricInterpretation: 'MONOCHROME2',
        windowCenter: [40],
        windowWidth: [80],
        rescaleIntercept,
        rescaleSlope,
        sopInstanceUID: `1.2.840.10008.5.1.4.1.1.2.${Date.now()}.${s + 1}`,
        seriesInstanceUID: `1.2.840.10008.5.1.4.1.1.2.20261026.2`,
        studyInstanceUID: `1.2.840.10008.5.1.4.1.1.2.20261026.1`
      };

      images.push({
        id: `synthetic_slice_${s + 1}`,
        metadata,
        pixelData,
        width: cols,
        height: rows,
        minPixelValue: 0,
        maxPixelValue: 2400,
        defaultWindowCenter: 40,
        defaultWindowWidth: 80
      });
    }

    return images;
  }
}
