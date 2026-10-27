import { ToolType, Point2D, Measurement } from '../types';
import { BaseTool } from './BaseTool';
import { WindowLevelTool } from './WindowLevelTool';
import { PanTool, ZoomTool, RotateTool } from './TransformTools';
import { LengthTool, AngleTool, RectangleRoiTool, EllipseRoiTool, ProbeTool, ArrowTool } from './MeasurementTools';
import { hitTestMeasurement, recalculateMeasurement, translateMeasurement } from './MeasurementMath';
import type { Viewport } from '../engine/Viewport';

/** 手势类型 */
type GestureKind = 'windowLevel' | 'zoom' | 'pan' | 'tool' | 'edit';

interface EditSession {
  measurement: Measurement;
  handleIndex: number | null;
  startPoints: Point2D[];
  startImg: Point2D;
  lastImg: Point2D;
  moved: boolean;
}

interface Gesture {
  kind: GestureKind;
  button: number;
  lastClient: Point2D;
  edit?: EditSession;
}

/**
 * 工具与交互调度中心
 *
 * 鼠标映射（与工具栏当前选中的工具无关的固定手势）：
 *   - 左键拖动           : 当前激活工具（默认 调窗 WW/WC）
 *   - 右键拖动           : 缩放（以光标为锚点）
 *   - 中键拖动           : 平移
 *   - Shift + 左键拖动   : 平移
 *   - Ctrl/⌘ + 左键拖动  : 缩放
 *   - Alt + 左键拖动     : 调窗
 *   - 滚轮               : 上一张 / 下一张（触控板平滑累积）
 *   - Ctrl/⌘ + 滚轮      : 以光标为锚点缩放
 *   - Alt + 滚轮         : 调窗宽
 *   - 双击               : 适配窗口（重置视图）
 *
 * 测量编辑（左键）：
 *   - 命中控制点 -> 拖动调整端点
 *   - 命中标注本体 -> 整体平移
 */
export class ToolManager {
  private tools: Map<ToolType, BaseTool> = new Map();
  private activeToolType: ToolType = 'windowLevel';
  private viewport: Viewport;

