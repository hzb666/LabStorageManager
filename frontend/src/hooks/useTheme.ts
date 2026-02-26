import { useState, useEffect, useCallback } from 'react'

type Theme = 'light' | 'dark'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    // 优先从 localStorage 读取
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme') as Theme
      if (saved) return saved
      // 如果没有保存，检查系统偏好
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark'
      }
    }
    return 'light'
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
      root.style.colorScheme = 'dark'
    } else {
      root.classList.remove('dark')
      root.style.colorScheme = 'light'
    }
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    // 暗黑模式切换时禁用所有过渡
    const style = document.createElement('style')
    style.textContent = '*,*::before,*::after{transition:none !important}'
    document.head.appendChild(style)
    
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
    
    // 强制重绘后移除禁用样式
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.head.removeChild(style)
      })
    })
  }, [])

  return { theme, setTheme, toggleTheme }
}
