import { BaseTool } from './BaseTool';
import { ToolType, Point2D } from '../types';
import type { Viewport } from '../engine/Viewport';

/**
 * 指针 / 浏览模式（默认模式）：光标为箭头，左键拖动仍执行调窗，
 * 滚轮翻层、右键缩放、中键平移等固定手势不受影响。
 */
export class PointerTool extends BaseTool {
  readonly type: ToolType = 'none';
  readonly nameZh: string = '指针 (浏览)';
  readonly cursor: string = 'default';

  onMouseDown(): void {}
  onMouseMove(): void {}
  onMouseUp(): void {}
}

export class PanTool extends BaseTool {
  readonly type: ToolType = 'pan';
  readonly nameZh: string = '平移 (Pan)';
  readonly cursor: string = 'grab';

  private isDragging: boolean = false;
  private lastClient: Point2D = { x: 0, y: 0 };

  onMouseDown(e: MouseEvent, _imgPoint: Point2D, _viewport: Viewport): void {
    if (e.button !== 0 && e.button !== 1) return;
    this.isDragging = true;
    this.lastClient = { x: e.clientX, y: e.clientY };
  }

  onMouseMove(e: MouseEvent, _imgPoint: Point2D, viewport: Viewport): void {
    if (!this.isDragging) return;
    const dx = e.clientX - this.lastClient.x;
    const dy = e.clientY - this.lastClient.y;
    this.lastClient = { x: e.clientX, y: e.clientY };

    const state = viewport.getState();
    viewport.setPan(state.pan.x + dx, state.pan.y + dy);
  }

  onMouseUp(): void {
    this.isDragging = false;
  }
}

export class ZoomTool extends BaseTool {
  readonly type: ToolType = 'zoom';
  readonly nameZh: string = '缩放 (Zoom)';
  readonly cursor: string = 'zoom-in';

  private isDragging: boolean = false;
  private lastY: number = 0;

  onMouseDown(e: MouseEvent): void {
    this.isDragging = true;
    this.lastY = e.clientY;
  }

  onMouseMove(e: MouseEvent, _imgPoint: Point2D, viewport: Viewport): void {
    if (!this.isDragging) return;
    const dy = e.clientY - this.lastY;
    this.lastY = e.clientY;

    const zoomFactor = 1 - dy * 0.01;
    const currentZoom = viewport.getState().zoom;
    viewport.setZoom(Math.max(0.1, Math.min(20, currentZoom * zoomFactor)));
  }

  onMouseUp(): void {
    this.isDragging = false;
  }

  // 滚轮缩放已统一由 ToolManager.handleWheel 处理（Ctrl/⌘ + 滚轮），
  // 避免不同激活工具下滚轮行为不一致。
}

export class RotateTool extends BaseTool {
  readonly type: ToolType = 'rotate';
  readonly nameZh: string = '旋转 (Rotate)';
  readonly cursor: string = 'crosshair';

  private isDragging: boolean = false;
  private center: Point2D = { x: 0, y: 0 };
  private startAngle: number = 0;
  private initialRotation: number = 0;

  onMouseDown(e: MouseEvent, _imgPoint: Point2D, viewport: Viewport): void {
    this.isDragging = true;
    const rect = viewport.getCanvas().getBoundingClientRect();
    this.center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    this.startAngle = Math.atan2(e.clientY - this.center.y, e.clientX - this.center.x);
    this.initialRotation = viewport.getState().rotation;
  }

  onMouseMove(e: MouseEvent, _imgPoint: Point2D, viewport: Viewport): void {
    if (!this.isDragging) return;
    const currentAngle = Math.atan2(e.clientY - this.center.y, e.clientX - this.center.x);
    const deltaDeg = ((currentAngle - this.startAngle) * 180) / Math.PI;
    viewport.setRotation(Math.round((this.initialRotation + deltaDeg) % 360));
  }

  onMouseUp(): void {
    this.isDragging = false;
  }
}
