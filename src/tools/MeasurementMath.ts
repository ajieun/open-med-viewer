import { Measurement, Point2D } from '../types';
import { ImageRenderer } from '../engine/ImageRenderer';
import type { Viewport } from '../engine/Viewport';

/**
 * 测量标注的几何计算、统计与命中测试
 *
 * 抽离为独立模块后，创建（各 Tool）与编辑（拖动/缩放已存在的标注）共用同一套计算逻辑。
 */

export interface HitResult {
  measurement: Measurement;
  /** 命中的控制点索引；null 表示命中整体（可平移） */
  handleIndex: number | null;
}

/** 重算测量数据（长度 / 角度 / 面积 / HU 统计 / 探针） */
export function recalculateMeasurement(m: Measurement, viewport: Viewport): void {
  const img = viewport.getCurrentImage();
  if (!img) return;

  const spacing = img.metadata.pixelSpacing || [1.0, 1.0];

  switch (m.type) {
    case 'length': {
      if (m.points.length < 2) return;
      const [p1, p2] = m.points;
      const dx = (p2.x - p1.x) * spacing[1];
      const dy = (p2.y - p1.y) * spacing[0];
      m.data.lengthMm = round(Math.sqrt(dx * dx + dy * dy), 2);
      m.data.text = `${m.data.lengthMm} mm`;
      break;
    }

    case 'angle': {
      if (m.points.length < 3) return;
      const [p1, vertex, p3] = m.points;
      const v1 = { x: p1.x - vertex.x, y: p1.y - vertex.y };
      const v2 = { x: p3.x - vertex.x, y: p3.y - vertex.y };
      const mag1 = Math.hypot(v1.x, v1.y);
      const mag2 = Math.hypot(v2.x, v2.y);
      if (mag1 === 0 || mag2 === 0) {
        m.data.angleDeg = 0;
        m.data.text = '0.0°';
        return;
      }
      const cosTheta = clamp((v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2), -1, 1);
      m.data.angleDeg = round((Math.acos(cosTheta) * 180) / Math.PI, 1);
      m.data.text = `${m.data.angleDeg}°`;
      break;
    }

    case 'rectangleRoi': {
      if (m.points.length < 2) return;
      const [p1, p2] = m.points;
      const minX = clamp(Math.min(p1.x, p2.x), 0, img.width - 1);
      const maxX = clamp(Math.max(p1.x, p2.x), 0, img.width - 1);
      const minY = clamp(Math.min(p1.y, p2.y), 0, img.height - 1);
      const maxY = clamp(Math.max(p1.y, p2.y), 0, img.height - 1);

      const widthMm = (maxX - minX) * spacing[1];
      const heightMm = (maxY - minY) * spacing[0];
      const stats = computeRegionStats(img, minX, minY, maxX, maxY, (x, y) => x >= 0 && y >= 0);

      m.data.areaMm2 = round(widthMm * heightMm, 1);
      Object.assign(m.data, stats);
      m.data.text = `面积: ${m.data.areaMm2}mm²\n均值: ${m.data.meanHU}HU\n范围: [${m.data.minHU}, ${m.data.maxHU}]`;
      break;
    }

    case 'ellipseRoi': {
      if (m.points.length < 2) return;
      const [p1, p2] = m.points;
      const cx = p1.x;
      const cy = p1.y;
      const rx = Math.abs(p2.x - p1.x);
      const ry = Math.abs(p2.y - p1.y);
      if (rx < 0.5 || ry < 0.5) {
        m.data.areaMm2 = 0;
        m.data.text = '面积: 0mm²';
        return;
      }

      const startX = clamp(Math.floor(cx - rx), 0, img.width - 1);
      const endX = clamp(Math.ceil(cx + rx), 0, img.width - 1);
      const startY = clamp(Math.floor(cy - ry), 0, img.height - 1);
      const endY = clamp(Math.ceil(cy + ry), 0, img.height - 1);

      const stats = computeRegionStats(img, startX, startY, endX, endY, (x, y) => {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        return dx * dx + dy * dy <= 1.0;
      });

      m.data.areaMm2 = round(Math.PI * rx * spacing[1] * ry * spacing[0], 1);
      Object.assign(m.data, stats);
      m.data.text = `面积: ${m.data.areaMm2}mm²\n均值: ${m.data.meanHU}HU`;
      break;
    }

    case 'probe': {
      if (m.points.length < 1) return;
      const p = m.points[0];
      const { hu } = ImageRenderer.getPixelHU(img, p.x, p.y);
      m.data.probeHU = round(hu, 1);
      m.data.probeCoord = { ...p };
      m.data.text = `HU: ${m.data.probeHU}\n(X:${Math.round(p.x)}, Y:${Math.round(p.y)})`;
      break;
    }

    default:
      break;
  }
}

