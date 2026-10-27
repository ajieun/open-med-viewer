import { DicomImage, ViewportState, ToolType, Measurement, Point2D, ViewerEvents } from '../types';
import { EventEmitter } from '../utils/EventEmitter';
import { ImageRenderer } from './ImageRenderer';
import { ToolManager } from '../tools/ToolManager';

export class Viewport {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imageRenderer: ImageRenderer;
  private toolManager: ToolManager;
  private events: EventEmitter<ViewerEvents>;

  private images: DicomImage[] = [];
  private measurements: Measurement[] = [];
  private state: ViewportState = {
    zoom: 1,
    pan: { x: 0, y: 0 },
    rotation: 0,
    flipH: false,
    flipV: false,
    invert: false,
    windowCenter: 40,
    windowWidth: 80,
    currentImageIndex: 0,
    colormap: 'grayscale'
  };

  private resizeObserver: ResizeObserver | null = null;
  private animationFrameId: number | null = null;
  private cineIntervalId: number | null = null;
  private isCinePlaying: boolean = false;
  private cineFps: number = 15;

  /** 当前悬停 / 选中的测量标注 (用于高亮与键盘删除) */
  private hoveredMeasurementId: string | null = null;
  private selectedMeasurementId: string | null = null;

  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(container: HTMLElement, events?: EventEmitter<ViewerEvents>) {
    this.container = container;
    this.events = events || new EventEmitter<ViewerEvents>();
    this.imageRenderer = new ImageRenderer();

    // 创建主画布
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.userSelect = 'none';
    this.canvas.style.touchAction = 'none';
    // 允许画布获取焦点，使键盘快捷键即时生效
    this.canvas.tabIndex = 0;
    this.canvas.style.outline = 'none';

    this.container.innerHTML = '';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.toolManager = new ToolManager(this);

    this.initEventListeners();
    this.initResizeObserver();
  }

  // ==================== 影像与数据接口 ====================

  setImages(images: DicomImage[], initialIndex: number = 0): void {
    this.images = images;
    this.hoveredMeasurementId = null;
    this.selectedMeasurementId = null;
    if (images.length > 0) {
      const idx = Math.max(0, Math.min(initialIndex, images.length - 1));
      const first = images[idx];
      this.state.currentImageIndex = idx;
      this.state.windowCenter = first.defaultWindowCenter;
      this.state.windowWidth = first.defaultWindowWidth;
      this.resetView();
    } else {
      this.render();
    }
  }

  getImages(): DicomImage[] {
    return this.images;
  }

  getCurrentImage(): DicomImage | null {
    if (this.images.length === 0) return null;
    return this.images[this.state.currentImageIndex] || null;
  }

  setImageIndex(index: number): void {
    if (this.images.length === 0) return;
    const clamped = Math.max(0, Math.min(index, this.images.length - 1));
    if (this.state.currentImageIndex !== clamped) {
      this.state.currentImageIndex = clamped;
      const img = this.images[clamped];
      this.events.emit('imageChanged', { image: img, index: clamped });
      this.render();
    }
  }

  nextImage(): void {
    if (this.state.currentImageIndex < this.images.length - 1) {
      this.setImageIndex(this.state.currentImageIndex + 1);
    }
  }

  prevImage(): void {
    if (this.state.currentImageIndex > 0) {
      this.setImageIndex(this.state.currentImageIndex - 1);
    }
  }

  // ==================== 状态控制 ====================

  getState(): ViewportState {
    return { ...this.state, pan: { ...this.state.pan } };
  }

  setWindowLevel(wc: number, ww: number): void {
    this.state.windowCenter = wc;
    this.state.windowWidth = Math.max(1, ww);
    this.events.emit('viewportUpdated', { state: this.getState() });
    this.render();
  }

  setZoom(zoom: number): void {
    this.state.zoom = Math.max(0.05, Math.min(50, zoom));
    this.events.emit('viewportUpdated', { state: this.getState() });
    this.render();
  }

