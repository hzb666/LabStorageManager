import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 手动分割代码块，优化加载性能
        manualChunks: {
          // React 核心
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // UI 组件库
          'vendor-ui': ['@tanstack/react-table', 'lucide-react', 'clsx', 'tailwind-merge', 'class-variance-authority'],
          // 表单验证
          'vendor-form': ['react-hook-form', '@hookform/resolvers', 'zod'],
          // 工具库
          'vendor-utils': ['axios', 'dayjs', 'zustand'],
        },
      },
    },
  },
})