  private gesture: Gesture | null = null;
  private wheelAccum = 0;
  private wheelResetTimer: number | null = null;
  private hoveredId: string | null = null;

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    this.registerDefaultTools();
  }

  private registerDefaultTools(): void {
    this.registerTool(new WindowLevelTool());
    this.registerTool(new PanTool());
    this.registerTool(new ZoomTool());
    this.registerTool(new RotateTool());
    this.registerTool(new LengthTool());
    this.registerTool(new AngleTool());
    this.registerTool(new RectangleRoiTool());
    this.registerTool(new EllipseRoiTool());
    this.registerTool(new ProbeTool());
    this.registerTool(new ArrowTool());
  }

  registerTool(tool: BaseTool): void {
    this.tools.set(tool.type, tool);
  }

  setActiveTool(type: ToolType): void {
    // 切换工具时丢弃未完成的绘制
    this.cancel();

    // 浏览 / 删除 属于交互模式而非绘制工具，不注册在 tools 中
    if (type === 'none' || type === 'eraser') {
      this.activeToolType = type;
      this.viewport.getCanvas().style.cursor = this.defaultCursor();
      return;
    }

    if (this.tools.has(type)) {
      this.activeToolType = type;
      const tool = this.tools.get(type)!;
      this.viewport.getCanvas().style.cursor = tool.cursor;
    }
  }

  /** 当前交互模式的基础光标 */
  private defaultCursor(): string {
    if (this.activeToolType === 'eraser') return 'crosshair';
    if (this.activeToolType === 'none') return 'default';
    return this.getActiveTool()?.cursor || 'default';
  }

  getActiveTool(): BaseTool | undefined {
    return this.tools.get(this.activeToolType);
  }

  getActiveToolType(): ToolType {
    return this.activeToolType;
  }

  isInteracting(): boolean {
    return this.gesture !== null;
  }

  // ==================== 鼠标按下 ====================

  handleMouseDown(e: MouseEvent, imgPoint: Point2D): boolean {
    if (this.gesture) return false;

    const kind = this.resolveGestureKind(e);

    this.gesture = {
      kind,
      button: e.button,
      lastClient: { x: e.clientX, y: e.clientY }
    };

    if (kind === 'tool') {
      // 优先拾取已有测量 -> 进入编辑
      const hit = this.pickMeasurement(imgPoint);

      // 删除模式：点中即删除，不进入编辑
      if (this.activeToolType === 'eraser') {
        if (hit) {
          this.viewport.removeMeasurement(hit.measurement.id);
          this.viewport.setSelectedMeasurement(null);
          this.viewport.setHoveredMeasurement(null);
          this.hoveredId = null;
        }
        return true;
      }

      if (hit) {
        this.gesture.kind = 'edit';
        this.gesture.edit = {
          measurement: hit.measurement,
          handleIndex: hit.handleIndex,
          startPoints: hit.measurement.points.map((p) => ({ ...p })),
          startImg: { ...imgPoint },
          lastImg: { ...imgPoint },
          moved: false
        };
        this.viewport.setSelectedMeasurement(hit.measurement.id);
        this.viewport.getCanvas().style.cursor = hit.handleIndex !== null ? 'nwse-resize' : 'move';
        return true;
      }

      this.viewport.setSelectedMeasurement(null);
      this.getActiveTool()?.onMouseDown(e, imgPoint, this.viewport);
      return true;
    }

    if (kind === 'windowLevel') {
      this.tools.get('windowLevel')?.onMouseDown(e, imgPoint, this.viewport);
      return true;
    }

    if (kind === 'pan') {
      this.tools.get('pan')?.onMouseDown(e, imgPoint, this.viewport);
      return true;
    }

    if (kind === 'zoom') {
      this.viewport.getCanvas().style.cursor = 'zoom-in';
      return true;
    }

    return false;
  }

  // ==================== 鼠标移动 ====================

  handleMouseMove(e: MouseEvent, imgPoint: Point2D): boolean {
    const g = this.gesture;

    if (!g) {
      const tool = this.getActiveTool();
      let needsRender = false;

      // 点击式绘制中：鼠标移动实时预览
      if (tool?.hasPendingMeasurement?.()) {
        tool.onMouseMove(e, imgPoint, this.viewport);
        needsRender = true;
      }

      // 悬停反馈：命中测量时切换光标并高亮
      const hit = this.pickMeasurement(imgPoint);
      const hoveredId = hit ? hit.measurement.id : null;

      if (hoveredId !== this.hoveredId) {
        this.hoveredId = hoveredId;
        this.viewport.setHoveredMeasurement(hoveredId);
        needsRender = true;
      }

      let cursor: string;
      if (this.activeToolType === 'eraser') {
        cursor = hit ? 'pointer' : 'crosshair';
      } else if (hit) {
        cursor = hit.handleIndex !== null ? 'nwse-resize' : 'move';
      } else {
        cursor = this.defaultCursor();
      }
      if (this.viewport.getCanvas().style.cursor !== cursor) {
        this.viewport.getCanvas().style.cursor = cursor;
      }

      return needsRender;
    }

    switch (g.kind) {
      case 'windowLevel':
        this.tools.get('windowLevel')?.onMouseMove(e, imgPoint, this.viewport);
        return true;

      case 'pan': {
        const dx = e.clientX - g.lastClient.x;
        const dy = e.clientY - g.lastClient.y;
        g.lastClient = { x: e.clientX, y: e.clientY };
        const state = this.viewport.getState();
        this.viewport.setPan(state.pan.x + dx, state.pan.y + dy);
        return true;
      }

      case 'zoom': {
        const dy = e.clientY - g.lastClient.y;
        g.lastClient = { x: e.clientX, y: e.clientY };
        if (dy === 0) return false;
        // 向上拖动放大，向下拖动缩小
        const factor = Math.exp(-dy * 0.008);
        this.viewport.zoomAt(e.clientX, e.clientY, factor);
        return true;
      }

      case 'tool':
        this.getActiveTool()?.onMouseMove(e, imgPoint, this.viewport);
        return true;

      case 'edit':
        this.applyEdit(g, imgPoint);
        return true;

      default:
        return false;
    }
  }

  // ==================== 鼠标抬起 ====================

  handleMouseUp(e: MouseEvent, imgPoint: Point2D): boolean {
    const g = this.gesture;
    if (!g) {
      // 兜底：确保工具内部拖拽状态被复位
      this.getActiveTool()?.onMouseUp(e, imgPoint, this.viewport);
      return false;
    }

    if (g.kind === 'windowLevel') {
      this.tools.get('windowLevel')?.onMouseUp(e, imgPoint, this.viewport);
    } else if (g.kind === 'pan') {
      this.tools.get('pan')?.onMouseUp(e, imgPoint, this.viewport);
    } else if (g.kind === 'zoom') {
      this.viewport.getCanvas().style.cursor = this.defaultCursor();
    } else if (g.kind === 'tool') {
      this.getActiveTool()?.onMouseUp(e, imgPoint, this.viewport);
    } else if (g.kind === 'edit' && g.edit) {
      const m = g.edit.measurement;
      if (g.edit.moved) {
        recalculateMeasurement(m, this.viewport);
        this.viewport.updateMeasurement(m);
      }
      this.viewport.getCanvas().style.cursor = 'move';
    }

    this.gesture = null;
    return true;
  }

  // ==================== 滚轮 ====================

  handleWheel(e: WheelEvent): boolean {
    // Ctrl / ⌘ + 滚轮：以光标为中心缩放
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.viewport.zoomAt(e.clientX, e.clientY, factor);
      return true;
    }

    // Alt + 滚轮：调整窗宽
    if (e.altKey) {
      e.preventDefault();
      const st = this.viewport.getState();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      this.viewport.setWindowLevel(st.windowCenter, Math.max(1, st.windowWidth * factor));
      return true;
    }

    // 默认：滚轮翻层（累积处理，兼容鼠标滚轮与触控板）
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 100 : 1;
    this.wheelAccum += e.deltaY * unit;

    const threshold = 100;
    let steps = 0;
    while (Math.abs(this.wheelAccum) >= threshold && Math.abs(steps) < 5) {
      const dir = this.wheelAccum > 0 ? 1 : -1;
      this.wheelAccum -= dir * threshold;
      steps += dir;
    }

    if (steps !== 0) {
      this.viewport.scrollSlices(steps);
      this.resetWheelAccumLater();
      return true;
    }
    return false;
  }

  /** 双击：适配窗口 */
  handleDoubleClick(): boolean {
    this.viewport.resetView();
    return true;
  }

  // ==================== 键盘 / 取消 ====================

  /** Esc：取消未完成的测量绘制 */
  cancel(): boolean {
    const tool = this.getActiveTool();
    let consumed = false;
    if (tool?.hasPendingMeasurement?.()) {
      tool.cancel?.(this.viewport);
      consumed = true;
    } else if (tool?.cancel) {
      tool.cancel(this.viewport);
    }
    this.gesture = null;
    this.viewport.setSelectedMeasurement(null);
    this.viewport.setHoveredMeasurement(null);
    this.hoveredId = null;
    return consumed;
  }

  /** 删除当前选中/悬停的测量 */
  deleteSelected(): boolean {
    const id = this.viewport.getSelectedMeasurementId() || this.hoveredId;
    if (!id) return false;
    this.viewport.removeMeasurement(id);
    this.viewport.setSelectedMeasurement(null);
    this.viewport.setHoveredMeasurement(null);
    this.hoveredId = null;
    return true;
  }

  // ==================== 内部实现 ====================

  private resolveGestureKind(e: MouseEvent): GestureKind {
    if (e.button === 2) return 'zoom'; // 右键拖动缩放
    if (e.button === 1) return 'pan'; // 中键平移
    if (e.button === 0) {
      if (e.shiftKey) return 'pan';
      if (e.ctrlKey || e.metaKey) return 'zoom';
      if (e.altKey) return 'windowLevel';
      return 'tool';
    }
    return 'tool';
  }

  private pickMeasurement(imgPoint: Point2D) {
    const idx = this.viewport.getState().currentImageIndex;
    const list = this.viewport.getMeasurements().filter((m) => m.imageIndex === idx);
    if (list.length === 0) return null;
    return hitTestMeasurement(list, imgPoint, this.viewport.getState().zoom, 8);
  }

  private applyEdit(g: Gesture, imgPoint: Point2D): void {
    const edit = g.edit!;
    const m = edit.measurement;

    if (edit.handleIndex !== null) {
      m.points[edit.handleIndex] = { ...imgPoint };
    } else {
      translateMeasurement(m, imgPoint.x - edit.lastImg.x, imgPoint.y - edit.lastImg.y);
    }
    edit.lastImg = { ...imgPoint };

    const tol = 1 / Math.max(0.05, this.viewport.getState().zoom);
    if (
      Math.abs(imgPoint.x - edit.startImg.x) > tol ||
      Math.abs(imgPoint.y - edit.startImg.y) > tol
    ) {
      edit.moved = true;
    }

    recalculateMeasurement(m, this.viewport);
    this.viewport.updateMeasurement(m);
  }

  private resetWheelAccumLater(): void {
    if (this.wheelResetTimer !== null) window.clearTimeout(this.wheelResetTimer);
    this.wheelResetTimer = window.setTimeout(() => {
      this.wheelAccum = 0;
      this.wheelResetTimer = null;
    }, 200);
  }
}
