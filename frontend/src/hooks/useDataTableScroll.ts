/** 表格展开时的滚动定位 Hook。 */
import { useRef, useCallback, useEffect } from 'react'
import type { RefObject, MutableRefObject, MouseEvent, UIEvent } from 'react'
import type { Row } from '@tanstack/react-table'
import type { Virtualizer } from '@tanstack/react-virtual'

// 提供展开滚动动画使用的缓出曲线。
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

// 平滑滚动到目标位置
function animateScrollTo(el: HTMLDivElement, targetY: number, duration: number) {
  const startY = el.scrollTop
  const distance = targetY - startY
  let startTime: number | null = null
  let expectedScrollTop = startY

  // 在滚动被用户打断时提前停止动画，避免回弹感。
  const smoothScroll = (currentTime: number) => {
    if (Math.abs(el.scrollTop - expectedScrollTop) > 2) return
    if (!startTime) startTime = currentTime

    const elapsed = currentTime - startTime
    const progress = Math.min(elapsed / duration, 1)

    el.scrollTop = startY + distance * easeOutCubic(progress)
    expectedScrollTop = el.scrollTop

    if (progress < 1) requestAnimationFrame(smoothScroll)
  }

  requestAnimationFrame(smoothScroll)
}

interface UseDataTableScrollOptions {
  bodyScrollRef: RefObject<HTMLDivElement | null>
  headerScrollRef?: RefObject<HTMLDivElement | null>
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  fetchNextPage?: () => void
  onIsAtTopChange?: (isAtTop: boolean) => void
}

function syncHeaderScroll(
  headerScrollRef: RefObject<HTMLDivElement | null> | undefined,
  scrollTarget: HTMLDivElement,
) {
  if (headerScrollRef?.current) {
    headerScrollRef.current.scrollLeft = scrollTarget.scrollLeft
  }
}

function updateIsAtTop(
  isAtTopRef: MutableRefObject<boolean>,
  scrollTop: number,
  onIsAtTopChange?: (isAtTop: boolean) => void,
) {
  const nextIsAtTop = scrollTop <= 2
  if (onIsAtTopChange && isAtTopRef.current !== nextIsAtTop) {
    isAtTopRef.current = nextIsAtTop
    onIsAtTopChange(nextIsAtTop)
  }
}

// 管理无限滚动触发与点击展开时的滚动修正。
export function useDataTableScroll<TData>({
  bodyScrollRef,
  headerScrollRef,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  onIsAtTopChange,
}: UseDataTableScrollOptions) {
  const scrollLockRef = useRef(false)
  const scrollFrameRef = useRef<number | null>(null)
  const pendingScrollTargetRef = useRef<HTMLDivElement | null>(null)
  const isAtTopRef = useRef(true)
  const virtualizerRef = useRef<Virtualizer<HTMLDivElement, Element> | null>(null)

  // 记录最新的 virtualizer，供滚动判断和点击展开时使用。
  const setVirtualizerForScroll = useCallback((v: Virtualizer<HTMLDivElement, Element>) => {
    virtualizerRef.current = v
  }, [])

  // 当滚动接近底部时触发下一页加载，并用锁防止重复触发。
  const handleInfiniteScroll = useCallback(() => {
    if (scrollLockRef.current || !hasNextPage || isFetchingNextPage) return
    scrollLockRef.current = true

    requestAnimationFrame(() => {
      const el = bodyScrollRef.current
      const virtualizer = virtualizerRef.current

      if (el && virtualizer) {
        const { scrollTop, clientHeight } = el
        const totalHeight = virtualizer.getTotalSize()
        if (totalHeight - scrollTop - clientHeight < 200) fetchNextPage?.()
      }

      scrollLockRef.current = false
    })
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, bodyScrollRef])

  const flushScrollFrame = useCallback(() => {
    scrollFrameRef.current = null
    const scrollTarget = pendingScrollTargetRef.current
    if (!scrollTarget) return

    syncHeaderScroll(headerScrollRef, scrollTarget)
    updateIsAtTop(isAtTopRef, scrollTarget.scrollTop, onIsAtTopChange)
    handleInfiniteScroll()
  }, [handleInfiniteScroll, headerScrollRef, onIsAtTopChange])

  const handleContainerScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    pendingScrollTargetRef.current = e.currentTarget
    if (scrollFrameRef.current !== null) return

    scrollFrameRef.current = window.requestAnimationFrame(flushScrollFrame)
  }, [flushScrollFrame])

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
      }
    }
  }, [])

  // 展开位于视口上方的行时，把该行平滑滚回可见区域顶部。
  const handleRowClick = useCallback((e: MouseEvent<HTMLDivElement>, row: Row<TData>) => {
    const isExpanding = !row.getIsExpanded()
    row.toggleExpanded()

    const el = bodyScrollRef.current
    const container = e.currentTarget.closest('[data-index]')

    if (isExpanding && el && container && virtualizerRef.current) {
      const index = Number(container.getAttribute('data-index'))
      const initialItem = virtualizerRef.current.getVirtualItems().find((v) => v.index === index)

      if (initialItem && initialItem.start < el.scrollTop) {
        animateScrollTo(el, initialItem.start, 300)
      }
    }
  }, [bodyScrollRef])

  return {
    handleContainerScroll,
    handleRowClick,
    setVirtualizerForScroll,
  }
}

// 同步 virtualizer 实例到滚动逻辑内部的 ref，避免点击行时拿到旧引用。
export function useSyncVirtualizerRef(
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>,
  setVirtualizerForScroll: (v: Virtualizer<HTMLDivElement, Element>) => void,
) {
  useEffect(() => {
    setVirtualizerForScroll(rowVirtualizer)
  }, [rowVirtualizer, setVirtualizerForScroll])
}
