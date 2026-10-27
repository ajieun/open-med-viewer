import { OpenMedViewer } from './index';

// 页面加载后启动 OpenMedViewer
window.addEventListener('DOMContentLoaded', () => {
  const mountEl = document.getElementById('viewer-mount-point');
  if (!mountEl) return;

  // 1. 初始化阅片器实例 (默认载入 16 层面高保真真实颅脑 CT 容积)
  const viewer = new OpenMedViewer({
    container: mountEl,
    initialConfig: {
      type: 'syntheticDemo',
      sliceCount: 16
    },
    initialLayout: '1x1',
    initialTool: 'windowLevel',
    showToolbar: true
  });

  // 2. 绑定框架切换与指南弹窗逻辑
  setupGuideModals();
});

function setupGuideModals(): void {
  const modal = document.getElementById('code-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalContent = document.getElementById('modal-content');
  const closeBtn = document.getElementById('close-guide-btn');

  const tabLive = document.getElementById('tab-live-viewer');
  const tabVue = document.getElementById('tab-vue-guide');
  const tabReact = document.getElementById('tab-react-guide');
  const tabNpm = document.getElementById('tab-npm-guide');

  const setTabActive = (activeBtn: HTMLElement) => {
    [tabLive, tabVue, tabReact, tabNpm].forEach((b) => b?.classList.remove('active'));
    activeBtn.classList.add('active');
  };

  closeBtn?.addEventListener('click', () => {
    if (modal) modal.style.display = 'none';
    if (tabLive) setTabActive(tabLive);
  });

  tabLive?.addEventListener('click', () => {
    if (modal) modal.style.display = 'none';
    setTabActive(tabLive);
  });

  tabVue?.addEventListener('click', () => {
    if (!modal || !modalTitle || !modalContent) return;
    setTabActive(tabVue);
    modalTitle.innerHTML = '🟢 Vue 3 接入与云存储配置指南';
    modalContent.innerHTML = `
      <p style="margin-bottom: 8px;">在 Vue 3 项目中，可以通过 <code>npm install @open-med/viewer</code> 安装后在任意组件中直接调用：</p>
      
      <h4 style="color: #38bdf8; margin-top: 14px;">1. Vue 3 核心模板 (Composition API / &lt;script setup&gt;)</h4>
      <pre><code>&lt;template&gt;
  &lt;div class="viewer-wrapper"&gt;
    &lt;div ref="viewerContainer" style="width: 100vw; height: 100vh;"&gt;&lt;/div&gt;
  &lt;/div&gt;
&lt;/template&gt;

&lt;script setup lang="ts"&gt;
import { ref, onMounted, onUnmounted } from 'vue';
import { OpenMedViewer, UnifiedImageSourceConfig } from '@open-med/viewer';

const viewerContainer = ref&lt;HTMLElement | null&gt;(null);
let viewer: OpenMedViewer | null = null;

// 1. 华为云 OBS 影像配置示例
const huaweiObsConfig: UnifiedImageSourceConfig = {
  type: 'huaweiObs',
  endpoint: 'obs.cn-north-4.myhuaweicloud.com',
  bucket: 'hospital-pacs-dicom',
  accessKeyId: 'YOUR_HUAWEI_AK',
  secretAccessKey: 'YOUR_HUAWEI_SK',
  prefix: 'CT/Study-20261026/Series-1/'
};

// 2. 阿里云 OSS 影像配置示例
const aliyunOssConfig: UnifiedImageSourceConfig = {
  type: 'aliyunOss',
  region: 'oss-cn-hangzhou',
  bucket: 'medical-vault',
  accessKeyId: 'YOUR_ALIYUN_AK',
  accessKeySecret: 'YOUR_ALIYUN_SK',
  prefix: 'dicom/patients/001/'
};

// 3. 私有云 MinIO / S3 影像配置示例
const privateS3Config: UnifiedImageSourceConfig = {
  type: 'privateS3',
  endpoint: 'http://192.168.1.100:9000',
  bucket: 'local-pacs',
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin',
  prefix: 'studies/'
};

onMounted(() => {
  if (viewerContainer.value) {
    viewer = new OpenMedViewer({
      container: viewerContainer.value,
      initialConfig: huaweiObsConfig, // 传入所选云存储配置
      initialLayout: '1x1',
      initialTool: 'windowLevel'
    });

    // 监听图像切换事件
    viewer.getEvents().on('imageChanged', ({ image, index }) => {
      console.log('当前影像变化:', image.metadata.patientName, '切片:', index + 1);
    });
  }
});

onUnmounted(() => {
  viewer?.destroy();
});
&lt;/script&gt;</code></pre>
    `;
    modal.style.display = 'flex';
  });

  tabReact?.addEventListener('click', () => {
    if (!modal || !modalTitle || !modalContent) return;
    setTabActive(tabReact);
    modalTitle.innerHTML = '⚛️ React 接入与云存储配置指南';
    modalContent.innerHTML = `
      <p style="margin-bottom: 8px;">在 React 18+ 项目中，可以使用内置 Hook 或直接绑定原生 DOM 容器：</p>
      
      <h4 style="color: #38bdf8; margin-top: 14px;">1. React 标准组件实现 (useRef + useEffect)</h4>
      <pre><code>import React, { useEffect, useRef } from 'react';
import { OpenMedViewer, UnifiedImageSourceConfig } from '@open-med/viewer';

export const MedicalViewerPage: React.FC = () => {
  const containerRef = useRef&lt;HTMLDivElement&gt;(null);
  const viewerRef = useRef&lt;OpenMedViewer | null&gt;(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 医院 PACS DICOMweb 配置示例
    const dicomWebConfig: UnifiedImageSourceConfig = {
      type: 'dicomWeb',
      wadoRoot: 'https://pacs.hospital.org/dicom-web',
      studyInstanceUID: '1.2.840.113619.2.55.3.1',
      seriesInstanceUID: '1.2.840.113619.2.55.3.1.2',
      headers: {
        Authorization: 'Bearer eyJhbGciOiJIUzI1Ni...'
      }
    };

    const viewer = new OpenMedViewer({
      container: containerRef.current,
      initialConfig: dicomWebConfig,
      initialLayout: '1x1',
      initialTool: 'windowLevel'
    });

    viewerRef.current = viewer;

    // 监听标注测量新增
    viewer.getEvents().on('measurementAdded', ({ measurement }) => {
      console.log('新增医学测量记录:', measurement);
    });

    return () => {
      viewer.destroy();
    };
  }, []);

  return (
    &lt;div style={{ width: '100vw', height: '100vh', background: '#000' }}&gt;
      &lt;div ref={containerRef} style={{ width: '100%', height: '100%' }} /&gt;
    &lt;/div&gt;
  );
};</code></pre>
    `;
    modal.style.display = 'flex';
  });

  tabNpm?.addEventListener('click', () => {
    if (!modal || !modalTitle || !modalContent) return;
    setTabActive(tabNpm);
    modalTitle.innerHTML = '📦 NPM 安装与打包发布指南';
    modalContent.innerHTML = `
      <p style="margin-bottom: 8px;">本项目结构为标准的 Framework-Agnostic NPM 库架构，已配置好 ESM/UMD 双格式打包输出与 TypeScript 类型声明：</p>
      
      <h4 style="color: #38bdf8; margin-top: 14px;">1. 在宿主项目中安装</h4>
      <pre><code># 使用 npm
npm install @open-med/viewer

# 或使用 pnpm / yarn
pnpm add @open-med/viewer
yarn add @open-med/viewer</code></pre>

      <h4 style="color: #38bdf8; margin-top: 14px;">2. 本地开发与构建命令</h4>
      <pre><code># 启动本地开发服务 (支持实时热更新与影像测试)
npm run dev

# 打包生产环境库文件 (生成 dist/open-med-viewer.es.js 与 dist/types)
npm run build

# 发布至 NPM 官方或私有源 (Verdaccio / Nexus)
npm publish --access public</code></pre>

      <h4 style="color: #38bdf8; margin-top: 14px;">3. 特性清单</h4>
      <ul style="padding-left: 20px; line-height: 1.8;">
        <li>✅ <strong>全格式兼容:</strong> 纯 TypeScript 零外部厚重依赖解析 DICOM Part 10 16-bit CT/MR/XR，兼容普通病理/内镜 PNG/JPG。</li>
        <li>✅ <strong>多云直连:</strong> 华为云 OBS、阿里云 OSS、私有化 MinIO/Ceph/S3、院内 PACS DICOMweb、本地拖拽。</li>
        <li>✅ <strong>丰富工具集:</strong> 动态 WW/WC 调窗、解剖窗预设 (脑/骨/肺/纵隔/肝脏/硬膜下/脊柱)、测距 (毫米标尺)、角度测量、Cobb 角、矩形 ROI (Area/Mean/Max/Min HU)、椭圆 ROI、像素探针 (实时 HU)、箭头注释。</li>
        <li>✅ <strong>多画幅同步:</strong> 1x1, 1x2, 2x1, 2x2, 联动切片同步滚动。</li>
        <li>✅ <strong>Cine 序列播放:</strong> 多层切片平滑 60 FPS 播放、拖动条定位、FPS 无级调节。</li>
      </ul>
    `;
    modal.style.display = 'flex';
  });
}
