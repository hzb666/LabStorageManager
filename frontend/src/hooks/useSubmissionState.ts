import { useCallback, useMemo, useRef, useState } from 'react'

export type SubmissionSetter = (pending: boolean) => boolean

export function createSubmissionLock() {
  let pending = false
  return {
    acquire() {
      if (pending) return false
      pending = true
      return true
    },
    release() { pending = false },
  }
}

export type SubmissionLock = ReturnType<typeof createSubmissionLock>
export function useSubmissionLock() {
  return useMemo(() => createSubmissionLock(), [])
}

/** 同步加锁，避免渲染更新前重复进入；多个动作可共用同一把锁。 */
export function useSubmissionState(sharedLock?: SubmissionLock) {
  const [pending, setPending] = useState(false)
  const active = useRef(false)
  const localLock = useSubmissionLock()
  const lock = sharedLock ?? localLock
  const setSubmitting: SubmissionSetter = useCallback((next) => {
    if (next) {
      if (!lock.acquire()) return false
      active.current = true
    } else {
      if (!active.current) return false
      active.current = false
      lock.release()
    }
    setPending(next)
    return true
  }, [lock])
  return [pending, setSubmitting] as const
}
