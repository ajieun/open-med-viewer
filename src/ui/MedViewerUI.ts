import {
  UnifiedImageSourceConfig,
  ToolType,
  ViewportLayout,
  DicomImage,
  ViewerEvents,
  Measurement
} from '../types';
import { EventEmitter } from '../utils/EventEmitter';
import { LayoutManager } from '../layout/LayoutManager';
import { DataSourceManager } from '../adapters/DataSourceManager';
import { ImageExporter } from '../export/ImageExporter';
import { DEFAULT_WINDOW_PRESETS } from '../dicom/WindowPresets';
import { Viewport } from '../engine/Viewport';
import { ColormapType } from '../engine/ColorMaps';
import { VtkMprEngine } from '../engine/VtkMprEngine';
import { CornerstoneAdapter } from '../engine/CornerstoneEngine';
import { SeriesGroup, groupImagesBySeries } from '../utils/SeriesGrouping';
import { createIcon } from './ToolIcons';
import { ImageRenderer } from '../engine/ImageRenderer';

export interface OpenMedViewerOptions {
  container: HTMLElement;
  initialConfig?: UnifiedImageSourceConfig;
  initialLayout?: ViewportLayout;
  initialTool?: ToolType;
  showToolbar?: boolean;
}

export class OpenMedViewer {
  private container: HTMLElement;
  private events: EventEmitter<ViewerEvents>;
  private layoutManager: LayoutManager;
  private currentImages: DicomImage[] = [];
  private activeTool: ToolType = 'none';
  private vtkEngine: VtkMprEngine | null = null;
  private is3DMode: boolean = false;

  /** 按检查部位/序列分组的页签数据 */
  private seriesGroups: SeriesGroup[] = [];
  private activeSeriesIndex: number = 0;
  /** 各序列的测量数据快照（切换页签时保存/恢复） */
  private seriesMeasurements: Map<string, Measurement[][]> = new Map();

  private cineSlider: HTMLInputElement | null = null;
  private cineInfoLabel: HTMLElement | null = null;
  private btn3D: HTMLButtonElement | null = null;
  private btnInvert: HTMLButtonElement | null = null;
  private btnFlipH: HTMLButtonElement | null = null;

  /** 交互工具按钮（与 ToolType 一一对应，用于同步高亮） */
  private toolButtons: Map<ToolType, HTMLButtonElement> = new Map();
  /** 当前工具提示文案 */
  private toolHint: HTMLElement | null = null;
  /** 状态型按钮缓存，避免重复写 DOM */
  private toggleStateCache = { invert: false, flipH: false, is3D: false };

  // DOM 元素引用
  private uiRoot!: HTMLElement;
  private topToolbar!: HTMLElement;
  private leftThumbnails!: HTMLElement;
  private viewportArea!: HTMLElement;
  private viewportGridContainer!: HTMLElement;
  private rightInspector!: HTMLElement;
  private bottomBar!: HTMLElement;
  private cloudModal!: HTMLElement;

  // 右侧序列（切片）滚动条
  private sliceScrollbar!: HTMLElement;
  private sliceScrollTrack!: HTMLElement;
  private sliceScrollThumb!: HTMLElement;
  private sliceScrollLabel!: HTMLElement;
  private sliceScrollRetry: number = 0;

  constructor(options: OpenMedViewerOptions) {
    this.container = options.container;
    this.events = new EventEmitter<ViewerEvents>();

    this.buildDOM();
    this.layoutManager = new LayoutManager(this.viewportGridContainer, this.events);

    if (options.initialLayout) {
      this.layoutManager.setLayout(options.initialLayout);
    }

    // 始终显式应用一次初始工具：未指定时统一为「浏览」，保证工具栏高亮与实际交互一致
    this.setActiveTool(options.initialTool ?? 'none');

    // 初始化默认数据源或合成演示序列
    const config = options.initialConfig || { type: 'syntheticDemo', sliceCount: 16 };
    this.loadImagesFromConfig(config);

    this.bindEvents();
  }

  getEvents(): EventEmitter<ViewerEvents> {
    return this.events;
  }

  getActiveViewport(): Viewport {
    return this.layoutManager.getActiveViewport();
  }

  setLayout(layout: ViewportLayout): void {
    this.layoutManager.setLayout(layout);

    // 排版会重建全部视口，新视口的工具会回到默认值，需要重新应用当前工具
    this.layoutManager.setActiveTool(this.activeTool);

    if (this.currentImages.length > 0) {
      this.layoutManager.setImagesForAll(this.currentImages);
      const group = this.seriesGroups[this.activeSeriesIndex];
      if (group) this.restoreMeasurements(group);
      this.updateMetadataInspector();
      this.updateCineSlider();
      this.updateSliceScrollbar();
    }

    this.updateMeasurementsList();
    this.updateToolbarActiveState();
  }

  /**
   * 按检查部位 / 序列切换页签
   */
  switchSeries(index: number): void {
    if (index < 0 || index >= this.seriesGroups.length) return;
    if (index === this.activeSeriesIndex && this.currentImages === this.seriesGroups[index].images) return;

    // 退出 3D 模式，避免展示上一个序列的体数据
    if (this.is3DMode) this.exit3DMode();

    const prev = this.seriesGroups[this.activeSeriesIndex];
    if (prev) this.snapshotMeasurements(prev);

    this.activeSeriesIndex = index;
    const group = this.seriesGroups[index];

    this.currentImages = group.images;
    this.layoutManager.setImagesForAll(group.images);
    this.restoreMeasurements(group);

    this.updateMetadataInspector();
    this.updateMeasurementsList();
    this.updateCineSlider();
    this.updateSliceScrollbar();
    this.updateSeriesListActive();
    this.updateSeriesIndicator(group);
  }

  /**
   * 获取当前导入数据的分组信息（检查部位 / 序列）
   */
  getSeriesGroups(): Array<{ label: string; bodyPart?: string; modality: string; count: number }> {
    return this.seriesGroups.map((g) => ({
      label: g.label,
      bodyPart: g.bodyPart,
      modality: g.modality,
      count: g.images.length
    }));
  }

  setActiveTool(tool: ToolType): void {
    this.activeTool = tool;
    this.layoutManager.setActiveTool(tool);
    this.updateToolbarActiveState();
  }

  /**
   * 核心方法: 统一加载不同云存储或本地配置的影像
   */
  async loadImagesFromConfig(config: UnifiedImageSourceConfig): Promise<DicomImage[]> {
    this.showLoadingToast('正在连接影像数据源...');
    try {
      const images = await DataSourceManager.loadFromConfig(config, (p) => {
        this.updateLoadingProgress(p.percent, p.currentName || '处理中...');
      });

      if (images.length === 0) {
        throw new Error('未加载到有效的 DICOM 影像数据');
      }

      // 按检查部位 / 序列分组，生成顶部切换页签
      this.seriesGroups = groupImagesBySeries(images);
      this.seriesMeasurements.clear();
      this.activeSeriesIndex = -1;
      this.renderSeriesList();
      this.switchSeries(0);

      this.hideLoadingToast();
      return images;
    } catch (err: any) {
      this.hideLoadingToast();
      alert(`导入影像失败: ${err.message || err}`);
      console.error('loadImagesFromConfig error:', err);
      return [];
    }
  }

  // ==================== DOM 构建与布局 ====================

