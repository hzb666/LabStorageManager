/**
 * 表格状态综合 Hook
 * 整合 useFilterList、useTableSettings、useTableExpand 的功能
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useInfiniteQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import type { SortingState, ColumnSizingState } from '@tanstack/react-table'

// API 响应数据类型
export interface ListResponseData {
  data: unknown[]
  total: number
}

// API 客户端类型
export interface FilterAPI {
  list: (params: Record<string, unknown>) => Promise<{ data: ListResponseData }>
}

// 筛选选项配置
export interface FilterOption {
  value: string
  label: string
}

// 搜索字段选项
export interface SearchFieldOption {
  value: string
  label: string
}

// Hook 配置参数
export interface UseTableStateOptions {
  // API 客户端（必传）
  api: FilterAPI
  // 查询 Key 前缀
  queryKey?: string[]
  // 表格唯一标识（用于 localStorage）
  tableId: string
  // 状态筛选选项
  statusOptions?: FilterOption[]
  // 搜索字段选项
  searchFieldOptions?: SearchFieldOption[]
  // 默认状态筛选值
  defaultStatus?: string
  // 默认搜索字段值
  defaultSearchField?: string
  // 每页数据条数
  pageSize?: number
  // 搜索防抖时间（毫秒）
  debounceMs?: number
  // 列宽缓存防抖时间（毫秒）
  columnSizingDebounceMs?: number
  // 额外的查询参数
  extraParams?: Record<string, unknown>
  // 初始化搜索关键词（用于 URL 直达，绕过首次防抖）
  initialSearch?: string
  // 初始化搜索字段
  initialSearchField?: string
  // localStorage 键名前缀
  storageKeyPrefix?: string
  // 展开状态 localStorage 键名
  expandStorageKey?: string
  // 默认是否展开全部
  defaultExpanded?: boolean
}

// Hook 返回值
export interface UseTableStateReturn {
  // ========== 筛选状态 ==========
  // 搜索输入（未防抖）
  searchInput: string
  setSearchInput: (value: string) => void
  // 立即应用搜索（同步更新输入框和查询条件）
  applySearchImmediate: (value: string, field?: string) => void
  // 防抖后的搜索关键词
  globalFilter: string
  // 状态筛选值
  statusFilter: string
  setStatusFilter: (value: string) => void
  // 搜索字段值
  searchField: string
  setSearchField: (value: string) => void
  // 是否模糊搜索
  fuzzySearch: boolean
  setFuzzySearch: (value: boolean) => void
  // 排序状态
  sorting: SortingState
  setSorting: (sorting: SortingState | ((prev: SortingState) => SortingState)) => void
  // 是否有筛选条件
  hasFilter: boolean
  // 显示的数量
  displayCount: string

  // ========== 表格状态 ==========
  // 列宽状态
  columnSizing: ColumnSizingState
  setColumnSizing: (updater: ColumnSizingState | ((prev: ColumnSizingState) => ColumnSizingState)) => void
  // 是否全部展开
  isAllExpanded: boolean
  // 切换全部展开状态
  toggleExpandAll: () => void
  // 重置单行展开但保持全部展开状态
  resetExpanded: () => void

  // ========== 数据 ==========
  // 数据
  data: unknown[]
  // 总数
  total: number
  // 加载状态
  isLoading: boolean
  // 加载更多状态
  isFetchingNextPage: boolean
  // 是否还有更多数据
  hasNextPage: boolean
  // 加载更多数据
  fetchNextPage: () => void
  // 刷新数据
  refetch: () => void
  // 手动使缓存失效
  invalidate: () => void
  // 重置筛选状态
  resetFilters: () => void
}

// 默认状态选项
export const DEFAULT_STATUS_OPTIONS: FilterOption[] = [
  { value: 'all', label: '全部状态' },
  { value: 'in_stock', label: '在库' },
  { value: 'not_in_stock', label: '没有' },
  { value: 'borrowed', label: '借出' },
  { value: 'consumed', label: '已用完' },
]

// 默认搜索字段选项
export const DEFAULT_SEARCH_FIELD_OPTIONS: SearchFieldOption[] = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'cas_number', label: 'CAS号' },
  { value: 'storage_location', label: '位置' },
  { value: 'brand', label: '品牌' },
  { value: 'category', label: '分类' },
]

/**
 * 表格状态综合 Hook
 * 整合筛选、排序、分页、列宽持久化、展开状态管理
 */
