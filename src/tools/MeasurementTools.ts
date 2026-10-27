import { BaseTool } from './BaseTool';
import { ToolType, Point2D, Measurement } from '../types';
import type { Viewport } from '../engine/Viewport';
import { recalculateMeasurement } from './MeasurementMath';

/**
 * 拖拽式测量工具基类
 *
 * 同时支持两种交互习惯：
 *   1. 按住左键拖动 -> 松开即完成（主流 PACS 手感）
 *   2. 单击起点 -> 移动预览 -> 再次单击完成（点击式，便于精细定位）
 */
export abstract class DragCreateTool extends BaseTool {
  protected active: Measurement | null = null;

  private pressPoint: Point2D | null = null;
  private hasMoved = false;
  private awaitingClick = false;

  abstract readonly type: ToolType;
  abstract readonly nameZh: string;
  readonly cursor: string = 'crosshair';

  protected abstract createMeasurement(pt: Point2D, viewport: Viewport): Measurement;
  protected abstract updateEndPoint(imgPoint: Point2D, viewport: Viewport): void;

  onMouseDown(e: MouseEvent, imgPoint: Point2D, viewport: Viewport): void {
    if (e.button !== 0) return;

    // 点击式：第二次点击完成
    if (this.active && this.awaitingClick) {
      this.updateEndPoint(imgPoint, viewport);
      this.finish(viewport);
      return;
    }
    if (this.active) return;

    this.active = this.createMeasurement(imgPoint, viewport);
    this.pressPoint = { ...imgPoint };
    this.hasMoved = false;
    this.awaitingClick = false;
    viewport.addMeasurement(this.active);
  }

  onMouseMove(e: MouseEvent, imgPoint: Point2D, viewport: Viewport): void {
    if (!this.active) return;

    // 点击式流程中：实时预览终点
    if (this.awaitingClick) {
      this.updateEndPoint(imgPoint, viewport);
      return;
    }

    if (e.buttons === 0) return; // 仅在按住左键拖动时更新

    if (this.pressPoint) {
      const tol = 3 / Math.max(0.05, viewport.getState().zoom);
      if (Math.hypot(imgPoint.x - this.pressPoint.x, imgPoint.y - this.pressPoint.y) > tol) {
        this.hasMoved = true;
      }
    }
    this.updateEndPoint(imgPoint, viewport);
  }

  onMouseUp(_e: MouseEvent, imgPoint: Point2D, viewport: Viewport): void {
    if (!this.active || this.awaitingClick) return;

    if (this.hasMoved) {
      this.updateEndPoint(imgPoint, viewport);
      this.finish(viewport);
    } else {
      // 位移不足视为单击 -> 进入点击式流程
      this.awaitingClick = true;
    }
  }

  /** Esc 取消进行中的绘制 */
  cancel(viewport: Viewport): void {
    if (this.active) {
      viewport.removeMeasurement(this.active.id);
    }
    this.reset();
  }

  hasPendingMeasurement(): boolean {
    return this.active !== null;
  }

  protected finish(viewport: Viewport): void {
    if (!this.active) return;
    recalculateMeasurement(this.active, viewport);
    viewport.updateMeasurement(this.active);
    this.reset();
  }

  private reset(): void {
    this.active = null;
    this.pressPoint = null;
    this.hasMoved = false;
    this.awaitingClick = false;
  }
}

export class LengthTool extends DragCreateTool {
  readonly type: ToolType = 'length';
  readonly nameZh: string = '直线测距 (Length)';

  protected createMeasurement(pt: Point2D, viewport: Viewport): Measurement {
    return {
      id: `len_${Date.now()}`,
      type: 'length',
      imageIndex: viewport.getState().currentImageIndex,
      points: [{ ...pt }, { ...pt }],
      data: {}
    };
  }

  protected updateEndPoint(pt: Point2D, viewport: Viewport): void {
    if (!this.active) return;
    this.active.points[1] = { ...pt };
    recalculateMeasurement(this.active, viewport);
    viewport.updateMeasurement(this.active);
  }
}

export class ArrowTool extends DragCreateTool {
  readonly type: ToolType = 'arrow';
  readonly nameZh: string = '箭头标注 (Arrow)';

  protected createMeasurement(pt: Point2D, viewport: Viewport): Measurement {
    return {
      id: `arr_${Date.now()}`,
      type: 'arrow',
      imageIndex: viewport.getState().currentImageIndex,
      points: [{ ...pt }, { ...pt }],
      data: { text: '病灶标注' }
    };
  }