/**
 * 命中测试
 * @param tolerancePx 画布像素容差（内部会按缩放换算为图像像素）
 */
export function hitTestMeasurement(
  measurements: Measurement[],
  imgPt: Point2D,
  zoom: number,
  tolerancePx: number = 8
): HitResult | null {
  const tol = tolerancePx / Math.max(0.05, zoom);

  // 倒序遍历，优先命中后绘制（视觉在上）的标注
  for (let i = measurements.length - 1; i >= 0; i--) {
    const m = measurements[i];
    if (m.locked) continue;

    // 1. 控制点优先
    for (let h = 0; h < m.points.length; h++) {
      if (distance(m.points[h], imgPt) <= tol * 1.4) {
        return { measurement: m, handleIndex: h };
      }
    }

    // 2. 整体命中
    if (isPointOnMeasurement(m, imgPt, tol)) {
      return { measurement: m, handleIndex: null };
    }
  }

  return null;
}

function isPointOnMeasurement(m: Measurement, p: Point2D, tol: number): boolean {
  switch (m.type) {
    case 'length':
    case 'arrow':
      return m.points.length >= 2 && distanceToSegment(p, m.points[0], m.points[1]) <= tol;

    case 'angle': {
      if (m.points.length < 3) return false;
      return (
        distanceToSegment(p, m.points[0], m.points[1]) <= tol ||
        distanceToSegment(p, m.points[1], m.points[2]) <= tol
      );
    }

    case 'rectangleRoi': {
      if (m.points.length < 2) return false;
      const [p1, p2] = m.points;
      const minX = Math.min(p1.x, p2.x) - tol;
      const maxX = Math.max(p1.x, p2.x) + tol;
      const minY = Math.min(p1.y, p2.y) - tol;
      const maxY = Math.max(p1.y, p2.y) + tol;
      // 命中边框或内部（内部可整体拖动）
      return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    }

    case 'ellipseRoi': {
      if (m.points.length < 2) return false;
      const [c, edge] = m.points;
      const rx = Math.max(1, Math.abs(edge.x - c.x));
      const ry = Math.max(1, Math.abs(edge.y - c.y));
      const dx = (p.x - c.x) / (rx + tol);
      const dy = (p.y - c.y) / (ry + tol);
      return dx * dx + dy * dy <= 1;
    }

    case 'probe':
      return m.points.length >= 1 && distance(m.points[0], p) <= tol * 2;

    default:
      return false;
  }
}

/**
 * 整体平移测量点
 */
export function translateMeasurement(m: Measurement, dx: number, dy: number): void {
  for (const p of m.points) {
    p.x += dx;
    p.y += dy;
  }
}

// ==================== 内部工具函数 ====================

function computeRegionStats(
  img: any,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  predicate: (x: number, y: number) => boolean
): { meanHU: number; minHU: number; maxHU: number } {
  let sumHU = 0;
  let minHU = Infinity;
  let maxHU = -Infinity;
  let count = 0;

  for (let y = Math.floor(startY); y <= Math.ceil(endY); y++) {
    for (let x = Math.floor(startX); x <= Math.ceil(endX); x++) {
      if (!predicate(x, y)) continue;
      const { hu, inBounds } = ImageRenderer.getPixelHU(img, x, y);
      if (!inBounds) continue;
      sumHU += hu;
      if (hu < minHU) minHU = hu;
      if (hu > maxHU) maxHU = hu;
      count++;
    }
  }

  return {
    meanHU: count > 0 ? round(sumHU / count, 1) : 0,
    minHU: minHU === Infinity ? 0 : round(minHU, 1),
    maxHU: maxHU === -Infinity ? 0 : round(maxHU, 1)
  };
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq === 0) return distance(p, a);
  const t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq, 0, 1);
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function round(v: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}