  private buildDOM(): void {
    this.container.innerHTML = '';
    this.uiRoot = document.createElement('div');
    this.uiRoot.className = 'open-med-viewer-root';
    this.uiRoot.style.cssText = `
      position: relative;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      background: #090d16;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      overflow: hidden;
      user-select: none;
    `;

    // 1. 顶部操作栏
    this.topToolbar = document.createElement('div');
    this.topToolbar.className = 'med-toolbar';
    this.topToolbar.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 48px;
      padding: 0 12px;
      background: #111827;
      border-bottom: 1px solid #1f2937;
      z-index: 10;
      gap: 8px;
      flex-shrink: 0;
    `;
    this.initToolbarContent();

    // 2. 主体区 (左序列页签 + 中视口 + 右序列滚动条 + 右侧检查栏)
    const mainBody = document.createElement('div');
    mainBody.style.cssText = `
      display: flex;
      flex: 1;
      overflow: hidden;
      position: relative;
    `;

    // 左侧「检查部位」页签列表（每项带该序列首帧缩略图）
    this.leftThumbnails = document.createElement('div');
    this.leftThumbnails.className = 'med-thumbnails';
    this.leftThumbnails.style.cssText = `
      width: 138px;
      background: #0b0f19;
      border-right: 1px solid #1f2937;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
      flex-shrink: 0;
    `;

    // 中间视口区域（视口网格 + 右侧序列滚动条）
    this.viewportArea = document.createElement('div');
    this.viewportArea.className = 'med-viewport-area';
    this.viewportArea.style.cssText = `
      flex: 1;
      height: 100%;
      position: relative;
      display: flex;
      min-width: 0;
      background: #000;
    `;

    this.viewportGridContainer = document.createElement('div');
    this.viewportGridContainer.className = 'med-viewport-grid-wrapper';
    this.viewportGridContainer.style.cssText = `
      flex: 1;
      height: 100%;
      position: relative;
      background: #000;
      min-width: 0;
    `;

    this.viewportArea.appendChild(this.viewportGridContainer);
    this.buildSliceScrollbar();

    // 右侧检查与测量信息抽屉
    this.rightInspector = document.createElement('div');
    this.rightInspector.className = 'med-inspector';
    this.rightInspector.style.cssText = `
      width: 260px;
      background: #0d131f;
      border-left: 1px solid #1f2937;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      font-size: 12px;
      color: #94a3b8;
    `;
    this.initInspectorContent();

    mainBody.appendChild(this.leftThumbnails);
    mainBody.appendChild(this.viewportArea);
    mainBody.appendChild(this.rightInspector);

    // 3. 底部 Cine 播放与状态栏
    this.bottomBar = document.createElement('div');
    this.bottomBar.className = 'med-bottom-bar';
    this.bottomBar.style.cssText = `
      height: 38px;
      background: #111827;
      border-top: 1px solid #1f2937;
      display: flex;
      align-items: center;
      padding: 0 16px;
      gap: 16px;
      flex-shrink: 0;
      font-size: 12px;
      color: #94a3b8;
    `;
    this.initBottomBarContent();

    this.uiRoot.appendChild(this.topToolbar);
    this.uiRoot.appendChild(mainBody);
    this.uiRoot.appendChild(this.bottomBar);
    this.container.appendChild(this.uiRoot);

    // 构建云导入配置弹窗
    this.buildCloudConfigModal();
  }

  private initToolbarContent(): void {
    // 品牌标识
    const brand = document.createElement('div');
    brand.style.cssText = 'display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; color: #00e5ff; margin-right: 12px;';
    brand.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
      </svg>
      <span>OpenMed</span>
    `;

    const leftTools = document.createElement('div');
    leftTools.className = 'med-toolbar-tools';
    leftTools.style.cssText = `
      display: flex;
      align-items: center;
      gap: 4px;
      flex-wrap: nowrap;
      flex: 1 1 auto;
      min-width: 0;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    `;

    // 数据源配置按钮
    const cloudBtn = this.createToolButton('影像数据源', 'cloudSource', () => {
      this.openCloudModal();
    }, { variant: 'primary' });

    // 交互模式（互斥，同一时刻只有一个处于激活态）
    const toolDefs: Array<[ToolType, string, string]> = [
      ['none', '浏览', '拖动可选择 / 移动已有标注，不会产生新标注'],
      ['windowLevel', '调窗', '左键拖动调整窗宽窗位'],
      ['pan', '平移', '左键拖动平移图像'],
      ['zoom', '缩放', '左键上下拖动缩放'],
      ['length', '测距', '拖动绘制直线，按 PixelSpacing 计算 mm'],
      ['angle', '角度', '三次点击测量夹角'],
      ['rectangleRoi', '矩形', '拖动画矩形 ROI，统计面积与 HU'],
      ['ellipseRoi', '椭圆', '拖动画椭圆 ROI，统计面积与 HU'],
      ['probe', '探针', '点击读取该点 HU 值'],
      ['arrow', '箭头', '拖动画箭头指向病灶'],
      ['eraser', '删除', '点击任意标注即可删除（也可按 Delete 删除选中项）']
    ];

    // 一次性动作（不参与激活态高亮），使用图标按钮节省空间
    const btnRot = this.createToolButton('旋转 90°', 'rotate90', () => this.getActiveViewport().rotate90(), { iconOnly: true });
    const btnFlipH = this.createToolButton('水平翻转 (H)', 'flipH', () => this.getActiveViewport().toggleFlipH(), { iconOnly: true });
    const btnInvert = this.createToolButton('负片反相 (I)', 'invert', () => this.getActiveViewport().toggleInvert(), { iconOnly: true });
    const btnReset = this.createToolButton('重置视图 (R)', 'reset', () => this.getActiveViewport().resetView(), { iconOnly: true });
    this.btnFlipH = btnFlipH;
    this.btnInvert = btnInvert;

    // 标注管理
    const btnClear = this.createToolButton('清空标注', 'clearMeasurements', () => this.clearAllMeasurements(), {
      variant: 'danger'
    });

    // 窗宽窗位预设下拉框
    const presetSelect = document.createElement('select');
    presetSelect.style.cssText = `
      background: #1f2937;
      color: #f1f5f9;
      border: 1px solid #374151;
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 12px;
      cursor: pointer;
    `;
    presetSelect.innerHTML = `<option value="">窗宽窗位预设</option>` +
      DEFAULT_WINDOW_PRESETS.map((p) => `<option value="${p.windowCenter},${p.windowWidth}">${p.nameZh} (${p.windowCenter}/${p.windowWidth})</option>`).join('');
    presetSelect.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value;
      if (val) {
        const [c, w] = val.split(',').map(Number);
        this.getActiveViewport().setWindowLevel(c, w);
      }
    });

    // 伪彩映射下拉框
    const colormapSelect = document.createElement('select');
    colormapSelect.style.cssText = presetSelect.style.cssText;
    colormapSelect.innerHTML = `
      <option value="grayscale">灰度 (Grayscale)</option>
      <option value="hot-iron">热铁色 (Hot Iron)</option>
      <option value="rainbow">彩虹色 (Rainbow)</option>
      <option value="pet">PET反相</option>
      <option value="bone">骨增强 (Bone)</option>
    `;
    colormapSelect.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value as ColormapType;
      this.getActiveViewport().setColormap(val);
    });

    // 排版网格
    const layoutSelect = document.createElement('select');
    layoutSelect.style.cssText = presetSelect.style.cssText;
    layoutSelect.innerHTML = `
      <option value="1x1">1 x 1 单幅</option>
      <option value="1x2">1 x 2 双联</option>
      <option value="2x1">2 x 1 上下</option>
      <option value="2x2">2 x 2 四分格</option>
    `;
    layoutSelect.addEventListener('change', (e) => {
      this.setLayout((e.target as HTMLSelectElement).value as ViewportLayout);
    });

    // 3D VTK 重建模式切换按钮
    const btn3D = this.createToolButton('3D 体积重建', 'vtk3d', () => {
      this.toggle3DVtkMode(btn3D);
    }, { variant: 'accent', iconOnly: true });
    this.btn3D = btn3D;

    // 快照导出按钮
    const exportBtn = this.createToolButton('导出截图', 'export', () => {
      ImageExporter.exportViewportImage(this.getActiveViewport());
    }, { iconOnly: true });

    // 工具分组：数据源 | 交互模式 | 视图变换 | 测量 | 标注管理 | 预设 / 3D / 导出
    leftTools.appendChild(cloudBtn);
    leftTools.appendChild(this.createDivider());
    toolDefs.forEach(([tool, label, hint], idx) => {
      const btn = this.createToolButton(label, tool, () => this.setActiveTool(tool));
      btn.dataset.hint = hint;
      this.toolButtons.set(tool, btn);
      leftTools.appendChild(btn);
      // 在「浏览/调窗/平移/缩放」与「测量工具」之间加分隔线
      if (idx === 3) leftTools.appendChild(this.createDivider());
    });
    leftTools.appendChild(btnClear);
    leftTools.appendChild(this.createDivider());
    leftTools.appendChild(btnRot);
    leftTools.appendChild(btnFlipH);
    leftTools.appendChild(btnInvert);
    leftTools.appendChild(btnReset);
    leftTools.appendChild(this.createDivider());
    leftTools.appendChild(this.wrapWithIcon('preset', presetSelect));
    leftTools.appendChild(this.wrapWithIcon('colormap', colormapSelect));
    leftTools.appendChild(this.wrapWithIcon('layout', layoutSelect));
    leftTools.appendChild(btn3D);
    leftTools.appendChild(exportBtn);

    // 右侧状态提示：当前模式 + 快捷键
    const statusArea = document.createElement('div');
    statusArea.style.cssText = 'display: flex; align-items: center; gap: 10px; flex: 0 0 auto; font-size: 11px;';

    const hintEl = document.createElement('span');
    hintEl.className = 'med-tool-hint';
    hintEl.style.cssText = 'color: #38bdf8; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
    this.toolHint = hintEl;

    const keyHint = document.createElement('span');
    keyHint.style.cssText = 'color: #475569; white-space: nowrap;';
    keyHint.textContent = 'Delete 删除 · Esc 取消';

    statusArea.appendChild(hintEl);
    statusArea.appendChild(keyHint);

    this.topToolbar.appendChild(brand);
    this.topToolbar.appendChild(leftTools);
    this.topToolbar.appendChild(statusArea);

    // 初始化高亮，保证首次进入时工具栏与实际交互模式一致
    this.updateToolbarActiveState();
  }

  private createToolButton(
    label: string,
    id: string,
    onClick: () => void,
    opts: { variant?: 'default' | 'primary' | 'accent' | 'danger'; iconOnly?: boolean } = {}
  ): HTMLButtonElement {
    const variant = opts.variant || 'default';
    const palette = {
      default: { bg: '#1f2937', color: '#cbd5e1', border: '#374151' },
      primary: { bg: '#0284c7', color: '#ffffff', border: '#0369a1' },
      accent: { bg: '#6366f1', color: '#ffffff', border: '#4f46e5' },
      danger: { bg: '#1f2937', color: '#f87171', border: '#7f1d1d' }
    }[variant];

    const btn = document.createElement('button');
    btn.className = `med-tool-btn tool-${id}`;
    btn.title = label;
    // 记录基础配色，供 hover / 激活态还原使用
    btn.dataset.baseBg = palette.bg;
    btn.dataset.baseColor = palette.color;
    btn.dataset.baseBorder = palette.border;

    const icon = createIcon(id, 14);
    btn.innerHTML = opts.iconOnly ? icon : `${icon}<span>${label}</span>`;
    btn.style.cssText = `
      background: ${palette.bg};
      color: ${palette.color};
      border: 1px solid ${palette.border};
      padding: ${opts.iconOnly ? '5px 7px' : '4px 9px'};
      font-size: 12px;
      border-radius: 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      white-space: nowrap;
      flex: 0 0 auto;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    `;

    btn.addEventListener('mouseenter', () => {
      if (!btn.classList.contains('active')) btn.style.background = '#334155';
    });
    btn.addEventListener('mouseleave', () => {
      if (!btn.classList.contains('active')) btn.style.background = btn.dataset.baseBg || '#1f2937';
    });
    btn.addEventListener('click', onClick);

    return btn;
  }

  private createDivider(): HTMLElement {
    const d = document.createElement('div');
    d.style.cssText = 'width: 1px; height: 20px; background: #374151; margin: 0 4px;';
    return d;
  }

  /**
   * 为下拉框等原生控件加一个前置图标，保持工具栏视觉统一
   */
  private wrapWithIcon(iconKey: string, el: HTMLElement): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; color: #64748b; flex: 0 0 auto;';
    wrap.innerHTML = createIcon(iconKey, 14);
    wrap.appendChild(el);
    return wrap;
  }

  /** 统一设置按钮的激活 / 常规样式（仅工具按钮使用） */
  private applyButtonState(btn: HTMLButtonElement | null, active: boolean): void {
    if (!btn) return;
    if (active) {
      btn.classList.add('active');
      btn.style.background = '#00e5ff';
      btn.style.color = '#0b0f19';
      btn.style.borderColor = '#00e5ff';
      btn.style.fontWeight = '600';
    } else {
      btn.classList.remove('active');
      btn.style.background = btn.dataset.baseBg || '#1f2937';
      btn.style.color = btn.dataset.baseColor || '#cbd5e1';
      btn.style.borderColor = btn.dataset.baseBorder || '#374151';
      btn.style.fontWeight = 'normal';
    }
  }

  /** 同步工具栏：当前工具高亮 + 提示文案 + 反相/翻转/3D 等状态按钮 */
  private updateToolbarActiveState(): void {
    this.toolButtons.forEach((btn, tool) => this.applyButtonState(btn, tool === this.activeTool));

    if (this.toolHint) {
      const activeBtn = this.toolButtons.get(this.activeTool);
      this.toolHint.textContent = activeBtn?.dataset.hint || '';
    }

    this.syncToggleButtons();
  }

  /** 同步「有状态」按钮（反相 / 水平翻转 / 3D），避免视觉与实际状态脱节 */
  private syncToggleButtons(): void {
    if (!this.layoutManager) return;
    const state = this.layoutManager.getActiveViewport()?.getState();

    const invert = !!state?.invert;
    if (invert !== this.toggleStateCache.invert) {
      this.toggleStateCache.invert = invert;
      this.applyButtonState(this.btnInvert, invert);
    }

    const flipH = !!state?.flipH;
    if (flipH !== this.toggleStateCache.flipH) {
      this.toggleStateCache.flipH = flipH;
      this.applyButtonState(this.btnFlipH, flipH);
    }

    if (this.is3DMode !== this.toggleStateCache.is3D) {
      this.toggleStateCache.is3D = this.is3DMode;
      this.applyButtonState(this.btn3D, this.is3DMode);
    }
  }

  // ==================== 底部 Cine 控制条 ====================

  private initBottomBarContent(): void {
    const playBtn = document.createElement('button');
    playBtn.textContent = '▶ 播放';
    playBtn.style.cssText = `
      background: #0284c7;
      color: #fff;
      border: none;
      border-radius: 4px;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 11px;
    `;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '0';
    slider.value = '0';
    slider.style.cssText = 'flex: 1; accent-color: #00e5ff; cursor: pointer;';

    const infoLabel = document.createElement('span');
    infoLabel.textContent = '0 / 0 层';

    this.cineSlider = slider;
    this.cineInfoLabel = infoLabel;

    const fpsLabel = document.createElement('span');
    fpsLabel.textContent = '15 FPS';

    playBtn.addEventListener('click', () => {
      const vp = this.getActiveViewport();
      if (vp.isCineActive()) {
        vp.stopCine();
        playBtn.textContent = '▶ 播放';
        playBtn.style.background = '#0284c7';
      } else {
        vp.startCine(15);
        playBtn.textContent = '⏸ 暂停';
        playBtn.style.background = '#e11d48';
      }
    });

    slider.addEventListener('input', (e) => {
      const idx = parseInt((e.target as HTMLInputElement).value, 10);
      this.getActiveViewport().setImageIndex(idx);
    });

    this.events.on('imageChanged', (e) => {
      slider.value = String(e.index);
      infoLabel.textContent = `${e.index + 1} / ${this.currentImages.length} 层`;
      this.updateSliceScrollbar();
    });

    this.events.on('imageLoaded', () => {
      this.updateCineSlider();
    });

    this.bottomBar.appendChild(playBtn);
    this.bottomBar.appendChild(slider);
    this.bottomBar.appendChild(infoLabel);
    this.bottomBar.appendChild(fpsLabel);
  }

  // ==================== 右侧测量检查栏 ====================

  private initInspectorContent(): void {
    const header = document.createElement('div');
    header.style.cssText = 'padding: 10px 12px; font-weight: 600; border-bottom: 1px solid #1f2937; color: #f1f5f9; display: flex; justify-content: space-between; align-items: center;';
    header.innerHTML = `
      <span>测量与标注记录</span>
      <button class="clear-meas-btn" style="background: transparent; border: 1px solid #ef4444; color: #ef4444; border-radius: 3px; padding: 2px 6px; font-size: 11px; cursor: pointer;">清空</button>
    `;

    header.querySelector('.clear-meas-btn')?.addEventListener('click', () => {
      this.clearAllMeasurements();
    });

    const measContainer = document.createElement('div');
    measContainer.className = 'meas-list-container';
    measContainer.style.cssText = 'flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px;';

    const tagsHeader = document.createElement('div');
    tagsHeader.style.cssText = 'padding: 8px 12px; font-weight: 600; border-top: 1px solid #1f2937; border-bottom: 1px solid #1f2937; color: #f1f5f9;';
    tagsHeader.textContent = 'DICOM 序列元数据';

    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'tags-info-container';
    tagsContainer.style.cssText = 'height: 160px; overflow-y: auto; padding: 8px 12px; font-family: monospace; font-size: 11px; line-height: 1.5; color: #94a3b8;';

    this.rightInspector.appendChild(header);
    this.rightInspector.appendChild(measContainer);
    this.rightInspector.appendChild(tagsHeader);
    this.rightInspector.appendChild(tagsContainer);

    this.events.on('measurementAdded', () => this.updateMeasurementsList());
    this.events.on('measurementUpdated', () => this.updateMeasurementsList());
    this.events.on('measurementRemoved', () => this.updateMeasurementsList());
    this.events.on('measurementsCleared', () => this.updateMeasurementsList());
  }

  private updateMeasurementsList(): void {
    const container = this.rightInspector.querySelector('.meas-list-container');
    if (!container) return;

    const list = this.getActiveViewport().getMeasurements();
    container.innerHTML = '';

    if (list.length === 0) {
      container.innerHTML = '<div style="color: #64748b; text-align: center; margin-top: 20px;">暂无测量标注</div>';
      return;
    }

    list.forEach((m) => {
      const card = document.createElement('div');
      card.style.cssText = 'background: #1e293b; border: 1px solid #334155; border-radius: 4px; padding: 6px 8px; font-size: 11px;';
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; color: #00e5ff; font-weight: 600;">
          <span>${m.type.toUpperCase()} [第 ${m.imageIndex + 1} 层]</span>
          <span class="del-m-btn" style="color: #ef4444; cursor: pointer;">✕</span>
        </div>
        <div style="margin-top: 4px; color: #e2e8f0; white-space: pre-wrap;">${m.data.text || '--'}</div>
      `;
      card.querySelector('.del-m-btn')?.addEventListener('click', () => {
        this.getActiveViewport().removeMeasurement(m.id);
      });
      container.appendChild(card);
    });
  }

  /**
   * 清空当前序列的全部标注（覆盖所有视口），并同步快照，避免切回序列时被旧数据还原
   */
  private clearAllMeasurements(): void {
    const viewports = this.layoutManager.getViewports();
    const total = viewports.reduce((sum, vp) => sum + vp.getMeasurements().length, 0);

    if (total === 0) {
      alert('当前序列暂无测量标注');
      return;
    }

    if (!confirm(`确定清空当前序列的 ${total} 条测量标注吗？该操作不可撤销。`)) return;

    viewports.forEach((vp) => vp.clearMeasurements());

    const group = this.seriesGroups[this.activeSeriesIndex];
    if (group) this.seriesMeasurements.delete(group.key);

    this.updateMeasurementsList();
  }

  private updateMetadataInspector(): void {
    const container = this.rightInspector.querySelector('.tags-info-container');
    const img = this.getActiveViewport().getCurrentImage();
    if (!container || !img) return;

    const m = img.metadata;
    container.innerHTML = `
      <div><strong>Patient:</strong> ${m.patientName || '--'}</div>
      <div><strong>ID:</strong> ${m.patientId || '--'}</div>
      <div><strong>Modality:</strong> ${m.modality || '--'}</div>
      <div><strong>Date:</strong> ${m.studyDate || '--'}</div>
      <div><strong>Dimension:</strong> ${m.columns}x${m.rows}</div>
      <div><strong>Bits:</strong> ${m.bitsAllocated}b (${m.pixelRepresentation === 1 ? 'Signed' : 'Unsigned'})</div>
      <div><strong>Spacing:</strong> ${m.pixelSpacing ? m.pixelSpacing[0].toFixed(2) + 'mm' : '--'}</div>
      <div><strong>Thickness:</strong> ${m.sliceThickness ? m.sliceThickness + 'mm' : '--'}</div>
      <div><strong>Rescale:</strong> Intercept ${m.rescaleIntercept}, Slope ${m.rescaleSlope}</div>
      <div><strong>Default WW/WC:</strong> ${img.defaultWindowWidth} / ${img.defaultWindowCenter}</div>
    `;
  }

  // ==================== 左侧「检查部位」页签列表 ====================

  /**
   * 渲染左侧序列页签：每一项 = 该序列首帧缩略图 + 部位名称 + 层数
   */
  private renderSeriesList(): void {
    this.leftThumbnails.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'med-series-header';
    header.style.cssText = 'padding:2px 2px 8px; border-bottom:1px solid #1f2937; margin-bottom:2px; flex:0 0 auto;';
    header.innerHTML = `
      <div style="font-size:10px; color:#64748b; letter-spacing:0.08em;">检查部位 / 序列</div>
      <div class="med-series-meta" style="font-size:10px; color:#38bdf8; margin-top:3px; line-height:1.4;">--</div>
    `;
    this.leftThumbnails.appendChild(header);

    this.seriesGroups.forEach((group, idx) => {
      const card = document.createElement('button');
      card.className = 'med-series-card';
      card.dataset.index = String(idx);
      card.title = `${group.label} · ${group.modality} · 序列 ${group.seriesNumber}${
        group.description ? ' · ' + group.description : ''
      }`;
      card.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 5px;
        background: #111827;
        border: 1px solid #1f2937;
        border-radius: 6px;
        cursor: pointer;
        text-align: left;
        transition: all 0.15s ease;
        flex: 0 0 auto;
      `;

      // 首帧缩略图
      const thumbWrap = document.createElement('div');
      thumbWrap.style.cssText = 'width:100%; aspect-ratio:1/1; background:#000; border-radius:4px; overflow:hidden; display:flex; align-items:center; justify-content:center;';
      thumbWrap.appendChild(this.renderSeriesThumbnail(group.images[0], 112, 112));

      const name = document.createElement('div');
      name.style.cssText = 'font-size:11px; color:#e2e8f0; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
      name.textContent = group.label;

      const meta = document.createElement('div');
      meta.style.cssText = 'font-size:9px; color:#64748b; display:flex; justify-content:space-between; gap:4px;';
      meta.innerHTML = `<span>${group.modality} · 序列 ${group.seriesNumber}</span><span>${group.images.length} 层</span>`;

      card.appendChild(thumbWrap);
      card.appendChild(name);
      card.appendChild(meta);
      card.addEventListener('click', () => this.switchSeries(idx));

      this.leftThumbnails.appendChild(card);
    });

    this.updateSeriesListActive();
    this.updateSeriesIndicator(this.seriesGroups[Math.max(0, this.activeSeriesIndex)]);
  }

  private updateSeriesListActive(): void {
    const cards = this.leftThumbnails.querySelectorAll<HTMLElement>('.med-series-card');
    cards.forEach((card, idx) => {
      const active = idx === this.activeSeriesIndex;
      card.style.border = active ? '1.5px solid #00e5ff' : '1px solid #1f2937';
      card.style.background = active ? '#0f2231' : '#111827';
      card.style.boxShadow = active ? '0 0 0 1px rgba(0,229,255,0.35), 0 0 12px rgba(0,229,255,0.15)' : 'none';
    });
  }

  private updateSeriesIndicator(group?: SeriesGroup): void {
    if (!group) return;
    const meta = this.leftThumbnails.querySelector('.med-series-meta') as HTMLElement | null;
    if (!meta) return;
    meta.innerHTML = `${group.label}<br><span style="color:#64748b;">${group.description || group.modality}</span>`;
  }

  /** 将序列首帧渲染为缩略图 canvas */
  private renderSeriesThumbnail(img: DicomImage | undefined, w: number, h: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.style.cssText = 'width:100%; height:100%; object-fit:cover;';

    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    if (!img) return canvas;

    try {
      const offscreen = new ImageRenderer().renderToCanvas(
        img,
        img.defaultWindowCenter,
        img.defaultWindowWidth,
        false,
        'grayscale'
      );
      const scale = Math.min(w / img.width, h / img.height) * 0.96;
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(offscreen, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } catch (e) {
      console.warn('序列缩略图渲染失败:', e);
    }

    return canvas;
  }

  // ==================== 右侧序列（切片）滚动条 ====================

  private buildSliceScrollbar(): void {
    const bar = document.createElement('div');
    bar.className = 'med-slice-scrollbar';
    bar.style.cssText = `
      width: 24px;
      height: 100%;
      background: #0b0f19;
      border-left: 1px solid #1f2937;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 6px 0;
      flex-shrink: 0;
      gap: 4px;
      user-select: none;
    `;

    const makeArrow = (symbol: string, delta: number, title: string): HTMLElement => {
      const btn = document.createElement('div');
      btn.textContent = symbol;
      btn.title = title;
      btn.style.cssText = `
        width: 18px; height: 16px; line-height: 16px; text-align: center;
        font-size: 9px; color: #64748b; cursor: pointer; border-radius: 3px;
        transition: all 0.12s ease;
      `;
      btn.addEventListener('mouseenter', () => {
        btn.style.color = '#00e5ff';
        btn.style.background = '#1f2937';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.color = '#64748b';
        btn.style.background = 'transparent';
      });
      btn.addEventListener('click', () => this.getActiveViewport().scrollSlices(delta));
      return btn;
    };

    const track = document.createElement('div');
    track.className = 'med-slice-track';
    track.style.cssText = `
      position: relative;
      flex: 1;
      width: 6px;
      background: #1f2937;
      border-radius: 3px;
      cursor: pointer;
      touch-action: none;
    `;

    const thumb = document.createElement('div');
    thumb.className = 'med-slice-thumb';
    thumb.style.cssText = `
      position: absolute;
      left: -4px;
      width: 14px;
      min-height: 22px;
      border-radius: 7px;
      background: linear-gradient(180deg, #22d3ee, #0ea5e9);
      box-shadow: 0 0 8px rgba(34, 211, 238, 0.55);
      cursor: grab;
      transition: box-shadow 0.15s ease;
    `;
    track.appendChild(thumb);

    const label = document.createElement('div');
    label.className = 'med-slice-label';
    label.style.cssText = 'font-size: 9px; color: #64748b; font-family: Consolas, monospace; line-height: 1.1; text-align: center;';
    label.textContent = '0/0';

    bar.appendChild(makeArrow('▲', -1, '上一层'));
    bar.appendChild(track);
    bar.appendChild(makeArrow('▼', 1, '下一层'));
    bar.appendChild(label);

    // 滚轮在滚动条上同样翻层
    bar.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.getActiveViewport().scrollSlices(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false }
    );

    // 拖动 / 点击定位
    const indexFromEvent = (clientY: number): number => {
      const rect = track.getBoundingClientRect();
      const total = this.currentImages.length;
      if (total <= 1) return 0;
      const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(1, rect.height)));
      return Math.round(ratio * (total - 1));
    };

    let dragging = false;
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      this.getActiveViewport().setImageIndex(indexFromEvent(e.clientY));
    };
    const onPointerUp = () => {
      dragging = false;
      thumb.style.cursor = 'grab';
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dragging = true;
      thumb.style.cursor = 'grabbing';
      this.getActiveViewport().setImageIndex(indexFromEvent(e.clientY));
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });

    this.sliceScrollbar = bar;
    this.sliceScrollTrack = track;
    this.sliceScrollThumb = thumb;
    this.sliceScrollLabel = label;

    this.viewportArea.appendChild(bar);
    this.updateSliceScrollbar();
  }

  /** 根据当前层号刷新右侧滚动条 */
  private updateSliceScrollbar(): void {
    if (!this.sliceScrollbar || !this.sliceScrollThumb || !this.sliceScrollTrack) return;
    if (!this.layoutManager) return;

    const total = this.currentImages.length;
    const max = Math.max(0, total - 1);
    const idx = Math.min(this.getActiveViewport().getState().currentImageIndex, max);

    this.sliceScrollbar.style.display = total > 1 ? 'flex' : 'none';
    if (total <= 1) return;

    // 布局尚未完成时轨道高度为 0，等下一帧再测量，避免滑块尺寸错误（最多重试 10 帧）
    const trackH = this.sliceScrollTrack.getBoundingClientRect().height;
    if (trackH < 10) {
      if (this.sliceScrollRetry < 10) {
        this.sliceScrollRetry++;
        requestAnimationFrame(() => this.updateSliceScrollbar());
      }
      return;
    }
    this.sliceScrollRetry = 0;

    const thumbH = Math.max(22, Math.min(trackH, trackH / total));
    const top = max === 0 ? 0 : (trackH - thumbH) * (idx / max);

    this.sliceScrollThumb.style.height = `${thumbH}px`;
    this.sliceScrollThumb.style.top = `${top}px`;
    this.sliceScrollLabel.textContent = `${idx + 1}/${total}`;
  }

  /** 保存当前序列的测量数据（切换页签前调用） */
  private snapshotMeasurements(group: SeriesGroup): void {
    const snapshot = this.layoutManager.getViewports().map((vp) =>
      vp.getMeasurements().map((m) => ({
        ...m,
        points: m.points.map((p) => ({ ...p })),
        data: { ...m.data }
      }))
    );
    this.seriesMeasurements.set(group.key, snapshot);
  }

  /** 恢复目标序列的测量数据 */
  private restoreMeasurements(group: SeriesGroup): void {
    const saved = this.seriesMeasurements.get(group.key);
    this.layoutManager.getViewports().forEach((vp, i) => {
      vp.setMeasurements(saved && saved[i] ? saved[i].map((m) => ({ ...m, points: m.points.map((p) => ({ ...p })), data: { ...m.data } })) : []);
    });
  }

  private updateCineSlider(): void {
    if (!this.cineSlider || !this.cineInfoLabel) return;
    const total = this.currentImages.length;
    const max = Math.max(0, total - 1);
    const idx = Math.min(this.getActiveViewport()?.getState().currentImageIndex ?? 0, max);
    this.cineSlider.max = String(max);
    this.cineSlider.value = String(idx);
    this.cineInfoLabel.textContent = total > 0 ? `${idx + 1} / ${total} 层` : '0 / 0 层';
  }

  // ==================== 云存储与本地配置弹窗 ====================

  private buildCloudConfigModal(): void {
    this.cloudModal = document.createElement('div');
    this.cloudModal.className = 'med-cloud-modal';
    this.cloudModal.style.cssText = `
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 999;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      width: 580px;
      max-width: 95vw;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `;

    dialog.innerHTML = `
      <div style="padding: 16px 20px; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0; font-size: 16px; color: #00e5ff; font-weight: 600;">☁️ 影像数据源配置 (云存储 / 本地导入)</h3>
        <span class="close-modal-btn" style="color: #94a3b8; font-size: 20px; cursor: pointer;">✕</span>
      </div>
      <div style="padding: 16px 20px; display: flex; flex-direction: column; gap: 14px; max-height: 70vh; overflow-y: auto;">
        <!-- 数据源类型选项卡 -->
        <div>
          <label style="font-size: 12px; color: #94a3b8; display: block; margin-bottom: 6px;">数据源类型</label>
          <select id="modalSourceType" style="width: 100%; padding: 8px 10px; background: #1e293b; border: 1px solid #334155; color: #f8fafc; border-radius: 4px; font-size: 13px;">
            <option value="syntheticDemo">内置演示: 高保真 16-bit 颅脑 CT (免外部服务器开箱即测)</option>
            <option value="local">本地文件: 拖拽或选择 DICOM / 常规医学影像</option>
            <option value="zip">本地 ZIP 压缩包: 打包导入多张影像 / 多序列</option>
            <option value="huaweiObs">华为云 OBS: 桶、AK/SK、Endpoint 导入</option>
            <option value="aliyunOss">阿里云 OSS: 地域、桶、AK/SK 导入</option>
            <option value="privateS3">私有化云 / MinIO / S3: 自建对象存储</option>
            <option value="dicomWeb">院内 PACS: DICOMweb (WADO-RS / QIDO-RS)</option>
          </select>
        </div>

        <!-- 动态配置区域 -->
        <div id="modalConfigFields" style="display: flex; flex-direction: column; gap: 10px;"></div>
      </div>
      <div style="padding: 14px 20px; border-top: 1px solid #1e293b; display: flex; justify-content: flex-end; gap: 10px; background: #0b1120;">
        <button class="test-conn-btn" style="background: #1e293b; color: #cbd5e1; border: 1px solid #334155; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 13px;">测试连通性</button>
        <button class="submit-config-btn" style="background: #0284c7; color: #fff; border: none; padding: 6px 18px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 600;">确定并导入影像</button>
      </div>
    `;

    this.cloudModal.appendChild(dialog);
    this.uiRoot.appendChild(this.cloudModal);

    const closeBtn = dialog.querySelector('.close-modal-btn');
    closeBtn?.addEventListener('click', () => this.closeCloudModal());

    const selectType = dialog.querySelector('#modalSourceType') as HTMLSelectElement;
    selectType?.addEventListener('change', () => this.renderModalFields(selectType.value));

    // 默认展示合成数据配置
    this.renderModalFields('syntheticDemo');

    // 提交配置
    const submitBtn = dialog.querySelector('.submit-config-btn');
    submitBtn?.addEventListener('click', () => this.handleSubmitModalConfig());

    // 测试连接
    const testBtn = dialog.querySelector('.test-conn-btn');
    testBtn?.addEventListener('click', () => this.handleTestModalConnection());
  }

  private renderModalFields(type: string): void {
    const container = this.cloudModal.querySelector('#modalConfigFields');
    if (!container) return;

    container.innerHTML = '';

    const inputStyle = 'width: 100%; padding: 7px 10px; background: #1e293b; border: 1px solid #334155; color: #f8fafc; border-radius: 4px; font-size: 12px; box-sizing: border-box;';
    const labelStyle = 'font-size: 12px; color: #94a3b8; margin-bottom: 4px; display: block;';

    switch (type) {
      case 'syntheticDemo': {
        container.innerHTML = `
          <div>
            <label style="${labelStyle}">切片层数 (Slices)</label>
            <input type="number" id="field_sliceCount" value="16" min="1" max="64" style="${inputStyle}" />
          </div>
          <div style="font-size: 11px; color: #38bdf8; background: rgba(56, 189, 248, 0.1); padding: 8px 10px; border-radius: 4px; border: 1px solid rgba(56, 189, 248, 0.2);">
            ℹ️ 内置包含颅脑全结构 (颅骨 + 脑实质 + 侧脑室低密度 CSF + 模拟高密度梗死/钙化病灶)，支持直接测距与窗位联动。
          </div>
        `;
        break;
      }

      case 'local': {
        container.innerHTML = `
          <div>
            <label style="${labelStyle}">选择本地 DICOM 文件 (.dcm, .dicom, .raw) 或常见病理图片</label>
            <input type="file" id="field_localFiles" multiple accept=".dcm,.dicom,.raw,.ima,.png,.jpg,.jpeg,.zip" style="${inputStyle}" />
          </div>
          <div id="localDropZone" style="border: 2px dashed #334155; padding: 20px; border-radius: 6px; text-align: center; color: #64748b; font-size: 12px;">
            或者直接将 DICOM 文件夹 / 文件 / ZIP 压缩包拖拽到此处
          </div>
        `;
        this.bindDropZone(
          container.querySelector('#localDropZone') as HTMLElement,
          container.querySelector('#field_localFiles') as HTMLInputElement,
          false
        );
        break;
      }

      case 'zip': {
        container.innerHTML = `
          <div>
            <label style="${labelStyle}">选择本地 ZIP 压缩包 (内含多张 DICOM 或普通影像，支持多序列 / 嵌套 ZIP)</label>
            <input type="file" id="field_zipFile" accept=".zip" style="${inputStyle}" />
          </div>
          <div id="zipDropZone" style="border: 2px dashed #334155; padding: 20px; border-radius: 6px; text-align: center; color: #64748b; font-size: 12px;">
            或者直接将 .zip 压缩包拖拽到此处
          </div>
          <div style="font-size: 11px; color: #38bdf8; background: rgba(56, 189, 248, 0.1); padding: 8px 10px; border-radius: 4px; border: 1px solid rgba(56, 189, 248, 0.2);">
            ℹ️ 解包后按 SeriesInstanceUID 自动分组，组内依据 SliceLocation / InstanceNumber / 自然文件名排序，
            可直接使用滚轮、Cine 播放与 3D 重建浏览整个序列；一次最多导入 1000 张。
          </div>
        `;
        this.bindDropZone(
          container.querySelector('#zipDropZone') as HTMLElement,
          container.querySelector('#field_zipFile') as HTMLInputElement,
          true
        );
        break;
      }

      case 'huaweiObs': {
        container.innerHTML = `
          <div>
            <label style="${labelStyle}">OBS 终端节点 (Endpoint)</label>
            <input type="text" id="field_obs_endpoint" placeholder="obs.cn-north-4.myhuaweicloud.com" value="obs.cn-north-4.myhuaweicloud.com" style="${inputStyle}" />
          </div>
          <div>
            <label style="${labelStyle}">存储桶名称 (Bucket Name)</label>
            <input type="text" id="field_obs_bucket" placeholder="hospital-medical-pacs" style="${inputStyle}" />
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <div>
              <label style="${labelStyle}">Access Key ID (AK)</label>
              <input type="text" id="field_obs_ak" placeholder="输入 AK" style="${inputStyle}" />
            </div>
            <div>
              <label style="${labelStyle}">Secret Access Key (SK)</label>
              <input type="password" id="field_obs_sk" placeholder="输入 SK" style="${inputStyle}" />
            </div>
          </div>
          <div>
            <label style="${labelStyle}">影像目录前缀 (Prefix，选填)</label>
            <input type="text" id="field_obs_prefix" placeholder="patients/20261026/CT001/" style="${inputStyle}" />
          </div>
        `;
        break;
      }

      case 'aliyunOss': {
        container.innerHTML = `
          <div>
            <label style="${labelStyle}">地域节点 (Region)</label>
            <input type="text" id="field_oss_region" placeholder="oss-cn-hangzhou" value="oss-cn-hangzhou" style="${inputStyle}" />
          </div>
          <div>
            <label style="${labelStyle}">存储桶名称 (Bucket Name)</label>
            <input type="text" id="field_oss_bucket" placeholder="pacs-imaging-vault" style="${inputStyle}" />
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <div>
              <label style="${labelStyle}">AccessKey ID</label>
              <input type="text" id="field_oss_ak" placeholder="LTAI..." style="${inputStyle}" />
            </div>
            <div>
              <label style="${labelStyle}">AccessKey Secret</label>
              <input type="password" id="field_oss_sk" placeholder="输入 Secret" style="${inputStyle}" />
            </div>
          </div>
          <div>
            <label style="${labelStyle}">影像目录前缀 (Prefix，选填)</label>
            <input type="text" id="field_oss_prefix" placeholder="dicom/studies/1001/" style="${inputStyle}" />
          </div>
        `;
        break;
      }

      case 'privateS3': {
        container.innerHTML = `
          <div>
            <label style="${labelStyle}">私有云 S3 / MinIO 服务端点 (Endpoint URL)</label>
            <input type="text" id="field_s3_endpoint" placeholder="http://192.168.1.100:9000" value="http://localhost:9000" style="${inputStyle}" />
          </div>
          <div>
            <label style="${labelStyle}">存储桶名称 (Bucket Name)</label>
            <input type="text" id="field_s3_bucket" placeholder="hospital-dicom" style="${inputStyle}" />
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <div>
              <label style="${labelStyle}">Access Key</label>
              <input type="text" id="field_s3_ak" placeholder="minioadmin" style="${inputStyle}" />
            </div>
            <div>
              <label style="${labelStyle}">Secret Key</label>
              <input type="password" id="field_s3_sk" placeholder="minioadmin" style="${inputStyle}" />
            </div>
          </div>
          <div>
            <label style="${labelStyle}">目录前缀 (Prefix，选填)</label>
            <input type="text" id="field_s3_prefix" placeholder="dicom/" style="${inputStyle}" />
          </div>
        `;
        break;
      }

      case 'dicomWeb': {
        container.innerHTML = `
          <div>
            <label style="${labelStyle}">WADO-RS 根服务地址 (WADO Root URL)</label>
            <input type="text" id="field_wado_root" placeholder="https://pacs.hospital.org/dicom-web" style="${inputStyle}" />
          </div>
          <div>
            <label style="${labelStyle}">Study Instance UID (检查 UID)</label>
            <input type="text" id="field_wado_study" placeholder="1.2.840.113619.2.55..." style="${inputStyle}" />
          </div>
          <div>
            <label style="${labelStyle}">Series Instance UID (序列 UID)</label>
            <input type="text" id="field_wado_series" placeholder="1.2.840.113619.2.55.1..." style="${inputStyle}" />
          </div>
          <div>
            <label style="${labelStyle}">自定义鉴权头 (Authorization Token，选填)</label>
            <input type="text" id="field_wado_auth" placeholder="Bearer eyJhbGciOi..." style="${inputStyle}" />
          </div>
        `;
        break;
      }
    }
  }

  private getModalFormConfig(): UnifiedImageSourceConfig {
    const type = (this.cloudModal.querySelector('#modalSourceType') as HTMLSelectElement).value;

    switch (type) {
      case 'syntheticDemo': {
        const sliceCount = parseInt((this.cloudModal.querySelector('#field_sliceCount') as HTMLInputElement)?.value || '16', 10);
        return { type: 'syntheticDemo', sliceCount };
      }

      case 'local': {
        const fileInput = this.cloudModal.querySelector('#field_localFiles') as HTMLInputElement;
        const files = fileInput?.files || [];
        return { type: 'local', files };
      }

      case 'zip': {
        const fileInput = this.cloudModal.querySelector('#field_zipFile') as HTMLInputElement;
        const file = fileInput?.files?.[0];
        if (!file) {
          throw new Error('请先选择或拖拽一个 .zip 影像压缩包');
        }
        return { type: 'zip', file };
      }

      case 'huaweiObs': {
        const endpoint = (this.cloudModal.querySelector('#field_obs_endpoint') as HTMLInputElement)?.value || '';
        const bucket = (this.cloudModal.querySelector('#field_obs_bucket') as HTMLInputElement)?.value || '';
        const ak = (this.cloudModal.querySelector('#field_obs_ak') as HTMLInputElement)?.value || '';
        const sk = (this.cloudModal.querySelector('#field_obs_sk') as HTMLInputElement)?.value || '';
        const prefix = (this.cloudModal.querySelector('#field_obs_prefix') as HTMLInputElement)?.value || '';
        return { type: 'huaweiObs', endpoint, bucket, accessKeyId: ak, secretAccessKey: sk, prefix };
      }

      case 'aliyunOss': {
        const region = (this.cloudModal.querySelector('#field_oss_region') as HTMLInputElement)?.value || '';
        const bucket = (this.cloudModal.querySelector('#field_oss_bucket') as HTMLInputElement)?.value || '';
        const ak = (this.cloudModal.querySelector('#field_oss_ak') as HTMLInputElement)?.value || '';
        const sk = (this.cloudModal.querySelector('#field_oss_sk') as HTMLInputElement)?.value || '';
        const prefix = (this.cloudModal.querySelector('#field_oss_prefix') as HTMLInputElement)?.value || '';
        return { type: 'aliyunOss', region, bucket, accessKeyId: ak, accessKeySecret: sk, prefix };
      }

      case 'privateS3': {
        const endpoint = (this.cloudModal.querySelector('#field_s3_endpoint') as HTMLInputElement)?.value || '';
        const bucket = (this.cloudModal.querySelector('#field_s3_bucket') as HTMLInputElement)?.value || '';
        const ak = (this.cloudModal.querySelector('#field_s3_ak') as HTMLInputElement)?.value || '';
        const sk = (this.cloudModal.querySelector('#field_s3_sk') as HTMLInputElement)?.value || '';
        const prefix = (this.cloudModal.querySelector('#field_s3_prefix') as HTMLInputElement)?.value || '';
        return { type: 'privateS3', endpoint, bucket, accessKeyId: ak, secretAccessKey: sk, prefix };
      }

      case 'dicomWeb': {
        const wadoRoot = (this.cloudModal.querySelector('#field_wado_root') as HTMLInputElement)?.value || '';
        const studyInstanceUID = (this.cloudModal.querySelector('#field_wado_study') as HTMLInputElement)?.value || '';
        const seriesInstanceUID = (this.cloudModal.querySelector('#field_wado_series') as HTMLInputElement)?.value || '';
        const token = (this.cloudModal.querySelector('#field_wado_auth') as HTMLInputElement)?.value || '';
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = token;
        return { type: 'dicomWeb', wadoRoot, studyInstanceUID, seriesInstanceUID, headers };
      }

      default:
        return { type: 'syntheticDemo', sliceCount: 16 };
    }
  }

  private async handleTestModalConnection(): Promise<void> {
    const config = this.getModalFormConfig();
    try {
      const res = await DataSourceManager.testConnection(config);
      if (res.success) {
        alert(`✅ 测试成功: ${res.message}`);
      } else {
        alert(`❌ 连接失败: ${res.message}`);
      }
    } catch (e: any) {
      alert(`❌ 连接异常: ${e.message || e}`);
    }
  }

  private async handleSubmitModalConfig(): Promise<void> {
    let config: UnifiedImageSourceConfig;
    try {
      config = this.getModalFormConfig();
    } catch (e: any) {
      alert(`⚠️ ${e?.message || e}`);
      return;
    }
    this.closeCloudModal();
    await this.loadImagesFromConfig(config);
  }

  /**
   * 将拖拽区域的文件选择结果回写到隐藏的 file input (支持多选 / 单选)
   */
  private bindDropZone(zone: HTMLElement, input: HTMLInputElement, single: boolean): void {
    if (!zone || !input) return;

    const reset = () => {
      zone.style.borderColor = '#334155';
    };

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.style.borderColor = '#00e5ff';
    });
    zone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      reset();
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      reset();

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const picked = single ? [files[0]] : Array.from(files);
      const dt = new DataTransfer();
      picked.forEach((f) => dt.items.add(f));
      input.files = dt.files;

      zone.textContent = picked.length === 1 ? `已选择: ${picked[0].name}` : `已选择 ${picked.length} 个文件`;
    });
  }

  private openCloudModal(): void {
    this.cloudModal.style.display = 'flex';
  }

  private closeCloudModal(): void {
    this.cloudModal.style.display = 'none';
  }

  // ==================== 提示与进度反馈 ====================

  private showLoadingToast(msg: string): void {
    let toast = this.uiRoot.querySelector('.med-loading-toast') as HTMLElement;
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'med-loading-toast';
      toast.style.cssText = `
        position: absolute;
        top: 60px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.9);
        border: 1px solid #00e5ff;
        color: #f8fafc;
        padding: 8px 18px;
        border-radius: 20px;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
        z-index: 1000;
      `;
      this.uiRoot.appendChild(toast);
    }
    toast.style.display = 'flex';
    toast.innerHTML = `<span style="display: inline-block; width: 14px; height: 14px; border: 2px solid #00e5ff; border-top-color: transparent; border-radius: 50%; animation: med-spin 0.8s linear infinite;"></span><span>${msg}</span>`;

    // 注入 spin 动画
    if (!document.getElementById('med-style-spin')) {
      const style = document.createElement('style');
      style.id = 'med-style-spin';
      style.textContent = '@keyframes med-spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }
  }

  private updateLoadingProgress(percent: number, msg: string): void {
    const toast = this.uiRoot.querySelector('.med-loading-toast');
    if (toast) {
      toast.innerHTML = `<span style="display: inline-block; width: 14px; height: 14px; border: 2px solid #00e5ff; border-top-color: transparent; border-radius: 50%; animation: med-spin 0.8s linear infinite;"></span><span>${msg} (${percent}%)</span>`;
    }
  }

  private hideLoadingToast(): void {
    const toast = this.uiRoot.querySelector('.med-loading-toast') as HTMLElement;
    if (toast) {
      toast.style.display = 'none';
    }
  }

  private toggle3DVtkMode(btn: HTMLButtonElement): void {
    if (!this.is3DMode) {
      if (this.currentImages.length < 2) {
        alert('3D 体绘制重建需要至少 2 层以上的连续切片数据！');
        return;
      }
      this.is3DMode = true;
      btn.title = '返回 2D 阅片';

      // 切换中央视口为 VTK 渲染容器
      this.viewportGridContainer.innerHTML = '';
      this.vtkEngine = new VtkMprEngine(this.viewportGridContainer);
      this.vtkEngine.loadVolumeData(this.currentImages);
    } else {
      this.exit3DMode(btn);
    }

    this.syncToggleButtons();
  }

  /**
   * 退出 3D 重建模式，恢复 2D 布局视口
   */
  private exit3DMode(btn: HTMLButtonElement | null = this.btn3D): void {
    this.is3DMode = false;
    if (btn) {
      btn.title = '3D 体积重建';
    }

    if (this.vtkEngine) {
      this.vtkEngine.destroy();
      this.vtkEngine = null;
    }

    // 重建视口后需要重新应用当前交互工具，否则会静默回到默认调窗
    this.layoutManager.setLayout(this.layoutManager.getLayout());
    this.layoutManager.setActiveTool(this.activeTool);
    this.layoutManager.setImagesForAll(this.currentImages);
    const group = this.seriesGroups[this.activeSeriesIndex];
    if (group) this.restoreMeasurements(group);
    this.updateMetadataInspector();
    this.updateMeasurementsList();
    this.syncToggleButtons();
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => {
      this.layoutManager.getViewports().forEach((vp) => vp.render());
    });

    // 键盘 / 右键菜单等途径改变视口状态时，同步反相、翻转等按钮高亮
    this.events.on('viewportUpdated', () => this.syncToggleButtons());
    this.events.on('layoutChanged', () => {
      this.layoutManager.setActiveTool(this.activeTool);
      this.updateToolbarActiveState();
      this.updateMeasurementsList();
    });
  }

  destroy(): void {
    if (this.vtkEngine) {
      this.vtkEngine.destroy();
      this.vtkEngine = null;
    }
    this.layoutManager.getViewports().forEach((vp) => vp.destroy());
    this.container.innerHTML = '';
  }
}
