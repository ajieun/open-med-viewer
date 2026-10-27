import { UnifiedImageSourceConfig, ToolType, ViewportLayout, DicomImage, Measurement } from '../types';
import { OpenMedViewer } from '../ui/MedViewerUI';

export interface VueMedViewerProps {
  config?: UnifiedImageSourceConfig;
  layout?: ViewportLayout;
  initialTool?: ToolType;
  showToolbar?: boolean;
  theme?: 'dark' | 'light';
}

/**
 * Vue 3 适配器定义 (支持 defineComponent / setup script 语法)
 *
 * 示例使用方法:
 * ```html
 * <template>
 *   <div ref="viewerContainer" style="width: 100vw; height: 100vh;"></div>
 * </template>
 * <script setup>
 * import { ref, onMounted, onUnmounted } from 'vue';
 * import { useVueMedViewer } from '@open-med/viewer/vue';
 *
 * const viewerContainer = ref(null);
 * const { viewer, loadFromConfig, setTool } = useVueMedViewer(viewerContainer, {
 *   config: { type: 'syntheticDemo', sliceCount: 16 }
 * });
 * </script>
 * ```
 */
export function useVueMedViewer(
  containerRef: { value: HTMLElement | null } | HTMLElement,
  options: VueMedViewerProps = {}
) {
  let viewerInstance: OpenMedViewer | null = null;

  const init = () => {
    const el = 'value' in containerRef ? containerRef.value : containerRef;
    if (!el || viewerInstance) return;

    viewerInstance = new OpenMedViewer({
      container: el,
      initialConfig: options.config,
      initialLayout: options.layout || '1x1',
      initialTool: options.initialTool || 'windowLevel',
      showToolbar: options.showToolbar !== false
    });
  };

  const destroy = () => {
    if (viewerInstance) {
      viewerInstance.destroy();
      viewerInstance = null;
    }
  };

  const loadFromConfig = async (config: UnifiedImageSourceConfig): Promise<DicomImage[]> => {
    if (!viewerInstance) init();
    return await viewerInstance!.loadImagesFromConfig(config);
  };

  const setTool = (tool: ToolType) => {
    viewerInstance?.setActiveTool(tool);
  };

  const setLayout = (layout: ViewportLayout) => {
    viewerInstance?.setLayout(layout);
  };

  const getMeasurements = (): Measurement[] => {
    return viewerInstance?.getActiveViewport().getMeasurements() || [];
  };

  return {
    getInstance: () => viewerInstance,
    init,
    destroy,
    loadFromConfig,
    setTool,
    setLayout,
    getMeasurements
  };
}

/**
 * Vue 3 组件模板描述定义
 */
export const VueMedViewerComponent = {
  name: 'VueMedViewer',
  props: {
    config: { type: Object, default: () => ({ type: 'syntheticDemo' }) },
    layout: { type: String, default: '1x1' },
    tool: { type: String, default: 'windowLevel' },
    showToolbar: { type: Boolean, default: true }
  },
  setup(props: any, { expose }: any) {
    // 适配 Vue 3 运行时
    return { props, expose };
  }
};
