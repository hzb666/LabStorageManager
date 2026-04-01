import { useState, useEffect, useCallback } from 'react'
import {
  getThemePreference,
  setTheme as persistTheme,
  type AppTheme,
} from '@/lib/storage/appUiStorage'

type Theme = AppTheme

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    // 优先从 app-ui 持久化读取
    if (typeof window !== 'undefined') {
      const saved = getThemePreference()
      if (saved === 'dark' || saved === 'light') {
        return saved
      }
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
    persistTheme(theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    // 暗黑模式切换时禁用所有过渡
    const style = document.createElement('style')
    style.textContent = '*,*::before,*::after{transition:none !important}'
    document.head.appendChild(style)

    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))

    // 强制重绘后移除禁用样式
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.head.removeChild(style)
      })
    })
  }, [])

  return { theme, setTheme, toggleTheme }
}