  setPan(x: number, y: number): void {
    this.state.pan = { x, y };
    this.events.emit('viewportUpdated', { state: this.getState() });
    this.render();
  }

  setRotation(deg: number): void {
    this.state.rotation = (deg % 360 + 360) % 360;
    this.events.emit('viewportUpdated', { state: this.getState() });
    this.render();
  }

  rotate90(): void {
    this.setRotation(this.state.rotation + 90);
  }

  toggleFlipH(): void {
    this.state.flipH = !this.state.flipH;
    this.events.emit('viewportUpdated', { state: this.getState() });
    this.render();
  }

  toggleFlipV(): void {
    this.state.flipV = !this.state.flipV;
    this.events.emit('viewportUpdated', { state: this.getState() });
    this.render();
  }

  toggleInvert(): void {
    this.state.invert = !this.state.invert;
    this.events.emit('viewportUpdated', { state: this.getState() });
    this.render();
  }

  setColormap(colormap: ViewportState['colormap']): void {
    this.state.colormap = colormap;
    this.events.emit('viewportUpdated', { state: this.getState() });
    this.render();
  }

  /**
   * 以指定客户端坐标为锚点缩放（滚轮 / 右键拖动）
   * 保证光标下的像素位置在缩放前后保持不动
   */
  zoomAt(clientX: number, clientY: number, factor: number): void {
    const canvasPt = this.clientToCanvas(clientX, clientY);
    const imgPtBefore = this.canvasToImage(canvasPt);

    const nextZoom = Math.max(0.05, Math.min(50, this.state.zoom * factor));
    if (Math.abs(nextZoom - this.state.zoom) < 1e-6) return;
    this.state.zoom = nextZoom;

    // 缩放后该图像点被绘制到的新位置，用平移补偿回光标处
    const after = this.imageToCanvas(imgPtBefore);
    this.state.pan.x += canvasPt.x - after.x;
    this.state.pan.y += canvasPt.y - after.y;

    this.events.emit('viewportUpdated', { state: this.getState() });
    this.render();
  }

  /** 滚轮翻层 */
  scrollSlices(steps: number): void {
    if (steps === 0 || this.images.length === 0) return;
    this.setImageIndex(this.state.currentImageIndex + steps);
  }

  /** 切换 Cine 播放状态 */
  toggleCine(): void {
    if (this.isCinePlaying) this.stopCine();
    else this.startCine(this.cineFps);
  }

  setHoveredMeasurement(id: string | null): void {
    if (this.hoveredMeasurementId === id) return;
    this.hoveredMeasurementId = id;
    this.render();
  }

  setSelectedMeasurement(id: string | null): void {
    if (this.selectedMeasurementId === id) return;
    this.selectedMeasurementId = id;
    this.render();
  }

  getSelectedMeasurementId(): string | null {
    return this.selectedMeasurementId;
  }

  resetView(): void {
    const img = this.getCurrentImage();
    if (!img) return;

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (cw === 0 || ch === 0) return;

    // 默认适合视口 (Fit to Viewport)
    const scaleX = (cw * 0.9) / img.width;
    const scaleY = (ch * 0.9) / img.height;
    this.state.zoom = Math.min(scaleX, scaleY);
    this.state.pan = { x: 0, y: 0 };
    this.state.rotation = 0;
    this.state.flipH = false;
    this.state.flipV = false;

    this.events.emit('viewportUpdated', { state: this.getState() });
    this.render();
  }

  // ==================== Cine 序列动画播放 ====================

  startCine(fps: number = 15): void {
    if (this.isCinePlaying) this.stopCine();
    this.isCinePlaying = true;
    this.cineFps = Math.max(1, Math.min(60, fps));

    this.cineIntervalId = window.setInterval(() => {
      let next = this.state.currentImageIndex + 1;
      if (next >= this.images.length) next = 0;
      this.setImageIndex(next);
      this.events.emit('cineStateChanged', {
        isPlaying: true,
        fps: this.cineFps,
        frame: next
      });
    }, 1000 / this.cineFps);

    this.events.emit('cineStateChanged', { isPlaying: true, fps: this.cineFps, frame: this.state.currentImageIndex });
  }

