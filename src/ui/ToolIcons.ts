/**
 * 工具栏图标集（内联 SVG，24x24 线性风格，随文字颜色变化）
 *
 * 通过图标 key 与工具栏按钮/下拉框绑定，避免引入图标字体或第三方依赖。
 */
export const TOOL_ICONS: Record<string, string> = {
  // 浏览 / 指针
  none: '<path d="M5 3l14 8-6.2 1.4L9.6 19z" />',

  // 调窗（对比度）
  windowLevel: '<circle cx="12" cy="12" r="9" /><path d="M12 3v18" /><path d="M12 3a9 9 0 010 18z" fill="currentColor" stroke="none" opacity="0.45" />',

  // 平移（四向）
  pan: '<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l2.5 2.5" />',

  // 缩放
  zoom: '<circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-5-5M7.5 10.5h6M10.5 7.5v6" />',

  // 旋转
  rotate90: '<path d="M20 12a8 8 0 11-2.4-5.7" /><path d="M20 3.5V8h-4.5" />',

  // 水平翻转
  flipH: '<path d="M12 3v18" /><path d="M9 7L4 12l5 5z" /><path d="M15 7l5 5-5 5z" />',

  // 反相
  invert: '<circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 010 18" fill="currentColor" stroke="none" opacity="0.55" />',

  // 重置
  reset: '<path d="M3.5 12a8.5 8.5 0 103-6.5" /><path d="M3 4v5h5" />',

  // 测距
  length: '<path d="M3 17L17 3l4 4L7 21z" /><path d="M8 12l2 2M11 9l2 2M14 6l2 2" />',

  // 角度
  angle: '<path d="M4 20h16" /><path d="M4 20L19 6" /><path d="M11 20a7 7 0 00-1.5-4.4" />',

  // 矩形 ROI
  rectangleRoi: '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5" /><path d="M3.5 9.5h3M17.5 14.5h3" opacity="0.6" />',

  // 椭圆 ROI
  ellipseRoi: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5" /><path d="M12 5.5v13" opacity="0.45" />',

  // 探针
  probe: '<circle cx="12" cy="12" r="2.4" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" />',

  // 箭头标注
  arrow: '<path d="M4 20L20 4" /><path d="M13.5 4H20v6.5" />',

  // 数据源 / 云
  cloudSource: '<path d="M7 18a4 4 0 010-8 5.5 5.5 0 0110.4-1.6A3.9 3.9 0 0117.5 18z" /><path d="M12 11v5M9.5 13.5L12 11l2.5 2.5" />',

  // 3D
  vtk3d: '<path d="M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3z" /><path d="M3.5 7.3L12 12l8.5-4.7M12 12v9.5" />',

  // 导出
  export: '<path d="M3.5 8.5h4l2-2.5h5l2 2.5h4v11h-17z" /><circle cx="12" cy="13.5" r="3.2" />',

  // 窗宽预设
  preset: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="17" r="2" />',

  // 伪彩
  colormap:
    '<path d="M12 3a9 9 0 000 18h2a2 2 0 000-4 2 2 0 012-2h2a3 3 0 003-3 9 9 0 00-9-9z" /><circle cx="8.5" cy="9" r="1.1" fill="currentColor" stroke="none" /><circle cx="8" cy="14" r="1.1" fill="currentColor" stroke="none" /><circle cx="12.5" cy="7" r="1.1" fill="currentColor" stroke="none" />',

  // 布局
  layout: '<rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="7" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><rect x="13.5" y="13.5" width="7" height="7" rx="1" />'
};

/**
 * 生成内联 SVG 图标
 */
export function createIcon(key: string, size: number = 14): string {
  const path = TOOL_ICONS[key];
  if (!path) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto;">${path}</svg>`;
}
