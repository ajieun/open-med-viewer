# OpenMed Viewer

> 框架无关（Framework-Agnostic）的通用医学影像阅片器框架 —— 一份核心代码，可直接嵌入 Vue 3、React 或任意原生 JS/TS 项目。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6)
![Vite](https://img.shields.io/badge/Vite-5.4-646cff)
![DICOM](https://img.shields.io/badge/DICOM-Part--10%20%7C%20DICOMweb-00e5ff)

OpenMed Viewer 以纯 TypeScript 实现核心引擎，不绑定任何 UI 框架，内置**统一多云与本地数据源适配层**：只要填写配置，即可直连华为云 OBS、阿里云 OSS、私有化 MinIO/Ceph/S3、院内 PACS DICOMweb，或直接拖入本地 DICOM / ZIP 影像。工具栏集成了调窗、测距、角度、ROI、探针、多画幅排版、伪彩、3D/MPR 与 Cine 播放等专业诊断工具。

---

## 目录

- [特性速览](#特性速览)
- [支持的影像格式](#支持的影像格式)
- [界面布局](#界面布局)
- [快速开始（本地运行）](#快速开始本地运行)
- [安装方式](#安装方式)
- [集成指南](#集成指南)
  - [1. 原生 JS / TS（任何框架）](#1-原生-js--ts任何框架)
  - [2. Vue 3](#2-vue-3)
  - [3. React 18+](#3-react-18)
  - [4. Vue 组合式函数 useVueMedViewer](#4-vue-组合式函数-usevuemedviewer)
- [数据源配置](#数据源配置)
- [序列与切片导航](#序列与切片导航)
- [交互与快捷键](#交互与快捷键)
- [API 参考](#api-参考)
- [项目结构](#项目结构)
- [构建与发布](#构建与发布)
- [常见问题](#常见问题)
- [贡献](#贡献)
- [许可证](#许可证)

---

## 特性速览

| 分类 | 能力 |
| :--- | :--- |
| 多引擎架构 | Cornerstone3D 临床级 2D 堆栈渲染、VTK.js 3D / MPR 科学重建、纯 TS + Canvas 轻量快速通道（300ms 级启动） |
| DICOM 解析 | `dicom-parser` + `dcmjs`：Part 10、显式/隐式 VR、16/32 位有符号与无符号像素、Rescale Slope/Intercept、PixelSpacing 等完整元数据 |
| 压缩解码 | `@cornerstonejs/dicom-image-loader` 按需加载 WASM 解码器：JPEG Baseline/Lossless、JPEG-LS、JPEG 2000、HTJ2K、JPEG-XL、RLE |
| 数据源 | 华为云 OBS、阿里云 OSS、MinIO/S3、DICOMweb（WADO-RS / WADO-URI / QIDO-RS）、本地文件、ZIP 压缩包、直链 URL、内置合成 CT |
| 影像工具 | 调窗（含脑窗/骨窗/肺窗等预设）、平移、缩放、旋转、翻转、反相、Cine 播放 |
| 测量标注 | 测距（mm）、角度（°）、矩形/椭圆 ROI（mm²、Mean/Min/Max/StdDev HU）、探针 HU、箭头标注；支持拖动控制点重算、整体平移、删除 |
| 视图能力 | 1×1 / 1×2 / 2×1 / 2×2 多画幅、跨视口序列同步滚动、伪彩 LUT（Grayscale / Hot Iron / Rainbow / PET 反相 / Bone） |
| 序列组织 | 按 `BodyPartExamined` → `SeriesDescription` → `Modality + SeriesNumber` 分组，左侧缩略图卡片切换，各序列测量标注独立保存/恢复 |
| 导出 | 视口 + 标注高保真导出 PNG/JPEG，测量数据导出标准 JSON 报告 |

---

## 支持的影像格式

| 类别 | 支持情况 |
| :--- | :--- |
| 未压缩 DICOM | Implicit VR LE / Explicit VR LE / Explicit VR BE / Deflated，8/16/32 位，有符号与无符号，Float Pixel Data |
| 压缩 DICOM | JPEG Baseline（8/12bit）、JPEG Lossless（.57/.70）、JPEG-LS、JPEG 2000、HTJ2K、JPEG-XL、RLE —— 由 Cornerstone WASM 解码器处理 |
| 彩色 / 多帧 | RGB / YBR / PALETTE COLOR 自动转灰度显示；多帧 DICOM（`NumberOfFrames`）自动拆分为多张 |
| 非 DICOM | PNG / JPEG / BMP / WebP / TIFF |
| 压缩包 | ZIP（Store/Deflate、ZIP64、嵌套 ZIP、无扩展名 DICOM 内容嗅探、自动跳过 DICOMDIR/文本/系统文件） |

> WASM 解码器默认从 `<base>/wasm/` 读取，构建时由 `scripts/copy-wasm.mjs` 复制到 `dist/wasm/`。
> 部署在子路径或 CDN 时，请调用 `CornerstoneImageDecoder.setWasmBasePath('/static/wasm/')` 指定实际路径。

> 关于 `@cornerstonejs/streaming-image-volume-loader`：该独立包仅适配 Cornerstone3D v1（`peer @cornerstonejs/core@^1.86`）；
> 自 v2 起流式体积加载已并入 `@cornerstonejs/core`（`cornerstoneStreamingImageVolumeLoader` / `volumeLoader.createAndCacheVolume`）。
> 本项目使用 core v5，因此未引入该 v1 专属包，3D 重建由内置 VTK.js 引擎基于解码后的体数据完成。

---

## 界面布局

启动后的阅片界面自上而下、自左至右分为五个区域：

```
┌──────────────────────────────────────────────────────────────┐
│ 顶部工具栏：数据源 / 浏览 / 调窗 / 变换 / 测量 / 预设 / 3D / 导出 │
├──────────┬───────────────────────────────┬───────────────────┤
│ 左侧栏    │  中间视口区域                  │ 右侧检查信息栏     │
│ 序列卡片  │  ┌─────────────────────┬────┐ │ 患者 / 检查 /     │
│ 首帧缩略图│  │  视口网格 (1x1~2x2)  │ 切 │ │ 序列元数据 /      │
│ 部位/层数 │  │                     │ 片 │ │ 测量记录列表      │
│          │  └─────────────────────┴────┘ │                   │
├──────────┴───────────────────────────────┴───────────────────┤
│ 底部状态栏：Cine 播放 / 暂停 · 切片进度条 · 当前层号             │
└──────────────────────────────────────────────────────────────┘
```

- **左侧序列栏**：每个序列一张卡片，显示该序列首帧缩略图、部位名称（`BodyPartExamined` / `SeriesDescription`）、模态、序列号与层数；当前序列以青色描边高亮，点击即切换。
- **右侧切片滚动条**：`▲` / 拖动滑块 / `▼` 三层交互，配合 `当前层/总层数` 显示；在滚动条上滚动滚轮同样翻层。
- **右侧信息栏**：实时展示患者、检查、序列元数据与当前序列的测量记录，可单条删除或一键清空。

---

## 快速开始（本地运行）

```bash
# 1. 克隆仓库
git clone https://github.com/<your-account>/open-med-viewer.git
cd open-med-viewer

# 2. 安装依赖（需要 Node.js 18+）
npm install

# 3. 启动开发服务（默认 http://localhost:3000/，自动打开浏览器）
npm run dev

# 4. 类型检查
npx tsc --noEmit

# 5. 生产构建（ESM + CJS、Vue/React 子路径、WASM 解码器与 .d.ts）
npm run build
```

开发服务器启动后会自动载入内置的 16 层高保真合成颅脑 CT 序列（含颅骨、脑实质、脑室 CSF 与模拟病灶 HU 值），无需任何网络或云配置即可体验全部功能。

---

## 安装方式

### 通过 npm（包发布后）

```bash
npm install @open-med/viewer
# 或
pnpm add @open-med/viewer
# 或
yarn add @open-med/viewer

# 使用 Vue / React 子路径入口
npm install @open-med/viewer
```

### 从源码构建并本地引用

```bash
npm run build          # 产物在 dist/
npm pack               # 生成 open-med-viewer-1.0.0.tgz
# 在宿主项目中：
npm install /path/to/open-med-viewer-1.0.0.tgz
```

导出入口：

| 入口 | 说明 |
| :--- | :--- |
| `@open-med/viewer` | 核心引擎、适配器、工具、UI 与类型 |
| `@open-med/viewer/vue` | Vue 3 组合式函数 `useVueMedViewer` |
| `@open-med/viewer/react` | React Hook `useMedViewer` |

---

## 集成指南

### 1. 原生 JS / TS（任何框架）

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>DICOM 阅片</title>
  </head>
  <body style="margin: 0">
    <div id="viewer" style="width: 100vw; height: 100vh"></div>

    <script type="module">
      import { OpenMedViewer } from '@open-med/viewer';

      const viewer = new OpenMedViewer({
        container: document.getElementById('viewer'),
        initialConfig: { type: 'syntheticDemo', sliceCount: 16 },
        initialLayout: '1x1',
        initialTool: 'windowLevel'
      });

      // 监听切片切换
      viewer.getEvents().on('imageChanged', ({ index }) => {
        console.log('当前层：', index + 1);
      });

      // 页面卸载时释放资源
      window.addEventListener('beforeunload', () => viewer.destroy());
    </script>
  </body>
</html>
```

> 容器必须具有确定宽高（`width` + `height`），否则视口无法测量尺寸。

### 2. Vue 3

```vue
<template>
  <div class="viewer-page">
    <div ref="viewerContainer" class="viewer-box"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { OpenMedViewer, UnifiedImageSourceConfig } from '@open-med/viewer';

const viewerContainer = ref<HTMLElement | null>(null);
let viewer: OpenMedViewer | null = null;

// 按业务选择任意一种配置，详见「数据源配置」章节
const config: UnifiedImageSourceConfig = {
  type: 'huaweiObs',
  endpoint: 'obs.cn-north-4.myhuaweicloud.com',
  bucket: 'hospital-pacs-dicom',
  accessKeyId: 'YOUR_HUAWEI_AK',
  secretAccessKey: 'YOUR_HUAWEI_SK',
  prefix: 'CT/Study-20261026/Series-1/'
};

onMounted(() => {
  if (!viewerContainer.value) return;

  viewer = new OpenMedViewer({
    container: viewerContainer.value,
    initialConfig: config,
    initialLayout: '1x1',        // '1x1' | '1x2' | '2x1' | '2x2'
    initialTool: 'windowLevel',  // 'windowLevel' | 'pan' | 'zoom' | 'length' ...
    showToolbar: true
  });

  viewer.getEvents().on('imageChanged', ({ image, index }) => {
    console.log('第', index + 1, '层，患者：', image.metadata.patientName);
  });

  viewer.getEvents().on('measurementAdded', ({ measurement }) => {
    console.log('新增测量：', measurement);
  });
});

onUnmounted(() => {
  viewer?.destroy();
});
</script>

<style scoped>
.viewer-page {
  width: 100vw;
  height: 100vh;
  margin: 0;
}
.viewer-box {
  width: 100%;
  height: 100%;
}
</style>
```

### 3. React 18+

```tsx
import React, { useEffect, useRef } from 'react';
import { OpenMedViewer, UnifiedImageSourceConfig } from '@open-med/viewer';

export const MedicalViewerPage: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenMedViewer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const config: UnifiedImageSourceConfig = {
      type: 'privateS3',
      endpoint: 'http://192.168.1.100:9000',
      bucket: 'pacs-data',
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
      prefix: 'patients/CT001/'
    };

    const viewer = new OpenMedViewer({
      container: containerRef.current,
      initialConfig: config,
      initialLayout: '1x1',
      initialTool: 'windowLevel'
    });
    viewerRef.current = viewer;

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};
```

React 的 `useEffect` 在开发环境（StrictMode）会执行两次挂载/卸载，`destroy()` 已在清理函数中调用，重复创建不会残留 DOM 与事件监听。

### 4. Vue 组合式函数 `useVueMedViewer`

```ts
import { ref, onMounted, onUnmounted } from 'vue';
import { useVueMedViewer } from '@open-med/viewer/vue';

const container = ref<HTMLElement | null>(null);
const { viewer, loadFromConfig, setTool, destroy } = useVueMedViewer(container, {
  config: { type: 'syntheticDemo', sliceCount: 16 },
  layout: '2x2',
  initialTool: 'pan'
});

onMounted(() => {
  // 运行中切换数据源
  loadFromConfig({ type: 'dicomWeb', wadoRoot: 'https://pacs.example.org/dicom-web' });
});

onUnmounted(() => destroy());
```

---

## 数据源配置

所有数据源使用统一的联合类型 `UnifiedImageSourceConfig`，通过 `initialConfig` 或 `viewer.loadImagesFromConfig(config)` 传入。

| `type` | 必填字段 | 选填字段 | 说明 |
| :--- | :--- | :--- | :--- |
| `huaweiObs` | `endpoint`, `bucket`, `accessKeyId`, `secretAccessKey` | `securityToken`, `prefix`, `keys`, `usePresignedUrls` | 华为云对象存储 OBS |
| `aliyunOss` | `region`, `bucket`, `accessKeyId`, `accessKeySecret` | `endpoint`, `stsToken`, `prefix`, `keys`, `usePresignedUrls` | 阿里云对象存储 OSS |
| `privateS3` | `endpoint`, `bucket`, `accessKeyId`, `secretAccessKey` | `region`, `pathStyle`, `prefix`, `keys` | 私有云 MinIO / Ceph / S3 兼容存储 |
| `dicomWeb` | `wadoRoot` | `qidoRoot`, `studyInstanceUID`, `seriesInstanceUID`, `headers` | 院内 PACS（WADO-RS / QIDO-RS） |
| `local` | `files`（`File[]` 或 `FileList`） | - | 本地拖拽 / 文件选择，`.zip` 自动解包 |
| `zip` | `file`（File/Blob）或 `url` | `headers`, `recursive`（默认 `true`）, `maxImages`（默认 `1000`） | ZIP 影像压缩包多序列导入 |
| `directUrl` | `urls` | `headers` | 直链影像（DICOM / PNG / JPEG …） |
| `syntheticDemo` | - | `sliceCount`（默认 16）, `modality`（`CT` / `MR`） | 内置合成 CT 容积，用于演示与自测 |

### 示例

```ts
// 阿里云 OSS
const aliyunOss: UnifiedImageSourceConfig = {
  type: 'aliyunOss',
  region: 'oss-cn-hangzhou',
  bucket: 'hospital-imaging-vault',
  accessKeyId: 'YOUR_ALIYUN_AK',
  accessKeySecret: 'YOUR_ALIYUN_SK',
  prefix: 'dicom/patients/001/'
};

// 华为云 OBS（临时安全凭证）
const huaweiObs: UnifiedImageSourceConfig = {
  type: 'huaweiObs',
  endpoint: 'obs.cn-north-4.myhuaweicloud.com',
  bucket: 'hospital-pacs-dicom',
  accessKeyId: 'YOUR_HUAWEI_AK',
  secretAccessKey: 'YOUR_HUAWEI_SK',
  securityToken: 'YOUR_SECURITY_TOKEN',
  prefix: 'CT/Study-20261026/'
};

// 私有云 MinIO（Path-Style）
const minio: UnifiedImageSourceConfig = {
  type: 'privateS3',
  endpoint: 'http://192.168.1.100:9000',
  bucket: 'local-pacs',
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin',
  pathStyle: true,
  prefix: 'studies/2026/CT/'
};

// 医院 PACS DICOMweb（WADO-RS）
const dicomWeb: UnifiedImageSourceConfig = {
  type: 'dicomWeb',
  wadoRoot: 'https://pacs.hospital.org/dicom-web',
  studyInstanceUID: '1.2.840.113619.2.55.3.1',
  seriesInstanceUID: '1.2.840.113619.2.55.3.1.2',
  headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1Ni...' }
};

// 本地文件（input[type=file] 或拖拽）
const localFiles: UnifiedImageSourceConfig = {
  type: 'local',
  files: fileInput.files ?? []
};

// ZIP 压缩包（本地或远程）
const remoteZip: UnifiedImageSourceConfig = {
  type: 'zip',
  url: 'https://example.com/study-20261026.zip',
  recursive: true,
  maxImages: 1000
};
```

### 运行时切换数据源

```ts
const images = await viewer.loadImagesFromConfig(dicomWeb);
console.log('已加载影像数量：', images.length);
```

加载完成后会自动按序列分组、渲染左侧序列卡片、刷新右侧元数据面板与底部 Cine 范围。

> **安全提示**：AK/SK 等凭证不要写进前端生产包。建议由后端签发临时凭证（`securityToken` / `stsToken`）或预签名 URL（`usePresignedUrls: true`）后再下发到浏览器。

---

## 序列与切片导航

导入多序列数据（例如同时包含头颅与胸部的 ZIP）后会自动分组，无需手动干预：

- **分组依据**：优先 `BodyPartExamined (0018,0015)`（HEAD→头颅、CHEST→胸部、ABDOMEN→腹部…），其次 `SeriesDescription (0008,103E)`，最后回退为 `${Modality} 序列 ${SeriesNumber}`。
- **分组键**：`SeriesInstanceUID`，一个序列一组。
- **左侧序列卡片**：展示首帧缩略图、名称、模态、序列号与层数，点击切换当前序列。
- **右侧切片滚动条**：`▲` / 拖动 / `▼` 翻层，滚轮同样有效；只有一层时自动隐藏。
- **同步范围**：切换序列会同步图像栈、底部 Cine 滑块范围与层号、右侧元数据面板、选中/悬停状态。
- **测量隔离**：每个序列的测量标注相互独立，离开时快照保存，切回时自动恢复。

```ts
// 查询分组结果
viewer.getSeriesGroups();
// [{ label: '头颅', bodyPart: 'HEAD', modality: 'CT', count: 128 }, ...]

// 通过代码切换序列（索引从 0 开始）
viewer.switchSeries(1);
```

---

## 交互与快捷键

### 鼠标

| 操作 | 行为 |
| :--- | :--- |
| 左键拖动 | 当前激活工具（默认调窗 WW/WC；切到「浏览」则仅做切片导航） |
| 右键拖动 | 缩放（以光标为锚点，上拖放大 / 下拖缩小） |
| 中键拖动 / `Shift` + 左键 | 平移 |
| `Ctrl`/`⌘` + 左键拖动 | 缩放 |
| `Alt` + 左键拖动 | 调窗 |
| 滚轮 | 上一张 / 下一张（兼容触控板增量与高分辨率滚轮） |
| `Ctrl`/`⌘` + 滚轮 | 以光标为中心缩放 |
| `Alt` + 滚轮 | 调整窗宽 |
| 双击画布 | 适配窗口（重置缩放/平移/旋转） |

### 测量编辑

- 按住左键**拖动即完成**绘制（松开收笔）；也支持「单击起点 → 移动预览 → 再次单击」的点击式流程（角度工具为三次点击）。
- 拖动标注**控制点**可调整端点并实时重算长度/角度/面积/HU 统计。
- 拖动标注**本体**可整体平移。
- 悬停高亮并切换光标（`move` / `nwse-resize`），点击选中后按 `Delete` 删除。

### 键盘（画布聚焦或指针位于视口内时生效）

| 按键 | 行为 |
| :--- | :--- |
| `↑` `↓` `←` `→` / `PageUp` `PageDown` | 上一张 / 下一张 |
| `Home` / `End` | 第一张 / 最后一张 |
| `+` `=` / `-` `_` | 放大 / 缩小 |
| `0` 或 `R` | 重置视图（适配窗口） |
| `I` | 反相 |
| `H` / `V` | 水平 / 垂直翻转 |
| `T` | 旋转 90° |
| `Space` | Cine 播放 / 暂停 |
| `Esc` | 取消进行中的绘制、清除选中 |
| `Delete` / `Backspace` | 删除选中/悬停的测量 |

> 输入框、下拉框内不拦截按键；带 `Ctrl`/`⌘`/`Alt` 的组合键默认交还浏览器。

---

## API 参考

### 构造选项 `OpenMedViewerOptions`

| 字段 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `container` | `HTMLElement` | 必填 | 挂载容器，需有确定宽高 |
| `initialConfig` | `UnifiedImageSourceConfig` | `{ type: 'syntheticDemo', sliceCount: 16 }` | 初始数据源 |
| `initialLayout` | `ViewportLayout` | `'1x1'` | 初始排版 |
| `initialTool` | `ToolType` | `'none'` | 初始激活工具 |
| `showToolbar` | `boolean` | `true` | 是否显示顶部工具栏 |

### 实例方法 `OpenMedViewer`

| 方法 | 返回值 | 说明 |
| :--- | :--- | :--- |
| `loadImagesFromConfig(config)` | `Promise<DicomImage[]>` | 加载 / 切换数据源，自动分组并刷新 UI |
| `getActiveViewport()` | `Viewport` | 获取当前激活视口 |
| `setLayout(layout)` | `void` | 切换排版（`1x1` / `1x2` / `2x1` / `2x2`） |
| `setActiveTool(tool)` | `void` | 切换交互工具 |
| `switchSeries(index)` | `void` | 切换序列（同步图像、Cine、测量） |
| `getSeriesGroups()` | `{ label, bodyPart?, modality, count }[]` | 查询分组结果 |
| `getEvents()` | `EventEmitter<ViewerEvents>` | 获取事件总线 |
| `destroy()` | `void` | 销毁实例、解除监听并清空容器 |

### 视口方法 `Viewport`

`setImages(images, initialIndex?)`、`setImageIndex(i)`、`nextImage()` / `prevImage()`、`scrollSlices(steps)`、`getState()`、`getCurrentImage()`、`setWindowLevel(wc, ww)`、`setZoom`、`setPan`、`setRotation`、`toggleFlipH/V()`、`toggleInvert()`、`setColormap(c)`、`rotate90()`、`resetView()`、`zoomAt(x, y, factor)`、`startCine(fps)` / `stopCine()` / `isCineActive()`、`addMeasurement` / `updateMeasurement` / `removeMeasurement` / `clearMeasurements` / `getMeasurements` / `setMeasurements`、`getCanvas()`、`render()`、`destroy()`。

### 事件 `ViewerEvents`

| 事件 | 载荷 | 触发时机 |
| :--- | :--- | :--- |
| `imageLoaded` | `{ image, index, total }` | 影像加载完成 |
| `imageChanged` | `{ image, index }` | 当前切片切换 |
| `viewportUpdated` | `{ state }` | 视口状态（窗位/缩放/旋转等）变化 |
| `toolChanged` | `{ activeTool }` | 工具切换 |
| `measurementAdded` / `measurementUpdated` / `measurementRemoved` / `measurementsCleared` | `{ measurement }` / `{ measurementId }` / `void` | 测量生命周期 |
| `layoutChanged` | `{ layout }` | 排版切换 |
| `cineStateChanged` | `{ isPlaying, fps, frame }` | Cine 播放状态变化 |
| `error` | `{ code, message, details? }` | 运行时错误 |

### 关键类型

```ts
type ViewportLayout = '1x1' | '1x2' | '2x1' | '2x2' | '1x3' | '3x3';

type ToolType =
  | 'none' | 'windowLevel' | 'pan' | 'zoom' | 'rotate'
  | 'length' | 'angle' | 'cobbAngle'
  | 'rectangleRoi' | 'ellipseRoi' | 'freehandRoi'
  | 'arrow' | 'text' | 'probe' | 'magnify' | 'crosshair' | 'eraser';

type ColormapType = 'grayscale' | 'hot-iron' | 'rainbow' | 'pet' | 'bone';
```

---

## 项目结构

```
.
├── src
│   ├── index.ts              # 库统一出口（引擎 / 适配器 / 工具 / UI / 类型）
│   ├── main.ts               # 本地开发体验页入口
│   ├── types/                # 全局类型：DICOM、配置、事件、测量
│   ├── engine/               # Viewport、ImageRenderer、色表、Cornerstone、VTK
│   ├── dicom/                # DICOM 解析、WASM 解码调度、合成数据、窗位预设
│   ├── adapters/             # OBS / OSS / S3 / DICOMweb / 本地 / ZIP 适配器
│   ├── tools/                # 交互工具与测量工具
│   ├── layout/               # 多画幅排版与视口同步
│   ├── export/               # 截图与 JSON 报告导出
│   ├── ui/                   # MedViewerUI（工具栏、序列卡片、切片滚动条、信息栏）
│   ├── vue/                  # Vue 3 适配层
│   └── react/                # React 适配层
├── public/                   # 开发期 WASM 解码器
├── scripts/copy-wasm.mjs     # 构建时复制 WASM 到 dist/wasm
├── index.html                # 开发体验页
├── vite.config.ts            # 库构建配置（ESM + CJS）
├── vite.subpath.config.ts    # Vue / React 子路径构建
└── LICENSE                   # MIT
```

---

## 构建与发布

```bash
# 类型检查（不产出文件）
npx tsc --noEmit

# 完整构建：主入口 + 子路径 + 类型声明 + WASM
npm run build

# 发布到 npm
npm publish --access public
```

构建产物：

| 文件 | 说明 |
| :--- | :--- |
| `dist/open-med-viewer.es.js` | ESM 主入口（`import`） |
| `dist/open-med-viewer.cjs` | CommonJS 主入口（`require`） |
| `dist/vue/index.js`、`dist/react/index.js` | 框架子路径入口 |
| `dist/types/**` | TypeScript 声明文件 |
| `dist/wasm/*.wasm` | Cornerstone 压缩解码器 |
| `dist/chunks/**` | 按需加载的解码器分包 |

> 构建采用 ESM + CJS 双格式而非 UMD/IIFE：压缩解码器通过动态 `import()` 懒加载，会产生独立 chunk，UMD/IIFE 不支持多 chunk 输出。

---

## 常见问题

**Q：容器一片空白 / 视口尺寸为 0？**
确保挂载容器有明确宽高（如 `width: 100vw; height: 100vh`），并在 DOM 就绪后再实例化（Vue `onMounted`、React `useEffect`）。

**Q：压缩 DICOM（JPEG2000 / JPEG-LS 等）显示不出来？**
确认 `dist/wasm/` 已随静态资源一起部署。若部署在子路径或 CDN，调用 `CornerstoneImageDecoder.setWasmBasePath('/your/path/wasm/')`。

**Q：宿主项目使用 Vite 时构建报 `extends undefined` / 白屏？**
`@cornerstonejs/core → @kitware/vtk.js → xmlbuilder2` 在模块顶层依赖 Node 的 `events` / `url`，需要为这两个模块提供浏览器 shim（本仓库见 `src/shims/`）。在宿主项目中可配置 `resolve.alias` 指向对应的 polyfill。

**Q：一张影像都没有切换时报错 `index out of range`？**
切片索引会被自动裁剪到有效范围（0 ~ total-1），但请确保已通过 `loadImagesFromConfig` 或 `initialConfig` 完成加载后再调用 `switchSeries` / `setImageIndex`。

**Q：如何禁用某个工具栏按钮或整个工具栏？**
`showToolbar: false` 可隐藏顶部工具栏；按钮级别可通过实例的 `setActiveTool` 控制当前工具，或在宿主侧自行渲染控制条。

---

## 贡献

1. Fork 本仓库并创建分支：`git checkout -b feat/your-feature`
2. 提交前请确保 `npx tsc --noEmit` 与 `npm run build` 均通过
3. 提交信息遵循 Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` …）
4. 发起 Pull Request，描述改动动机、实现要点与验证方式

---

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
