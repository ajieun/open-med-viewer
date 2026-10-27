import { ViewportLayout, DicomImage, ToolType } from '../types';
import { Viewport } from '../engine/Viewport';
import { EventEmitter } from '../utils/EventEmitter';
import { ViewerEvents } from '../types';

export class LayoutManager {
  private container: HTMLElement;
  private viewports: Viewport[] = [];
  private activeIndex: number = 0;
  private currentLayout: ViewportLayout = '1x1';
  private events: EventEmitter<ViewerEvents>;
  private isSyncScroll: boolean = false;
  private isSyncWindowLevel: boolean = false;

  constructor(container: HTMLElement, events: EventEmitter<ViewerEvents>) {
    this.container = container;
    this.events = events;
    this.container.style.display = 'grid';
    this.container.style.width = '100%';
    this.container.style.height = '100%';
    this.container.style.gap = '2px';
    this.container.style.backgroundColor = '#1e293b';

    this.setLayout('1x1');
  }

  setLayout(layout: ViewportLayout): void {
    this.currentLayout = layout;

    // 清理现有视口
    this.viewports.forEach((vp) => vp.destroy());
    this.viewports = [];
    this.container.innerHTML = '';

    const { rows, cols } = this.getGridDimensions(layout);
    this.container.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    this.container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

    const count = rows * cols;
    for (let i = 0; i < count; i++) {
      const cell = document.createElement('div');
      cell.className = 'med-viewport-cell';
      cell.style.position = 'relative';
      cell.style.width = '100%';
      cell.style.height = '100%';
      cell.style.overflow = 'hidden';
      cell.style.boxSizing = 'border-box';
      cell.style.border = i === this.activeIndex ? '1.5px solid #00e5ff' : '1px solid #1e293b';

      cell.addEventListener('mousedown', () => {
        this.setActiveIndex(i);
      });

      this.container.appendChild(cell);

      const vp = new Viewport(cell, this.events);
      this.bindViewportSync(vp, i);
      this.viewports.push(vp);
    }

    this.events.emit('layoutChanged', { layout });
  }

  getLayout(): ViewportLayout {
    return this.currentLayout;
  }

  getViewports(): Viewport[] {
    return this.viewports;
  }

  getActiveViewport(): Viewport {
    return this.viewports[this.activeIndex] || this.viewports[0];
  }

  getActiveIndex(): number {
    return this.activeIndex;
  }

  setActiveIndex(index: number): void {
    if (index >= 0 && index < this.viewports.length) {
      this.activeIndex = index;
      const cells = this.container.querySelectorAll('.med-viewport-cell');
      cells.forEach((cell, idx) => {
        (cell as HTMLElement).style.border = idx === index ? '1.5px solid #00e5ff' : '1px solid #1e293b';
      });
    }
  }

  setImagesForActive(images: DicomImage[], initialIndex: number = 0): void {
    const vp = this.getActiveViewport();
    vp?.setImages(images, initialIndex);
  }

  setImagesForAll(images: DicomImage[]): void {
    this.viewports.forEach((vp) => vp.setImages(images));
  }

  setActiveTool(tool: ToolType): void {
    this.viewports.forEach((vp) => vp.setActiveTool(tool));
  }

  setSyncScroll(enabled: boolean): void {
    this.isSyncScroll = enabled;
  }

  setSyncWindowLevel(enabled: boolean): void {
    this.isSyncWindowLevel = enabled;
  }

  private bindViewportSync(vp: Viewport, sourceIndex: number): void {
    // 监听图像切换联动
    vp.getCanvas().addEventListener('wheel', () => {
      if (!this.isSyncScroll) return;
      const curIdx = vp.getState().currentImageIndex;
      this.viewports.forEach((targetVp, idx) => {
        if (idx !== sourceIndex) {
          targetVp.setImageIndex(curIdx);
        }
      });
    });
  }

  private getGridDimensions(layout: ViewportLayout): { rows: number; cols: number } {
    switch (layout) {
      case '1x1':
        return { rows: 1, cols: 1 };
      case '1x2':
        return { rows: 1, cols: 2 };
      case '2x1':
        return { rows: 2, cols: 1 };
      case '2x2':
        return { rows: 2, cols: 2 };
      case '1x3':
        return { rows: 1, cols: 3 };
      case '3x3':
        return { rows: 3, cols: 3 };
      default:
        return { rows: 1, cols: 1 };
    }
  }
}
