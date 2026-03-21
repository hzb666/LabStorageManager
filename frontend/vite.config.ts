import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import viteCompression from 'vite-plugin-compression'

const chunkGroups: Record<string, string[]> = {
  'vendor-react': ['react', 'react-dom', 'react-router-dom'],
  'vendor-ui': ['@tanstack/react-table', 'lucide-react', 'clsx', 'tailwind-merge', 'class-variance-authority'],
  'vendor-form': ['react-hook-form', '@hookform/resolvers', 'valibot'],
  'vendor-utils': ['axios', 'dayjs', 'zustand'],
  'vendor-rdkit': ['@rdkit/rdkit'],
  'vendor-radix': [
    '@radix-ui/react-dialog',
    '@radix-ui/react-dropdown-menu',
    '@radix-ui/react-select',
    '@radix-ui/react-tooltip',
    '@radix-ui/react-popover',
    '@radix-ui/react-slot',
  ],
}

const resolveManualChunk = (moduleId: string): string | undefined => {
  const normalizedModuleId = moduleId.replace(/\\/g, '/')
  for (const [chunkName, packages] of Object.entries(chunkGroups)) {
    if (packages.some((pkg) => normalizedModuleId.includes(`/node_modules/${pkg}/`))) {
      return chunkName
    }
  }
  return undefined
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // 只在生产环境启用压缩
    ...(mode === 'production' ? [
      // gzip 压缩
      viteCompression({
        algorithm: 'gzip',
        ext: '.gz',
      }),
      // brotli 压缩
      viteCompression({
        algorithm: 'brotliCompress',
        ext: '.br',
      }),
    ] : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // 依赖预构建优化
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'axios'],
  },
  // 开发服务器配置
  server: {
    headers: {
      // RDKit 文件缓存 10 年
      'Cache-Control': 'public, max-age=315360000',
    },
  },
  // 静态资源缓存配置
  publicAssetsRetry: [
    {
      // RDKit 文件缓存 10 年
      test: /\/lib\/(RDKit|.*\.wasm).*/,
      maxAge: 60 * 60 * 24 * 365 * 10, // 10年
    },
  ],
  build: {
    // 目标浏览器
    target: 'es2020',
    // 启用 CSS 代码压缩
    cssMinify: true,
    // 启用代码压缩
    minify: 'esbuild',
    // 生产环境关闭 sourcemap
    sourcemap: false,
    // 块大小警告限制
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        // 手动分割代码块
        manualChunks: resolveManualChunk,
      },
    },
  },
}))
