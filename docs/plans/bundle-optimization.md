# 前端打包优化方案

## 当前状态

### 构建产物大小
| 文件 | 原始大小 | Gzip后 | 占比 |
|-----|---------|--------|-----|
| index-0ywkokil.js (应用代码) | 421 KB | 120 KB | **71%** |
| vendor-ui | 89 KB | 26 KB | 15% |
| vendor-form | 82 KB | 25 KB | 14% |
| vendor-react | 47 KB | 17 KB | 8% |
| vendor-utils | 37 KB | 15 KB | 6% |
| CSS | 53 KB | 10 KB | - |

**问题**：`index-0ywkokil.js` 高达 421KB，因为所有页面组件都被同步导入并打包在一起。

---

## 优化步骤

注意使用vercel-react-best-practices、frontend-dev-guidelines技能

### 1. 启用路由懒加载

修改 `App.tsx`，使用 `React.lazy()` 动态导入页面组件：

```typescript
// 改前（同步导入）
import { Dashboard } from '@/pages/Dashboard'

// 改后（懒加载）
const Dashboard = lazy(() => import('@/pages/Dashboard'))
```

**预期效果**：每个页面会生成独立的 chunk，按需加载。

### 2. 优化 vendor 分包策略

修改 `vite.config.ts`：

```typescript
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // React 核心
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // UI 组件库
          'vendor-ui': ['@tanstack/react-table', 'lucide-react', 'clsx', 'tailwind-merge', 'class-variance-authority'],
          // 表单验证（排除 xlsx）
          'vendor-form': ['react-hook-form', '@hookform/resolvers', 'zod'],
          // 工具库
          'vendor-utils': ['axios', 'dayjs', 'zustand'],
          // Excel 处理库（很大，单独分离）
          'vendor-xlsx': ['xlsx'],
        },
      },
    },
  },
})
```

### 3. 添加压缩配置

修改 `vite.config.ts`：

```typescript
export default defineConfig({
  build: {
    // 启用 CSS 代码压缩
    cssMinify: true,
    // 启用代码压缩
    minify: 'esbuild',
    // 生成 sourcemap（生产环境建议关闭）
    sourcemap: false,
    // 块大小警告限制
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        // 压缩文件名
        compactFileNames: true,
      },
    },
  },
  // Vite 5+ 内置 gzip 压缩插件
  plugins: [
    viteCompression(),
  ],
})
```

需要安装：
```bash
npm install vite-plugin-compression -D
```

### 4. 配置预渲染（可选）

如果使用静态部署，可以配置预压缩：

```typescript
import viteCompression from 'vite-plugin-compression'

export default defineConfig({
  plugins: [
    viteCompression({
      algorithm: 'gzip',
      ext: '.gz',
    }),
    viteCompression({
      algorithm: 'brotliCompress',
      ext: '.br',
    }),
  ],
})
```

---

## 预期优化效果

| 优化项 | 优化前 | 优化后（预期） |
|-------|--------|---------------|
| 首屏 JS 加载 | ~421KB | ~80-120KB |
| 首屏加载（Gzip） | ~120KB | ~30-50KB |
| 路由懒加载 | 无 | 有 |
| 缓存策略 | 差 | 好 |

---

## 执行顺序

1. ✅ 分析当前构建配置
2. ⏳ 启用路由懒加载（React.lazy）
3. ⏳ 优化 vendor 分包策略
4. ⏳ 添加 gzip/brotli 压缩配置
5. ⏳ 配置 Tree Shaking 和压缩选项
6. ⏳ 移除未使用的依赖（如 xlsx 如未使用）
7. ⏳ 构建并验证优化效果

---

## 相关文件

- `frontend/vite.config.ts` - 构建配置
- `frontend/src/App.tsx` - 路由配置
- `frontend/package.json` - 依赖配置
