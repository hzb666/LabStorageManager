/** 批量展开/折叠动画 Hook。 */
import { useRef, useCallback, useState, useEffect, useLayoutEffect } from 'react'
import type { Table as TableType, Row } from '@tanstack/react-table'
import type { Virtualizer } from '@tanstack/react-virtual'

interface BulkAnchor {
  rowId: string
  offsetInRow: number
}

interface UseBulkExpandOptions<TData> {
  table: TableType<TData>
  rows: Row<TData>[]
  enableExpandAll: boolean
  isAllExpanded: boolean
  disableBulkExpandAnimation?: boolean
  bodyScrollRef: React.RefObject<HTMLDivElement | null>
}

interface BulkAnimationControls {
  frameRef: React.MutableRefObject<number | null>
  runId: number
  runIdRef: React.MutableRefObject<number>
  timerRef: React.MutableRefObject<number | null>
}

/** 批量展开结束后的多帧测量与锚点恢复。 */
function scheduleBulkAnimationComplete(
  virtualizerRef: React.RefObject<Virtualizer<HTMLDivElement, Element> | null>,
  bulkAnchorRef: React.MutableRefObject<BulkAnchor | null>,
  bulkAnimationControls: BulkAnimationControls,
  restoreBulkAnchor: (anchor: BulkAnchor | null) => void,
  setIsBulkAnimating: (v: boolean) => void,
) {
  // 第一帧：测量
  bulkAnimationControls.frameRef.current = window.requestAnimationFrame(() => {
    if (bulkAnimationControls.runIdRef.current !== bulkAnimationControls.runId) return
    virtualizerRef.current?.measure()

    // 第二帧：再次测量 + 恢复锚点
    bulkAnimationControls.frameRef.current = window.requestAnimationFrame(() => {
      if (bulkAnimationControls.runIdRef.current !== bulkAnimationControls.runId) return
      virtualizerRef.current?.measure()
      restoreBulkAnchor(bulkAnchorRef.current)

      // 第三帧：最终恢复 + 清理状态
      bulkAnimationControls.frameRef.current = window.requestAnimationFrame(() => {
        if (bulkAnimationControls.runIdRef.current !== bulkAnimationControls.runId) return
        restoreBulkAnchor(bulkAnchorRef.current)
        setIsBulkAnimating(false)
        bulkAnchorRef.current = null
        bulkAnimationControls.timerRef.current = null
        bulkAnimationControls.frameRef.current = null
      })
    })
  })
}

