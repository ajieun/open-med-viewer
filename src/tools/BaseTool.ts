import { ToolType, Point2D } from '../types';
import type { Viewport } from '../engine/Viewport';

export abstract class BaseTool {
  abstract readonly type: ToolType;
  abstract readonly nameZh: string;
  abstract readonly cursor: string;

  abstract onMouseDown(e: MouseEvent, imgPoint: Point2D, viewport: Viewport): void;
  abstract onMouseMove(e: MouseEvent, imgPoint: Point2D, viewport: Viewport): void;
  abstract onMouseUp(e: MouseEvent, imgPoint: Point2D, viewport: Viewport): void;

  /** Esc 取消进行中的操作（如未完成的测量绘制） */
  cancel?(viewport: Viewport): void;
  /** 是否存在未完成的绘制（用于 Esc / 切换工具时判断） */
  hasPendingMeasurement?(): boolean;

  onWheel?(e: WheelEvent, viewport: Viewport): void;
  onKeyDown?(e: KeyboardEvent, viewport: Viewport): void;

  renderOverlay?(ctx: CanvasRenderingContext2D, viewport: Viewport): void;
}
