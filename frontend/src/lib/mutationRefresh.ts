import { isCancelledError } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from '@/lib/toast'

/** 仅用于写入已成功后的刷新，避免刷新异常被误报为业务失败。 */
export async function refreshAfterMutation(refresh: () => unknown | Promise<unknown>, timeoutMs = 3000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const work = Promise.resolve().then(refresh).catch((error: unknown) => {
    // 后续刷新接管查询时，取消旧查询不代表刷新失败。
    if (!isCancelledError(error) && !axios.isCancel(error)) {
      toast.warning('操作已成功，界面刷新失败，请手动刷新查看')
    }
  })
  try {
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
