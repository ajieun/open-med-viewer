import { BaseTool } from './BaseTool';
import { ToolType, Point2D } from '../types';
import type { Viewport } from '../engine/Viewport';

export class WindowLevelTool extends BaseTool {
  readonly type: ToolType = 'windowLevel';
  readonly nameZh: string = '调窗 (WW/WC)';
  readonly cursor: string = 'crosshair';

  private isDragging: boolean = false;
  private startPoint: Point2D = { x: 0, y: 0 };
  private startWC: number = 0;
  private startWW: number = 0;

  onMouseDown(e: MouseEvent, _imgPoint: Point2D, viewport: Viewport): void {
    if (e.button !== 0 && e.button !== 2) return; // 支持左键或右键
    this.isDragging = true;
    this.startPoint = { x: e.clientX, y: e.clientY };
    const state = viewport.getState();
    this.startWC = state.windowCenter;
    this.startWW = state.windowWidth;
  }

  onMouseMove(e: MouseEvent, _imgPoint: Point2D, viewport: Viewport): void {
    if (!this.isDragging) return;

    const dx = e.clientX - this.startPoint.x;
    const dy = e.clientY - this.startPoint.y;

    // 灵敏度比例
    const sensitivity = Math.max(1, this.startWW) / 400.0;
    const newWW = Math.max(1, Math.round(this.startWW + dx * sensitivity * 2));
    const newWC = Math.round(this.startWC - dy * sensitivity * 2);

    viewport.setWindowLevel(newWC, newWW);
  }

  onMouseUp(_e: MouseEvent, _imgPoint: Point2D, _viewport: Viewport): void {
    this.isDragging = false;
  }
}