  stopCine(): void {
    if (this.cineIntervalId !== null) {
      clearInterval(this.cineIntervalId);
      this.cineIntervalId = null;
    }
    this.isCinePlaying = false;
    this.events.emit('cineStateChanged', { isPlaying: false, fps: this.cineFps, frame: this.state.currentImageIndex });
  }

  isCineActive(): boolean {
    return this.isCinePlaying;
  }

  // ==================== 测量标注 ====================

  addMeasurement(m: Measurement): void {
    this.measurements.push(m);
    this.events.emit('measurementAdded', { measurement: m });
    this.render();
  }

  updateMeasurement(m: Measurement): void {
    const idx = this.measurements.findIndex((item) => item.id === m.id);
    if (idx !== -1) {
      this.measurements[idx] = m;
      this.events.emit('measurementUpdated', { measurement: m });
      this.render();
    }
  }

  removeMeasurement(id: string): void {
    this.measurements = this.measurements.filter((m) => m.id !== id);
    this.events.emit('measurementRemoved', { measurementId: id });
    this.render();
  }

  clearMeasurements(): void {
    this.measurements = [];
    this.events.emit('measurementsCleared');
    this.render();
  }

  getMeasurements(): Measurement[] {
    return this.measurements;
  }

  /**
   * 整体替换测量集合（用于序列切换时恢复各自标注）
   */
  setMeasurements(measurements: Measurement[]): void {
    this.measurements = measurements;
    this.hoveredMeasurementId = null;
    this.selectedMeasurementId = null;
    this.events.emit('measurementsCleared');
    this.render();
  }

  // ==================== 工具管理 ====================

  setActiveTool(tool: ToolType): void {
    this.toolManager.setActiveTool(tool);
    this.events.emit('toolChanged', { activeTool: tool });
  }

