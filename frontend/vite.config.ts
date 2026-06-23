import path from "path"
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin, type PluginOption } from 'vite'

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

const gzipAsync = promisify(gzip)
const brotliCompressAsync = promisify(brotliCompress)
const COMPRESSIBLE_ASSET_RE = /\.(?:js|mjs|css|html|json|svg|wasm)$/i
const MIN_COMPRESS_SIZE = 1024
const uploadSentrySourceMaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
)

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return collectFiles(fullPath)
    }
    return [fullPath]
  }))
  return files.flat()
}

function createDualCompressionPlugin(): Plugin {
  let outputDir = ''

  return {
    name: 'app:dual-compression',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outputDir = path.isAbsolute(config.build.outDir)
        ? config.build.outDir
        : path.resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      const files = (await collectFiles(outputDir)).filter((filePath) =>
        COMPRESSIBLE_ASSET_RE.test(filePath)
      )

      await Promise.all(files.map(async (filePath) => {
        const fileStat = await stat(filePath)
        if (fileStat.size < MIN_COMPRESS_SIZE) {
          return
        }

        const content = await readFile(filePath)
        const [gzipContent, brotliContent] = await Promise.all([
          gzipAsync(content, { level: zlibConstants.Z_BEST_COMPRESSION }),
          brotliCompressAsync(content, {
            params: {
              [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
              [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
            },
          }),
        ])

        await Promise.all([
          writeFile(`${filePath}.gz`, gzipContent),
          writeFile(`${filePath}.br`, brotliContent),
        ])
      }))
    },
  }
}

function createPlugins(): PluginOption[] {
  const plugins: PluginOption[] = [
    react(),
    createDualCompressionPlugin(),
  ]

  if (uploadSentrySourceMaps) {
    plugins.push(sentryVitePlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      sourcemaps: {
        filesToDeleteAfterUpload: ['dist/**/*.map'],
      },
    }))
  }

  return plugins
}

// https://vite.dev/config/
export default defineConfig({
  plugins: createPlugins(),
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // 依赖预构建优化
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'axios'],
  },
  build: {
    // 目标浏览器
    target: 'es2020',
    // 启用 CSS 代码压缩
    cssMinify: true,
    // 启用代码压缩
    minify: 'esbuild',
    // 仅在上传到 Sentry 时生成隐藏 sourcemap；上传后删除 .map 文件。
    sourcemap: uploadSentrySourceMaps ? 'hidden' : false,
    // 块大小警告限制
    chunkSizeWarningLimit: 500,
    rolldownOptions: {
      checks: {
        pluginTimings: false,
      },
      output: {
        // 手动分割代码块
        manualChunks: resolveManualChunk,
      },
    },
  },
})
