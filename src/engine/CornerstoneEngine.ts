import * as cornerstone from '@cornerstonejs/core';
import * as csTools from '@cornerstonejs/tools';
import { DicomImage, ToolType } from '../types';

export class CornerstoneAdapter {
  private static isInitialized = false;
  private renderingEngineId: string;
  private renderingEngine: cornerstone.RenderingEngine | null = null;
  private viewportId: string;
  private toolGroupId: string;
  private container: HTMLElement;

  constructor(container: HTMLElement, viewportId: string = 'CS_VIEWPORT') {
    this.container = container;
    this.viewportId = viewportId;
    this.renderingEngineId = `RE_${Date.now()}`;
    this.toolGroupId = `TG_${Date.now()}`;
  }

  /**
   * 初始化 Cornerstone3D 核心运行时与工具系统
   */
  static async init(): Promise<boolean> {
    if (this.isInitialized) return true;
    try {
      await cornerstone.init();
      csTools.init();

      // 注册常用工具类
      csTools.addTool(csTools.WindowLevelTool);
      csTools.addTool(csTools.PanTool);
      csTools.addTool(csTools.ZoomTool);
      csTools.addTool(csTools.LengthTool);
      csTools.addTool(csTools.AngleTool);
      csTools.addTool(csTools.RectangleROITool);
      csTools.addTool(csTools.ProbeTool);

      this.isInitialized = true;
      return true;
    } catch (e) {
      console.warn('Cornerstone3D 初始化提示 (可能在不支持 SharedArrayBuffer 的安全上下文中):', e);
      return false;
    }
  }

  /**
   * 在目标容器挂载 Stack 视口并绑定 ToolGroup
   */
  async mount(): Promise<void> {
    await CornerstoneAdapter.init();

    this.renderingEngine = new cornerstone.RenderingEngine(this.renderingEngineId);

    const viewportInput: cornerstone.Types.PublicViewportInput = {
      viewportId: this.viewportId,
      type: cornerstone.Enums.ViewportType.STACK,
      element: this.container as HTMLDivElement,
      defaultOptions: {
        background: [0, 0, 0]
      }
    };

    this.renderingEngine.enableElement(viewportInput);

    // 创建并配置工具组
    const toolGroup = csTools.ToolGroupManager.createToolGroup(this.toolGroupId);
    if (toolGroup) {
      toolGroup.addTool(csTools.WindowLevelTool.toolName);
      toolGroup.addTool(csTools.PanTool.toolName);
      toolGroup.addTool(csTools.ZoomTool.toolName);
      toolGroup.addTool(csTools.LengthTool.toolName);
      toolGroup.addTool(csTools.AngleTool.toolName);
      toolGroup.addTool(csTools.RectangleROITool.toolName);
      toolGroup.addTool(csTools.ProbeTool.toolName);

      // 绑定视口
      toolGroup.addViewport(this.viewportId, this.renderingEngineId);

      // 设置默认鼠标左键激活调窗
      toolGroup.setToolActive(csTools.WindowLevelTool.toolName, {
        bindings: [{ mouseButton: csTools.Enums.MouseBindings.Primary }]
      });
      toolGroup.setToolActive(csTools.PanTool.toolName, {
        bindings: [{ mouseButton: csTools.Enums.MouseBindings.Auxiliary }] // 中键平移
      });
      toolGroup.setToolActive(csTools.ZoomTool.toolName, {
        bindings: [{ mouseButton: csTools.Enums.MouseBindings.Secondary }] // 右键缩放
      });
    }
  }

  /**
   * 切换当前激活的 Cornerstone 工具
   */
  setActiveTool(toolType: ToolType): void {
    const toolGroup = csTools.ToolGroupManager.getToolGroup(this.toolGroupId);
    if (!toolGroup) return;

    let targetName = csTools.WindowLevelTool.toolName;
    switch (toolType) {
      case 'pan':
        targetName = csTools.PanTool.toolName;
        break;
      case 'zoom':
        targetName = csTools.ZoomTool.toolName;
        break;
      case 'length':
        targetName = csTools.LengthTool.toolName;
        break;
      case 'angle':
        targetName = csTools.AngleTool.toolName;
        break;
      case 'rectangleRoi':
        targetName = csTools.RectangleROITool.toolName;
        break;
      case 'probe':
        targetName = csTools.ProbeTool.toolName;
        break;
      default:
        targetName = csTools.WindowLevelTool.toolName;
    }

    toolGroup.setToolActive(targetName, {
      bindings: [{ mouseButton: csTools.Enums.MouseBindings.Primary }]
    });
  }

  /**
   * 销毁实例
   */
  destroy(): void {
    if (this.renderingEngine) {
      this.renderingEngine.destroy();
      this.renderingEngine = null;
    }
    csTools.ToolGroupManager.destroyToolGroup(this.toolGroupId);
  }
}