  getActiveTool(): ToolType {
    return this.toolManager.getActiveToolType();
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  // ==================== 渲染核心 ====================

  render(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.animationFrameId = requestAnimationFrame(() => this.doRender());
  }

  private doRender(): void {
    const { width, height } = this.canvas;
    if (width === 0 || height === 0) return;

    this.ctx.fillStyle = '#0a0d14';
    this.ctx.fillRect(0, 0, width, height);

    const img = this.getCurrentImage();
    if (!img) {
      this.drawEmptyPlaceholder();
      return;
    }

    // 1. 渲染 DICOM 影像至离屏并绘制到中心
    const offscreen = this.imageRenderer.renderToCanvas(
      img,
      this.state.windowCenter,
      this.state.windowWidth,
      this.state.invert,
      this.state.colormap
    );

    this.ctx.save();
    // 平移到中心 + 用户平移
    this.ctx.translate(width / 2 + this.state.pan.x, height / 2 + this.state.pan.y);
    this.ctx.rotate((this.state.rotation * Math.PI) / 180);
    this.ctx.scale(this.state.flipH ? -this.state.zoom : this.state.zoom, this.state.flipV ? -this.state.zoom : this.state.zoom);

    // 图像平滑设置
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(offscreen, -img.width / 2, -img.height / 2);

    this.ctx.restore();

    // 2. 绘制测量标注 (当前层)
    this.drawMeasurements();

    // 3. 绘制医学解剖方向标记 (A, P, L, R)
    this.drawOrientationMarkers();

    // 4. 绘制四角元数据 HUD 信息
    this.drawCornerHud(img);
  }

  private drawEmptyPlaceholder(): void {
    this.ctx.fillStyle = '#4a5568';
    this.ctx.font = '14px Inter, system-ui, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('等待影像载入...', this.canvas.width / 2, this.canvas.height / 2);
  }

  private drawMeasurements(): void {
    const currentIdx = this.state.currentImageIndex;
    const items = this.measurements.filter((m) => m.imageIndex === currentIdx);

    for (const m of items) {
      const isSelected = m.id === this.selectedMeasurementId;
      const isHovered = m.id === this.hoveredMeasurementId;

      this.ctx.save();
      const color = m.color || '#00e5ff';
      this.ctx.strokeStyle = color;
      this.ctx.fillStyle = color;
      this.ctx.lineWidth = isSelected ? 2.5 : isHovered ? 2 : 1.5;
      if (isSelected || isHovered) {
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = isSelected ? 8 : 5;
      }

      switch (m.type) {
        case 'length': {
          if (m.points.length >= 2) {
            const c1 = this.imageToCanvas(m.points[0]);
            const c2 = this.imageToCanvas(m.points[1]);

            // 画线与两端标尺横杠
            this.ctx.beginPath();
            this.ctx.moveTo(c1.x, c1.y);
            this.ctx.lineTo(c2.x, c2.y);
            this.ctx.stroke();

            this.drawHandle(c1);
            this.drawHandle(c2);

            // 标注文本
            if (m.data.text) {
              const midX = (c1.x + c2.x) / 2;
              const midY = (c1.y + c2.y) / 2;
              this.drawTagText(m.data.text, midX + 10, midY - 5);
            }
          }
          break;
        }

        case 'angle': {
          if (m.points.length >= 3) {
            const p1 = this.imageToCanvas(m.points[0]);
            const v = this.imageToCanvas(m.points[1]);
            const p3 = this.imageToCanvas(m.points[2]);

            this.ctx.beginPath();
            this.ctx.moveTo(p1.x, p1.y);
            this.ctx.lineTo(v.x, v.y);
            this.ctx.lineTo(p3.x, p3.y);
            this.ctx.stroke();

            this.drawHandle(p1);
            this.drawHandle(v);
            this.drawHandle(p3);

            if (m.data.text) {
              this.drawTagText(m.data.text, v.x + 12, v.y - 10);
            }
          }
          break;
        }

        case 'rectangleRoi': {
          if (m.points.length >= 2) {
            const p1 = this.imageToCanvas(m.points[0]);
            const p2 = this.imageToCanvas(m.points[1]);
            const rx = Math.min(p1.x, p2.x);
            const ry = Math.min(p1.y, p2.y);
            const rw = Math.abs(p2.x - p1.x);
            const rh = Math.abs(p2.y - p1.y);

            this.ctx.strokeRect(rx, ry, rw, rh);
            this.drawHandle(p1);
            this.drawHandle(p2);

            if (m.data.text) {
              this.drawTagText(m.data.text, rx + rw + 8, ry + 15);
            }
          }
          break;
        }

        case 'ellipseRoi': {
          if (m.points.length >= 2) {
            const p1 = this.imageToCanvas(m.points[0]);
            const p2 = this.imageToCanvas(m.points[1]);
            const cx = p1.x;
            const cy = p1.y;
            const rx = Math.abs(p2.x - p1.x);
            const ry = Math.abs(p2.y - p1.y);

            this.ctx.beginPath();
            this.ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
            this.ctx.stroke();

            this.drawHandle(p1);
            this.drawHandle(p2);

            if (m.data.text) {
              this.drawTagText(m.data.text, cx + rx + 8, cy);
            }
          }
          break;
        }

        case 'probe': {
          if (m.points.length >= 1) {
            const p = this.imageToCanvas(m.points[0]);
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            this.ctx.fill();

            // 十字丝
            this.ctx.beginPath();
            this.ctx.moveTo(p.x - 10, p.y);
            this.ctx.lineTo(p.x + 10, p.y);
            this.ctx.moveTo(p.x, p.y - 10);
            this.ctx.lineTo(p.x, p.y + 10);
            this.ctx.stroke();

            if (m.data.text) {
              this.drawTagText(m.data.text, p.x + 12, p.y - 12);
            }
          }
          break;
        }

        case 'arrow': {
          if (m.points.length >= 2) {
            const p1 = this.imageToCanvas(m.points[0]);
            const p2 = this.imageToCanvas(m.points[1]);

            this.ctx.beginPath();
            this.ctx.moveTo(p1.x, p1.y);
            this.ctx.lineTo(p2.x, p2.y);
            this.ctx.stroke();

            // 绘制箭头尖部
            const headlen = 10;
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            this.ctx.beginPath();
            this.ctx.moveTo(p2.x, p2.y);
            this.ctx.lineTo(p2.x - headlen * Math.cos(angle - Math.PI / 6), p2.y - headlen * Math.sin(angle - Math.PI / 6));
            this.ctx.lineTo(p2.x - headlen * Math.cos(angle + Math.PI / 6), p2.y - headlen * Math.sin(angle + Math.PI / 6));
            this.ctx.closePath();
            this.ctx.fill();

            if (m.data.text) {
              this.drawTagText(m.data.text, p1.x - 10, p1.y - 10);
            }
          }
          break;
        }
      }

      this.ctx.restore();
    }
  }

  private drawHandle(point: Point2D): void {
    this.ctx.beginPath();
    this.ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fill();
    this.ctx.strokeStyle = '#00e5ff';
    this.ctx.stroke();
  }

  private drawTagText(text: string, x: number, y: number): void {
    const lines = text.split('\n');
    this.ctx.font = '11px "JetBrains Mono", Consolas, monospace';
    const lineHeight = 14;

    let maxWidth = 0;
    for (const l of lines) {
      const w = this.ctx.measureText(l).width;
      if (w > maxWidth) maxWidth = w;
    }

    // 绘制半透明背景
    this.ctx.fillStyle = 'rgba(10, 15, 25, 0.85)';
    this.ctx.fillRect(x - 4, y - 10, maxWidth + 8, lines.length * lineHeight + 4);
    this.ctx.strokeStyle = '#00e5ff';
    this.ctx.lineWidth = 0.8;
    this.ctx.strokeRect(x - 4, y - 10, maxWidth + 8, lines.length * lineHeight + 4);

    this.ctx.fillStyle = '#00e5ff';
    for (let i = 0; i < lines.length; i++) {
      this.ctx.fillText(lines[i], x, y + i * lineHeight);
    }
  }

  private drawOrientationMarkers(): void {
    const { width, height } = this.canvas;
    this.ctx.save();
    this.ctx.font = 'bold 13px Inter, sans-serif';
    this.ctx.fillStyle = '#facc15'; // 经典医学黄色方向标
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    // 考虑旋转角对方向字母的置换
    const rot = Math.round(this.state.rotation / 90) % 4;
    const baseLabels = ['A', 'R', 'P', 'L']; // 上、右、下、左 (轴位默认: Top=Anterior, Right=Right, Bottom=Posterior, Left=Left)
    const shifted = baseLabels.slice(rot).concat(baseLabels.slice(0, rot));

    this.ctx.fillText(shifted[0], width / 2, 20); // Top
    this.ctx.fillText(shifted[1], width - 20, height / 2); // Right
    this.ctx.fillText(shifted[2], width / 2, height - 20); // Bottom
    this.ctx.fillText(shifted[3], 20, height / 2); // Left

    this.ctx.restore();
  }

  private drawCornerHud(img: DicomImage): void {
    const { width, height } = this.canvas;
    const meta = img.metadata;
    this.ctx.save();
    this.ctx.font = '12px "SF Pro Text", system-ui, sans-serif';
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';

    // 左上角: 患者信息
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(`姓名: ${meta.patientName || 'ANONYMOUS'}`, 14, 14);
    this.ctx.fillText(`ID: ${meta.patientId || 'UNKNOWN'}`, 14, 32);
    this.ctx.fillText(`性别/年龄: ${meta.patientSex || 'O'} / ${meta.patientBirthDate || '--'}`, 14, 50);
    this.ctx.fillText(`模态: ${meta.modality || 'CT'}`, 14, 68);

    // 右上角: 检查与序列
    this.ctx.textAlign = 'right';
    this.ctx.fillText(`日期: ${meta.studyDate || '--'}`, width - 14, 14);
    this.ctx.fillText(`描述: ${meta.seriesDescription || meta.studyDescription || 'Routine'}`, width - 14, 32);
    this.ctx.fillText(`层厚: ${meta.sliceThickness ? meta.sliceThickness + 'mm' : '--'}`, width - 14, 50);
    this.ctx.fillText(`矩阵: ${meta.columns} x ${meta.rows}`, width - 14, 68);

    // 左下角: 切片进度与缩放
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'bottom';
    const sliceIdx = this.state.currentImageIndex + 1;
    const totalSlices = this.images.length;
    this.ctx.fillText(`层数: ${sliceIdx} / ${totalSlices}`, 14, height - 50);
    this.ctx.fillText(`位置: ${meta.sliceLocation !== undefined ? meta.sliceLocation.toFixed(1) + 'mm' : '--'}`, 14, height - 32);
    this.ctx.fillText(`缩放: ${(this.state.zoom * 100).toFixed(0)}%`, 14, height - 14);

    // 右下角: 窗宽窗位
    this.ctx.textAlign = 'right';
    this.ctx.fillText(`W: ${Math.round(this.state.windowWidth)} C: ${Math.round(this.state.windowCenter)}`, width - 14, height - 14);
    if (this.state.invert) {
      this.ctx.fillText(`[反相]`, width - 14, height - 32);
    }

    this.ctx.restore();
  }

  // ==================== 坐标转换 ====================

  canvasToImage(canvasPt: Point2D): Point2D {
    const img = this.getCurrentImage();
    if (!img) return { x: 0, y: 0 };

    const { width, height } = this.canvas;
    // 逆平移
    let x = canvasPt.x - (width / 2 + this.state.pan.x);
    let y = canvasPt.y - (height / 2 + this.state.pan.y);

    // 逆旋转
    const rad = (-this.state.rotation * Math.PI) / 180;
    const rx = x * Math.cos(rad) - y * Math.sin(rad);
    const ry = x * Math.sin(rad) + y * Math.cos(rad);

    // 逆缩放与翻转
    const scaleX = this.state.flipH ? -this.state.zoom : this.state.zoom;
    const scaleY = this.state.flipV ? -this.state.zoom : this.state.zoom;

    const imgX = rx / scaleX + img.width / 2;
    const imgY = ry / scaleY + img.height / 2;

    return { x: imgX, y: imgY };
  }

  imageToCanvas(imgPt: Point2D): Point2D {
    const img = this.getCurrentImage();
    if (!img) return { x: 0, y: 0 };

    const { width, height } = this.canvas;
    let x = (imgPt.x - img.width / 2);
    let y = (imgPt.y - img.height / 2);

    const scaleX = this.state.flipH ? -this.state.zoom : this.state.zoom;
    const scaleY = this.state.flipV ? -this.state.zoom : this.state.zoom;
    x *= scaleX;
    y *= scaleY;

    const rad = (this.state.rotation * Math.PI) / 180;
    const rx = x * Math.cos(rad) - y * Math.sin(rad);
    const ry = x * Math.sin(rad) + y * Math.cos(rad);

    return {
      x: rx + (width / 2 + this.state.pan.x),
      y: ry + (height / 2 + this.state.pan.y)
    };
  }

  clientToCanvas(clientX: number, clientY: number): Point2D {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (this.canvas.width / rect.width),
      y: (clientY - rect.top) * (this.canvas.height / rect.height)
    };
  }