// 管理批量展开/折叠时的锚点捕获、虚拟列表测量和动画状态。
export function useBulkExpand<TData>({
  table,
  rows,
  enableExpandAll,
  isAllExpanded,
  disableBulkExpandAnimation,
  bodyScrollRef,
}: UseBulkExpandOptions<TData>) {
  const [isBulkAnimating, setIsBulkAnimating] = useState(false)

  const bulkAnimationTimerRef = useRef<number | null>(null)
  const bulkAnimationFrameRef = useRef<number | null>(null)
  const bulkAnimationRunIdRef = useRef(0)
  const hasMountedExpandAllRef = useRef(false)
  const prevIsAllExpandedRef = useRef<boolean | undefined>(undefined)

  const bulkAnchorRef = useRef<BulkAnchor | null>(null)
  const bulkExpandedSnapshotRef = useRef<Set<string> | null>(null)

  // 存储 virtualizer 引用，由外部设置
  const virtualizerRef = useRef<Virtualizer<HTMLDivElement, Element> | null>(null)

  // 暴露给外部，用于把最新 virtualizer 实例同步进本 hook。
  const setVirtualizer = useCallback((v: Virtualizer<HTMLDivElement, Element>) => {
    virtualizerRef.current = v
  }, [])

  const cancelBulkAnimationFrame = useCallback(() => {
    if (bulkAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(bulkAnimationFrameRef.current)
      bulkAnimationFrameRef.current = null
    }
  }, [])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (bulkAnimationTimerRef.current) {
        window.clearTimeout(bulkAnimationTimerRef.current)
        bulkAnimationTimerRef.current = null
      }
      bulkAnimationRunIdRef.current += 1
      cancelBulkAnimationFrame()
    }
  }, [cancelBulkAnimationFrame])

  // 捕获当前视口顶部附近的锚点行，供批量展开/折叠后恢复滚动位置。
  const captureBulkAnchor = useCallback((): BulkAnchor | null => {
    const el = bodyScrollRef.current
    const virtualizer = virtualizerRef.current
    if (!el || !virtualizer) return null

    const scrollTop = el.scrollTop
    const items = virtualizer.getVirtualItems()
    if (!items.length) return null

    let anchorItem = items.find((item) => scrollTop >= item.start && scrollTop < item.end)
    if (!anchorItem) anchorItem = items[0]

    const row = rows[anchorItem.index]
    if (!row) return null

    return {
      rowId: row.id,
      offsetInRow: Math.max(0, scrollTop - anchorItem.start),
    }
  }, [rows, bodyScrollRef])

  // 根据之前记录的锚点恢复滚动位置，避免批量动画导致用户视野跳变。
  const restoreBulkAnchor = useCallback((anchor: BulkAnchor | null) => {
    if (!anchor) return

    const el = bodyScrollRef.current
    const virtualizer = virtualizerRef.current
    if (!el || !virtualizer) return

    const index = rows.findIndex((row) => row.id === anchor.rowId)
    if (index < 0) return

    let item = virtualizer.getVirtualItems().find((v) => v.index === index)

    if (!item) {
      virtualizer.scrollToIndex(index, { align: 'start' })
      item = virtualizer.getVirtualItems().find((v) => v.index === index)
      if (!item) return
    }

    el.scrollTop = item.start + anchor.offsetInRow
  }, [rows, bodyScrollRef])

  // 批量展开/折叠 effect
  useLayoutEffect(() => {
    if (!enableExpandAll) return

    if (!hasMountedExpandAllRef.current) {
      hasMountedExpandAllRef.current = true
      prevIsAllExpandedRef.current = isAllExpanded
      table.toggleAllRowsExpanded(isAllExpanded)

      requestAnimationFrame(() => {
        virtualizerRef.current?.measure()
      })
      return
    }

    if (prevIsAllExpandedRef.current === isAllExpanded) return
    prevIsAllExpandedRef.current = isAllExpanded
    bulkAnimationRunIdRef.current += 1
    const currentRunId = bulkAnimationRunIdRef.current

    bulkAnchorRef.current = captureBulkAnchor()
    bulkExpandedSnapshotRef.current = new Set(
      rows.filter((row) => row.getIsExpanded()).map((row) => row.id)
    )

    if (disableBulkExpandAnimation) {
      table.toggleAllRowsExpanded(isAllExpanded)
      bulkExpandedSnapshotRef.current = null
      requestAnimationFrame(() => {
        virtualizerRef.current?.measure()
        requestAnimationFrame(() => {
          virtualizerRef.current?.measure()
          restoreBulkAnchor(bulkAnchorRef.current)
          bulkAnchorRef.current = null
        })
      })
      return
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- 动画状态需要同步设置以冻结 virtualizer estimateSize
    setIsBulkAnimating(true)
    table.toggleAllRowsExpanded(isAllExpanded)

    if (bulkAnimationTimerRef.current) {
      window.clearTimeout(bulkAnimationTimerRef.current)
    }
    cancelBulkAnimationFrame()

    bulkAnimationTimerRef.current = window.setTimeout(() => {
      bulkExpandedSnapshotRef.current = null
      scheduleBulkAnimationComplete(
        virtualizerRef,
        bulkAnchorRef,
        {
          timerRef: bulkAnimationTimerRef,
          frameRef: bulkAnimationFrameRef,
          runIdRef: bulkAnimationRunIdRef,
          runId: currentRunId,
        },
        restoreBulkAnchor,
        setIsBulkAnimating,
      )
    }, 180)

    return () => {
      if (bulkAnimationTimerRef.current) {
        window.clearTimeout(bulkAnimationTimerRef.current)
        bulkAnimationTimerRef.current = null
      }
    }
  }, [
    isAllExpanded,
    enableExpandAll,
    disableBulkExpandAnimation,
    table,
    rows,
    captureBulkAnchor,
    cancelBulkAnimationFrame,
    restoreBulkAnchor,
  ])

  return {
    isBulkAnimating,
    bulkExpandedSnapshotRef,
    setVirtualizer,
  }
}
