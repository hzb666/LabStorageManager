import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 1. 引入 TanStack Query 需要的 Provider 和 Client
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'

const LSM_BANNER = [
  '╔═══════════════════════════════════════════╗',
  '║                                           ║',
  '║     ██╗        ███████╗   ███╗   ███╗     ║',
  '║     ██║        ██╔════╝   ████╗ ████║     ║',
  '║     ██║        ███████╗   ██╔████╔██║     ║',
  '║     ██║        ╚════██║   ██║╚██╔╝██║     ║',
  '║     ███████╗   ███████║   ██║ ╚═╝ ██║     ║',
  '║     ╚══════╝   ╚══════╝   ╚═╝     ╚═╝     ║',
  '║                                           ║',
  '╚══════      Lab Storage Manager      ══════╝'
].join('\n')

console.log(
  '%c' + LSM_BANNER,
  'color: #3b82f6; font-weight: bold; font-family: "Courier New", Courier, monospace; font-size: 12px; line-height: 12px;'
)

// 2. 创建一个 QueryClient 实例
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // 推荐配置：切换浏览器标签页时不自动重新请求
      retry: 1,                    // 失败时默认重试 1 次
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 3. 使用 QueryClientProvider 包裹你的 App，并传入 queryClient */}
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
