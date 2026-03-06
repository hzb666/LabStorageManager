import { useState, useCallback } from 'react'

// 记住的用户信息类型
export interface RememberedUser {
  userId: number
  username: string
  full_name: string
  avatar_url?: string
}

const STORAGE_KEY = 'remembered-user'

/**
 * Hook: 记住用户信息
 * 用于实现类似微软锁屏的登录体验
 * - 登录成功后自动保存用户信息（无需勾选）
 * - Session 过期后显示锁屏模式，只需输入密码
 * - 修改用户名时清除记住信息，修改头像自动更新
 */
export function useRememberedUser() {
  const [rememberedUser, setRememberedUserState] = useState<RememberedUser | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        return JSON.parse(stored) as RememberedUser
      }
    } catch (error) {
      console.error('Failed to parse remembered user:', error)
    }
    return null
  })

  // 保存记住的用户信息
  const saveRememberedUser = useCallback((user: RememberedUser) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
      setRememberedUserState(user)
    } catch (error) {
      console.error('Failed to save remembered user:', error)
    }
  }, [])

  // 清除记住的用户信息
  const clearRememberedUser = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
      setRememberedUserState(null)
    } catch (error) {
      console.error('Failed to clear remembered user:', error)
    }
  }, [])

  // 更新记住的用户信息（用于登录成功后自动更新头像）
  const updateRememberedUser = useCallback((updates: Partial<RememberedUser>) => {
    if (!rememberedUser) return
    
    const updated = { ...rememberedUser, ...updates }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      setRememberedUserState(updated)
    } catch (error) {
      console.error('Failed to update remembered user:', error)
    }
  }, [rememberedUser])

  return {
    rememberedUser,
    saveRememberedUser,
    clearRememberedUser,
    updateRememberedUser,
  }
}