export function useTableState(options: UseTableStateOptions): UseTableStateReturn {
  const {
    api,
    queryKey = ['list'],
    tableId,
    defaultStatus = 'all',
    defaultSearchField = 'all',
    pageSize = 50,
    debounceMs = 300,
    columnSizingDebounceMs = 500,
    extraParams = {},
    initialSearch = '',
    initialSearchField,
    storageKeyPrefix = 'table-col-sizes',
    expandStorageKey,
    defaultExpanded = false,
  } = options

  const queryClient = useQueryClient()
  const sortingRef = useRef<SortingState>([])

  // ========== 筛选状态 ==========
  const normalizedInitialSearch = initialSearch.trim()
  const normalizedInitialSearchField = initialSearchField ?? defaultSearchField

  const [searchInput, setSearchInputState] = useState(normalizedInitialSearch)
  const [globalFilter, setGlobalFilter] = useState(normalizedInitialSearch)
  const [statusFilter, setStatusFilter] = useState(defaultStatus)
  const [searchField, setSearchField] = useState(normalizedInitialSearchField)
  const [fuzzySearch, setFuzzySearch] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])

  const setSearchInput = useCallback((value: string) => {
    setSearchInputState(value)
  }, [])

  const applySearchImmediate = useCallback((value: string, field?: string) => {
    const nextValue = value.trim()
    setSearchInputState(nextValue)
    setGlobalFilter(nextValue)
    if (field !== undefined) {
      setSearchField(field)
    }
  }, [])

  // ========== 列宽状态 ==========
  const columnSizingStorageKey = `${storageKeyPrefix}-${tableId}`
  const [columnSizing, setColumnSizingState] = useState<ColumnSizingState>(() => {
    if (typeof globalThis.window === 'undefined') return {}
    try {
      const stored = localStorage.getItem(columnSizingStorageKey)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch {
      // 忽略 localStorage 错误
    }
    return {}
  })

  // 列宽防抖保存
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (Object.keys(columnSizing).length > 0) {
          localStorage.setItem(columnSizingStorageKey, JSON.stringify(columnSizing))
        }
      } catch {
        // 忽略 localStorage 错误
      }
    }, columnSizingDebounceMs)

    return () => clearTimeout(timer)
  }, [columnSizing, columnSizingStorageKey, columnSizingDebounceMs])

  // 设置列宽
  const setColumnSizing = useCallback(
    (updater: ColumnSizingState | ((prev: ColumnSizingState) => ColumnSizingState)) => {
      setColumnSizingState(prev => {
        const newSizing = typeof updater === 'function' ? updater(prev) : updater
        return newSizing
      })
    },
    []
  )

  // ========== 展开状态 ==========
  const expandKey = expandStorageKey || `${tableId}-expand-all`
  const [isAllExpanded, setIsAllExpanded] = useState<boolean>(() => {
    if (typeof globalThis.window === 'undefined') return defaultExpanded
    try {
      const stored = localStorage.getItem(expandKey)
      if (stored !== null) {
        return stored === 'expanded' || stored === 'true'
      }
    } catch {
      // 忽略 localStorage 错误
    }
    return defaultExpanded
  })

  // 展开状态持久化
  useEffect(() => {
    try {
      localStorage.setItem(expandKey, isAllExpanded ? 'expanded' : 'collapsed')
    } catch {
      // 忽略 localStorage 错误
    }
  }, [isAllExpanded, expandKey])

  // 切换展开全部
  const toggleExpandAll = useCallback(() => {
    setIsAllExpanded(prev => !prev)
  }, [])

  // 重置单行展开但保持全部展开状态
  // 注意：这个方法需要由外部表格实例调用
  // 实际的重置逻辑在 FilterTable 或页面中处理
  const resetExpanded = useCallback(() => {
    // 这个回调供外部调用，用于重置展开状态
  }, [isAllExpanded])

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => {
      if (globalFilter !== searchInput) {
        setGlobalFilter(searchInput)
      }
    }, debounceMs)
    return () => clearTimeout(timer)
  }, [searchInput, globalFilter, debounceMs])

  // 数据查询函数
  const queryFn = useCallback(async ({ pageParam = 0 }: { pageParam?: number }) => {
    const currentSorting = sorting.length > 0 ? sorting : sortingRef.current
    const sort = currentSorting[0]

    const params: Record<string, unknown> = {
      skip: pageParam,
      limit: pageSize,
      ...extraParams,
    }

    if (statusFilter !== 'all' && statusFilter !== defaultStatus) {
      params.status_filter = statusFilter
    }
    if (globalFilter) {
      params.search = globalFilter
      if (searchField !== 'all') params.search_field = searchField
      if (fuzzySearch) params.fuzzy = true
    }
    if (sort) {
      params.sort_by = sort.id
      params.sort_order = sort.desc ? 'desc' : 'asc'
    }

    const response = await api.list(params)
    return response.data
  }, [api, statusFilter, globalFilter, searchField, fuzzySearch, sorting, pageSize, extraParams, defaultStatus])

  // 无限查询
  const {
    data: allData,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: [...queryKey, statusFilter, globalFilter, searchField, fuzzySearch, sorting],
    queryFn,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const currentLoadedCount = allPages.reduce((acc, page) => acc + page.data.length, 0)
      if (currentLoadedCount < (lastPage.total || 0)) return currentLoadedCount
      return null
    },
    placeholderData: keepPreviousData,
  })

  // 处理排序变化
  const handleSortingChange = useCallback((updater: SortingState | ((prev: SortingState) => SortingState)) => {
    setSorting(prev => {
      const newSorting = typeof updater === 'function' ? updater(prev) : updater
      sortingRef.current = newSorting
      return newSorting
    })
  }, [])

  // 展平数据
  const data = useMemo(() => allData?.pages.flatMap(page => page.data) ?? [], [allData])
  // 总数
  const total = allData?.pages[0]?.total ?? 0
  // 是否有筛选条件
  const hasFilter = Boolean(globalFilter || (statusFilter && statusFilter !== 'all' && statusFilter !== defaultStatus))
  const baseQueryKey: readonly unknown[] = useMemo(
    () => [...queryKey, defaultStatus, '', defaultSearchField, false, []],
    [queryKey, defaultSearchField, defaultStatus]
  )
  // 避免把可推导总数镜像到本地 state，直接读取基础查询缓存即可绕开 effect 中同步 setState。
  const cachedBaseData = queryClient.getQueryData<InfiniteData<ListResponseData>>(baseQueryKey)
  const grandTotal = cachedBaseData?.pages[0]?.total ?? total

  // 显示的数量
  const displayCount = hasFilter ? `${total}/${grandTotal}` : `${total}`

  // 重置筛选状态
  const resetFilters = useCallback(() => {
    setSearchInput('')
    setGlobalFilter('')
    setStatusFilter(defaultStatus)
    setSearchField(defaultSearchField)
    setFuzzySearch(false)
    setSorting([])
  }, [defaultStatus, defaultSearchField])

  // 手动使缓存失效
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  return {
    // 筛选状态
    searchInput,
    setSearchInput,
    applySearchImmediate,
    globalFilter,
    statusFilter,
    setStatusFilter,
    searchField,
    setSearchField,
    fuzzySearch,
    setFuzzySearch,
    sorting,
    setSorting: handleSortingChange,
    hasFilter,
    displayCount,

    // 表格状态
    columnSizing,
    setColumnSizing,
    isAllExpanded,
    toggleExpandAll,
    resetExpanded,

    // 数据
    data,
    total,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    invalidate,
    resetFilters,
  }
}

export default useTableState
