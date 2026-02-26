import { useEffect } from 'react'

export function TestErrorPage() {
  useEffect(() => {
    // 组件挂载时抛出错误，触发 ErrorBoundary
    throw new Error('这是一个测试错误页面 - Test Error Page')
  }, [])
  
  return null
}
