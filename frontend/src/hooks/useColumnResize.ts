/** 列宽拖拽调整 Hook。 */
import { useRef, useCallback, useEffect, useState } from 'react'
import type { Table as TableType, Header, Column } from '@tanstack/react-table'

interface UseColumnResizeOptions<TData> {
  table: TableType<TData>
  visibleColumns: Column<TData, unknown>[]
  totalWeight: number
  minTableWidth: number
  bodyScrollRef: React.RefObject<HTMLDivElement | null>
}

interface ColumnSizeBounds {
  startLeftSize: number
  startRightSize: number
  leftMin: number
  leftMax: number
  rightMin: number
  rightMax: number
}

// 根据拖拽偏移量计算新的列宽，并应用 min/max 约束
function computeNewSizes(deltaWeight: number, bounds: ColumnSizeBounds): [number, number] {
  const { startLeftSize, startRightSize, leftMin, leftMax, rightMin, rightMax } = bounds

  let newLeft = startLeftSize + deltaWeight
  let newRight = startRightSize - deltaWeight

  if (newLeft < leftMin) {
    newLeft = leftMin
    newRight = startRightSize + (startLeftSize - leftMin)
  }
  if (newRight < rightMin) {
    newRight = rightMin
    newLeft = startLeftSize + (startRightSize - rightMin)
  }
  if (newLeft > leftMax) {
    newLeft = leftMax
    newRight = startRightSize - (leftMax - startLeftSize)
  }
  if (newRight > rightMax) {
    newRight = rightMax
    newLeft = startLeftSize - (rightMax - startRightSize)
  }

  return [newLeft, newRight]
}

// 处理相邻两列的拖拽分配，并保证列宽始终落在合法边界内。
export function useColumnResize<TData>({
  table,
  visibleColumns,
  totalWeight,
  minTableWidth,
  bodyScrollRef,
}: UseColumnResizeOptions<TData>) {
  const [resizingColId, setResizingColId] = useState<string | null>(null)
  const rAFRef = useRef<number | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => {
    cleanupRef.current?.()
    cleanupRef.current = null
  }, [])

  // 接管表头拖拽事件，并把像素偏移换算成左右两列的权重变化。
  const handleCustomResize = useCallback((e: React.MouseEvent | React.TouchEvent, header: Header<TData, unknown>) => {
    e.preventDefault()
    e.stopPropagation()
    cleanupRef.current?.()
    cleanupRef.current = null

    const currentIndex = visibleColumns.findIndex((c) => c.id === header.column.id)
    const leftCol = visibleColumns[currentIndex]
    const rightCol = visibleColumns[currentIndex + 1]

    if (!leftCol || !rightCol) return

    const startX = e.type === 'touchstart'
      ? (e as React.TouchEvent).touches[0].clientX
      : (e as React.MouseEvent).clientX

    const startLeftSize = leftCol.getSize()
    const startRightSize = rightCol.getSize()

    const leftMin = leftCol.columnDef.minSize ?? 50
    const leftMax = leftCol.columnDef.maxSize ?? 9999
    const rightMin = rightCol.columnDef.minSize ?? 50
    const rightMax = rightCol.columnDef.maxSize ?? 9999

    const tablePxWidth = Math.max(bodyScrollRef.current?.clientWidth || 0, minTableWidth)
    const pixelPerWeight = tablePxWidth / totalWeight

    setResizingColId(header.column.id)

    // 依据鼠标/触摸位移实时计算相邻两列的新宽度。
    const applyResize = (moveEvent: MouseEvent | TouchEvent) => {
      const currentX = moveEvent.type === 'touchmove'
        ? (moveEvent as TouchEvent).touches[0].clientX
        : (moveEvent as MouseEvent).clientX

      const deltaX = currentX - startX
      const deltaWeight = deltaX / pixelPerWeight

      const [newLeft, newRight] = computeNewSizes(deltaWeight, {
        startLeftSize, startRightSize, leftMin, leftMax, rightMin, rightMax,
      })

      table.setColumnSizing((old) => ({
        ...old,
        [leftCol.id]: newLeft,
        [rightCol.id]: newRight,
      }))
    }

    // 用 requestAnimationFrame 合并高频移动事件，降低布局抖动。
    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      if (rAFRef.current) cancelAnimationFrame(rAFRef.current)
      rAFRef.current = requestAnimationFrame(() => {
        applyResize(moveEvent)
        rAFRef.current = null
      })
    }

    function cleanupResize() {
      if (rAFRef.current) {
        cancelAnimationFrame(rAFRef.current)
        rAFRef.current = null
      }
      setResizingColId(null)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onUp)
      document.removeEventListener('touchcancel', onUp)
      cleanupRef.current = null
    }

    // 在拖拽结束时移除全局监听并清理当前调整状态。
    function onUp() {
      cleanupResize()
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onUp)
    document.addEventListener('touchcancel', onUp)
    cleanupRef.current = cleanupResize
  }, [visibleColumns, totalWeight, minTableWidth, table, bodyScrollRef])

  return { resizingColId, handleCustomResize }
}
