import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // 浏览器端 Node 内置模块 polyfill:
      // @cornerstonejs/core -> @kitware/vtk.js -> xmlbuilder2 在模块顶层依赖 events/url，
      // 若不 polyfill 会被外部化为空对象，导致 `extends undefined` 白屏。
      events: resolve(__dirname, './src/shims/events.ts'),
      url: resolve(__dirname, './src/shims/url.ts')
    }
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'OpenMedViewer',
      // 说明: 压缩 DICOM 解码器通过动态 import 懒加载，会产出独立 chunk。
      // Rollup 的 UMD/IIFE 不支持多 chunk 输出，因此这里使用 ESM + CJS
      // （两者都支持代码分割，且是现代 npm 消费方式）。
      fileName: (format) => (format === 'es' ? 'open-med-viewer.es.js' : `open-med-viewer.${format}`),
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      // 外部化 peerDependencies (若后续用户在 Vue/React 项目中引入)
      external: ['vue', 'react', 'react-dom'],
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js'
      }
    }
  },
  // dicom-image-loader 使用 module worker 解码，iife 格式无法承载多 chunk
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    // dicom-image-loader 内部通过 `new Worker(new URL('./decodeImageFrameWorker.js', import.meta.url))`
    // 创建解码 Worker，预打包后会丢失该相对路径，因此排除优化让 Vite 直接按源码处理
    exclude: ['@cornerstonejs/dicom-image-loader'],
    // 这些 WASM 编解码器是 CJS 模块，需要预打包以获得 default 导出互操作能力
    include: [
      '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs',
      '@cornerstonejs/codec-openjpeg/decodewasmjs',
      '@cornerstonejs/codec-charls/decodewasmjs',
      '@cornerstonejs/codec-openjph/wasmjs',
      '@cornerstonejs/codec-libjxl/decodewasmjs'
    ]
  },
  server: {
    port: 3000,
    open: true
  }
});
