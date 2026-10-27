import { UnifiedImageSourceConfig, ToolType, ViewportLayout, DicomImage, Measurement } from '../types';
import { OpenMedViewer } from '../ui/MedViewerUI';

export interface ReactMedViewerProps {
  config?: UnifiedImageSourceConfig;
  layout?: ViewportLayout;
  initialTool?: ToolType;
  showToolbar?: boolean;
  className?: string;
  style?: Record<string, string | number>;
  onImageChanged?: (image: DicomImage, index: number) => void;
  onMeasurementAdded?: (m: Measurement) => void;
}

/**
 * React 阅片器 Hook: useMedViewer
 *
 * 示例使用方法:
 * ```tsx
 * import React, { useRef } from 'react';
 * import { useMedViewer } from '@open-med/viewer/react';
 *
 * export function MedicalPage() {
 *   const containerRef = useRef<HTMLDivElement>(null);
 *   const { viewer, loadFromConfig, setTool } = useMedViewer(containerRef, {
 *     config: {
 *       type: 'huaweiObs',
 *       endpoint: 'obs.cn-north-4.myhuaweicloud.com',
 *       bucket: 'hospital-pacs-bucket',
 *       accessKeyId: '***',
 *       secretAccessKey: '***',
 *       prefix: 'patients/CT001/'
 *     }
 *   });
 *
 *   return <div ref={containerRef} style={{ width: '100vw', height: '100vh' }} />;
 * }
 * ```
 */
export function useMedViewer(
  ref: { current: HTMLElement | null },
  options: ReactMedViewerProps = {}
) {
  let viewerInstance: OpenMedViewer | null = null;

  const init = () => {
    if (!ref.current || viewerInstance) return;
    viewerInstance = new OpenMedViewer({
      container: ref.current,
      initialConfig: options.config,
      initialLayout: options.layout || '1x1',
      initialTool: options.initialTool || 'windowLevel',
      showToolbar: options.showToolbar !== false
    });

    if (options.onImageChanged) {
      viewerInstance.getEvents().on('imageChanged', (e) => options.onImageChanged?.(e.image, e.index));
    }
    if (options.onMeasurementAdded) {
      viewerInstance.getEvents().on('measurementAdded', (e) => options.onMeasurementAdded?.(e.measurement));
    }
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