  // ==================== DOM 事件绑定 ====================

  private initEventListeners(): void {
    // 阻止右键菜单默认弹出（右键用于缩放）
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('mousedown', (e) => {
      // 点击画布即聚焦，保证键盘快捷键可用
      this.canvas.focus({ preventScroll: true });
      const imgPt = this.canvasToImage(this.clientToCanvas(e.clientX, e.clientY));
      const handled = this.toolManager.handleMouseDown(e, imgPt);
      if (handled) e.preventDefault();
      this.render();
    });

    // 移动/抬起事件挂在 window 上：拖出画布后手势仍然连续
    window.addEventListener('mousemove', this.onWindowMouseMove);
    window.addEventListener('mouseup', this.onWindowMouseUp);

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        const handled = this.toolManager.handleWheel(e);
        if (handled) this.render();
      },
      { passive: false }
    );

    // 双击适配窗口
    this.canvas.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.toolManager.handleDoubleClick();
    });

    this.keydownHandler = (e) => this.handleKeyDown(e);
    window.addEventListener('keydown', this.keydownHandler);
  }

  private onWindowMouseMove = (e: MouseEvent): void => {
    // 未拖拽且指针不在画布上时不做任何处理，避免无谓重绘
    if (!this.toolManager.isInteracting() && e.target !== this.canvas) return;

    const imgPt = this.canvasToImage(this.clientToCanvas(e.clientX, e.clientY));
    const needsRender = this.toolManager.handleMouseMove(e, imgPt);
    if (needsRender) this.render();
  };

  private onWindowMouseUp = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const outside =
      e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
    if (outside && !this.toolManager.isInteracting()) return;

    const imgPt = this.canvasToImage(this.clientToCanvas(e.clientX, e.clientY));
    const needsRender = this.toolManager.handleMouseUp(e, imgPt);
    if (needsRender) this.render();
  };

  // ==================== 键盘快捷键 ====================

  private handleKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    // 输入类元素内不拦截按键
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;

    const active = document.activeElement as HTMLElement | null;
    const focusInViewer =
      !active || active === document.body || active === this.canvas || this.container.contains(active);
    if (!focusInViewer) return;

    // 带功能键的组合交由浏览器处理
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const zoomStep = 1.15;
    let handled = true;

    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowLeft':
      case 'PageUp':
        this.prevImage();
        break;
      case 'ArrowDown':
      case 'ArrowRight':
      case 'PageDown':
        this.nextImage();
        break;
      case 'Home':
        this.setImageIndex(0);
        break;
      case 'End':
        this.setImageIndex(this.images.length - 1);
        break;
      case '+':
      case '=':
        this.setZoom(this.state.zoom * zoomStep);
        break;
      case '-':
      case '_':
        this.setZoom(this.state.zoom / zoomStep);
        break;
      case '0':
      case 'r':
      case 'R':
        this.resetView();
        break;
      case 'i':
      case 'I':
        this.toggleInvert();
        break;
      case 'h':
      case 'H':
        this.toggleFlipH();
        break;
      case 'v':
      case 'V':
        this.toggleFlipV();
        break;
      case 't':
      case 'T':
        this.rotate90();
        break;
      case ' ':
        this.toggleCine();
        break;
      case 'Escape':
        this.toolManager.cancel();
        this.render();
        break;
      case 'Delete':
      case 'Backspace':
        this.toolManager.deleteSelected();
        break;
      default:
        handled = false;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  private initResizeObserver(): void {
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          const dpr = window.devicePixelRatio || 1;
          this.canvas.width = Math.round(width * dpr);
          this.canvas.height = Math.round(height * dpr);
          this.render();
        }
      }
    });
    this.resizeObserver.observe(this.container);
  }

  destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    window.removeEventListener('mousemove', this.onWindowMouseMove);
    window.removeEventListener('mouseup', this.onWindowMouseUp);
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    this.stopCine();
    this.container.innerHTML = '';
  }
}