  protected updateEndPoint(pt: Point2D, viewport: Viewport): void {
    if (!this.active) return;
    this.active.points[1] = { ...pt };
    viewport.updateMeasurement(this.active);
  }
}

export class RectangleRoiTool extends DragCreateTool {
  readonly type: ToolType = 'rectangleRoi';
  readonly nameZh: string = '矩形 ROI (Area/HU)';

  protected createMeasurement(pt: Point2D, viewport: Viewport): Measurement {
    return {
      id: `rect_${Date.now()}`,
      type: 'rectangleRoi',
      imageIndex: viewport.getState().currentImageIndex,
      points: [{ ...pt }, { ...pt }],
      data: {}
    };
  }

  protected updateEndPoint(pt: Point2D, viewport: Viewport): void {
    if (!this.active) return;
    this.active.points[1] = { ...pt };
    recalculateMeasurement(this.active, viewport);
    viewport.updateMeasurement(this.active);
  }
}

export class EllipseRoiTool extends DragCreateTool {
  readonly type: ToolType = 'ellipseRoi';
  readonly nameZh: string = '椭圆 ROI (Area/HU)';

  protected createMeasurement(pt: Point2D, viewport: Viewport): Measurement {
    return {
      id: `ellip_${Date.now()}`,
      type: 'ellipseRoi',
      imageIndex: viewport.getState().currentImageIndex,
      points: [{ ...pt }, { ...pt }],
      data: {}
    };
  }

  protected updateEndPoint(pt: Point2D, viewport: Viewport): void {
    if (!this.active) return;
    this.active.points[1] = { ...pt };
    recalculateMeasurement(this.active, viewport);
    viewport.updateMeasurement(this.active);
  }
}

/**
 * 角度测量：三次点击（起点 -> 顶点 -> 终点），移动过程中实时预览
 */
export class AngleTool extends BaseTool {
  readonly type: ToolType = 'angle';
  readonly nameZh: string = '角度测量 (Angle)';
  readonly cursor: string = 'crosshair';

  private active: Measurement | null = null;
  private clickStep = 0;

  onMouseDown(e: MouseEvent, imgPoint: Point2D, viewport: Viewport): void {
    if (e.button !== 0) return;

    if (this.clickStep === 0) {
      this.active = {
        id: `ang_${Date.now()}`,
        type: 'angle',
        imageIndex: viewport.getState().currentImageIndex,
        points: [{ ...imgPoint }, { ...imgPoint }, { ...imgPoint }],
        data: {}
      };
      viewport.addMeasurement(this.active);
      this.clickStep = 1;
      return;
    }

    if (!this.active) {
      this.clickStep = 0;
      return;
    }

    if (this.clickStep === 1) {
      this.active.points[1] = { ...imgPoint };
      this.active.points[2] = { ...imgPoint };
      this.clickStep = 2;
      return;
    }

    this.active.points[2] = { ...imgPoint };
    recalculateMeasurement(this.active, viewport);
    viewport.updateMeasurement(this.active);
    this.active = null;
    this.clickStep = 0;
  }

  onMouseMove(_e: MouseEvent, imgPoint: Point2D, viewport: Viewport): void {
    if (!this.active) return;
    if (this.clickStep === 1) {
      this.active.points[1] = { ...imgPoint };
      this.active.points[2] = { ...imgPoint };
    } else if (this.clickStep === 2) {
      this.active.points[2] = { ...imgPoint };
    } else {
      return;
    }
    recalculateMeasurement(this.active, viewport);
    viewport.updateMeasurement(this.active);
  }

  onMouseUp(): void {}

  cancel(viewport: Viewport): void {
    if (this.active) viewport.removeMeasurement(this.active.id);
    this.active = null;
    this.clickStep = 0;
  }

  hasPendingMeasurement(): boolean {
    return this.active !== null;
  }
}

/**
 * 像素探针：单击读取 HU
 */
export class ProbeTool extends BaseTool {
  readonly type: ToolType = 'probe';
  readonly nameZh: string = '像素探针 (Probe HU)';
  readonly cursor: string = 'crosshair';

  onMouseDown(e: MouseEvent, imgPoint: Point2D, viewport: Viewport): void {
    if (e.button !== 0) return;

    const m: Measurement = {
      id: `probe_${Date.now()}`,
      type: 'probe',
      imageIndex: viewport.getState().currentImageIndex,
      points: [{ ...imgPoint }],
      data: {}
    };
    recalculateMeasurement(m, viewport);
    viewport.addMeasurement(m);
  }

  onMouseMove(): void {}
  onMouseUp(): void {}
  cancel(): void {}
}
