import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * 子路径产物构建配置
 *
 * 主入口 (vite.config.ts) 只产出 dist/open-med-viewer.{es,umd}.js，
 * 这里额外构建 package.json `exports` 中声明的 `@open-med/viewer/vue`
 * 与 `@open-med/viewer/react` 两个子路径入口。
 */
export default defineConfig({
  worker: {
    format: 'es'
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      events: resolve(__dirname, './src/shims/events.ts'),
      url: resolve(__dirname, './src/shims/url.ts')
    }
  },
  build: {
    // 不能清空 dist，否则会删掉主入口产物
    emptyOutDir: false,
    lib: {
      entry: {
        'vue/index': resolve(__dirname, 'src/vue/index.ts'),
        'react/index': resolve(__dirname, 'src/react/index.ts')
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    rollupOptions: {
      external: ['vue', 'react', 'react-dom'],
      output: {
        // vue / react 入口共享的核心代码抽成公共 chunk，避免重复打包
        chunkFileNames: 'shared/[name]-[hash].js'
      }
    }
  }
});
