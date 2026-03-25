/**
 * 表格状态综合 Hook
 * 整合 useFilterList、useTableSettings、useTableExpand 的功能
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useInfiniteQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query'
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import type { SortingState, ColumnSizingState } from '@tanstack/react-table'
import {
  getExpandAllState,
  getFuzzySearchState,
  setExpandAllState,
  setFuzzySearchState,
} from '@/lib/tableExpandStorage'

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
  // 展开状态 localStorage 标识（统一存储到单个 key 的 JSON 中）
  expandStorageKey?: string
  // 默认是否展开全部
  defaultExpanded?: boolean
}

type TableQueryResult = UseInfiniteQueryResult<InfiniteData<ListResponseData>, unknown>

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
  // 重置单行展开占位回调（实际重置由外层表格实例实现）
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
  fetchNextPage: TableQueryResult['fetchNextPage']
  // 刷新数据
  refetch: TableQueryResult['refetch']
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

export const SEARCH_MAX_LENGTH = 100

type FilterStateOptions = {
  defaultStatus: string
  defaultSearchField: string
  initialSearch: string
  initialSearchField?: string
  debounceMs: number
  expandStorageId: string
}

type TableQueryArgs = {
  api: FilterAPI
  queryKey: string[]
  pageSize: number
  extraParams: Record<string, unknown>
  statusFilter: string
  defaultStatus: string
  globalFilter: string
  searchField: string
  fuzzySearch: boolean
  sorting: SortingState
}

type TableQueryState = {
  data: unknown[]
  total: number
  isLoading: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  fetchNextPage: TableQueryResult['fetchNextPage']
  refetch: TableQueryResult['refetch']
  isPlaceholderData: boolean
}

/** 组装列表查询参数，保证筛选规则集中在一个纯函数内。 */
function buildListParams(args: {
  pageParam: number
  pageSize: number
  extraParams: Record<string, unknown>
  statusFilter: string
  defaultStatus: string
  globalFilter: string
  searchField: string
  fuzzySearch: boolean
  sorting: SortingState
}): Record<string, unknown> {
  const {
    pageParam,
    pageSize,
    extraParams,
    statusFilter,
    defaultStatus,
    globalFilter,
    searchField,
    fuzzySearch,
    sorting,
  } = args
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

  const sort = sorting[0]
  if (sort) {
    params.sort_by = sort.id
    params.sort_order = sort.desc ? 'desc' : 'asc'
  }

  return params
}

/** 读取列宽缓存，集中处理浏览器环境与 JSON 解析异常。 */
function readColumnSizingStorage(storageKey: string): ColumnSizingState {
  if (globalThis.window === undefined) return {}
  try {
    const stored = localStorage.getItem(storageKey)
    return stored ? (JSON.parse(stored) as ColumnSizingState) : {}
  } catch {
    return {}
  }
}

/** 管理列宽状态并执行防抖持久化，避免主 Hook 混入存储细节。 */
function useColumnSizingState(
  storageKey: string,
  columnSizingDebounceMs: number
) {
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() =>
    readColumnSizingStorage(storageKey)
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (Object.keys(columnSizing).length > 0) {
          localStorage.setItem(storageKey, JSON.stringify(columnSizing))
        }
      } catch {
        // 忽略 localStorage 错误
      }
    }, columnSizingDebounceMs)

    return () => clearTimeout(timer)
  }, [columnSizing, storageKey, columnSizingDebounceMs])

  /** 兼容对象与函数两种更新器，保证调用方 API 不变。 */
  const handleColumnSizingChange = useCallback(
    (updater: ColumnSizingState | ((prev: ColumnSizingState) => ColumnSizingState)) => {
      setColumnSizing((prev) => (typeof updater === 'function' ? updater(prev) : updater))
    },
    []
  )

  return { columnSizing, handleColumnSizingChange }
}

/** 管理“展开全部”状态并做本地持久化，隔离 UI 存储细节。 */
function useExpandAllState(expandStorageId: string, defaultExpanded: boolean) {
  const [isAllExpanded, setIsAllExpanded] = useState<boolean>(() =>
    getExpandAllState(expandStorageId, defaultExpanded)
  )

  useEffect(() => {
    setExpandAllState(expandStorageId, isAllExpanded)
  }, [isAllExpanded, expandStorageId])

  /** 切换全部展开状态，供表格工具栏复用。 */
  const toggleExpandAll = useCallback(() => {
    setIsAllExpanded((prev) => !prev)
  }, [])

  /** 占位回调：保持返回契约不变，实际行展开重置由外层表格实例执行。 */
  const resetExpanded = useCallback(() => {
    // 这个回调供外部调用，用于重置展开状态
  }, [])

  return { isAllExpanded, toggleExpandAll, resetExpanded }
}

/** 管理筛选、搜索、排序状态，并统一防抖与模糊搜索持久化逻辑。 */
function useFilterState(options: FilterStateOptions) {
  const {
    defaultStatus,
    defaultSearchField,
    initialSearch,
    initialSearchField,
    debounceMs,
    expandStorageId,
  } = options
  const normalizedInitialSearch = initialSearch.trim()
  const normalizedInitialSearchField = initialSearchField ?? defaultSearchField
  const [searchInput, setSearchInput] = useState(normalizedInitialSearch)
  const [globalFilter, setGlobalFilter] = useState(normalizedInitialSearch)
  const [statusFilter, setStatusFilter] = useState(defaultStatus)
  const [searchField, setSearchField] = useState(normalizedInitialSearchField)
  const [fuzzySearch, setFuzzySearch] = useState<boolean>(() =>
    getFuzzySearchState(expandStorageId, false)
  )
  const [sorting, setSorting] = useState<SortingState>([])
  const normalizedSearchInput = searchInput.trim()

  useEffect(() => {
    setFuzzySearchState(expandStorageId, fuzzySearch)
  }, [fuzzySearch, expandStorageId])

  useEffect(() => {
    const timer = setTimeout(() => {
      const shouldSync =
        globalFilter !== normalizedSearchInput &&
        searchInput.length <= SEARCH_MAX_LENGTH
      if (shouldSync) {
        setGlobalFilter(normalizedSearchInput)
      }
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [searchInput, normalizedSearchInput, globalFilter, debounceMs])

  /** 处理搜索输入变化，并在清空时立即同步全局筛选。 */
  const handleSearchInputChange = useCallback(
    (value: string) => {
      setSearchInput(value)
      if (!value.trim() && globalFilter) {
        setGlobalFilter('')
      }
    },
    [globalFilter]
  )

  /** 立即应用搜索值，绕过首次防抖以支持 URL 直达等场景。 */
  const applySearchImmediate = useCallback((value: string, field?: string) => {
    const nextValue = value.trim()
    setSearchInput(nextValue)
    if (nextValue.length <= SEARCH_MAX_LENGTH) {
      setGlobalFilter(nextValue)
    }
    if (field !== undefined) {
      setSearchField(field)
    }
  }, [])

  /** 对外暴露排序更新器，保持兼容 React Table 回调签名。 */
  const handleSortingChange = useCallback(
    (updater: SortingState | ((prev: SortingState) => SortingState)) => {
      setSorting(updater)
    },
    []
  )

  /** 一键重置筛选状态，供页面“清空筛选”按钮复用。 */
  const resetFilters = useCallback(() => {
    setSearchInput('')
    setGlobalFilter('')
    setStatusFilter(defaultStatus)
    setSearchField(defaultSearchField)
    setFuzzySearch(false)
    setSorting([])
  }, [defaultStatus, defaultSearchField])

  const hasFilter = Boolean(
    globalFilter ||
      (statusFilter && statusFilter !== 'all' && statusFilter !== defaultStatus)
  )

  return {
    searchInput,
    handleSearchInputChange,
    applySearchImmediate,
    globalFilter,
    statusFilter,
    setStatusFilter,
    searchField,
    setSearchField,
    fuzzySearch,
    setFuzzySearch,
    sorting,
    handleSortingChange,
    hasFilter,
    resetFilters,
  }
}

/** 计算表头显示数量，在筛选态下按“当前/总量”格式展示。 */
function getDisplayCount(args: {
  hasFilter: boolean
  grandTotal: number | undefined
  total: number
  isPlaceholderData: boolean
}): string {
  const { hasFilter, grandTotal, total, isPlaceholderData } = args
  const shouldShowGrandTotal =
    hasFilter &&
    grandTotal !== undefined &&
    (!isPlaceholderData || total !== grandTotal)
  return shouldShowGrandTotal ? `${total}/${grandTotal}` : `${total}`
}

/** 构建基础查询 key，用于读取“无筛选”缓存总数。 */
function buildBaseQueryKey(
  queryKey: string[],
  defaultStatus: string,
  defaultSearchField: string
): readonly unknown[] {
  return [...queryKey, defaultStatus, '', defaultSearchField, false, []]
}

/** 计算下一页偏移量，供无限查询统一复用。 */
function getNextPageOffset(lastPage: ListResponseData, allPages: ListResponseData[]): number | null {
  const currentLoadedCount = allPages.reduce(
    (acc, page) => acc + page.data.length,
    0
  )
  return currentLoadedCount < (lastPage.total || 0)
    ? currentLoadedCount
    : null
}

/** 组装列表查询与分页状态，隔离 useInfiniteQuery 的细节复杂度。 */
function useTableQueryData(args: TableQueryArgs): TableQueryState {
  const {
    api,
    queryKey,
    pageSize,
    extraParams,
    statusFilter,
    defaultStatus,
    globalFilter,
    searchField,
    fuzzySearch,
    sorting,
  } = args

  const queryFn = useCallback(
    async ({ pageParam = 0 }: { pageParam?: number }) => {
      const params = buildListParams({
        pageParam,
        pageSize,
        extraParams,
        statusFilter,
        defaultStatus,
        globalFilter,
        searchField,
        fuzzySearch,
        sorting,
      })
      const response = await api.list(params)
      return response.data
    },
    [
      api,
      pageSize,
      extraParams,
      statusFilter,
      defaultStatus,
      globalFilter,
      searchField,
      fuzzySearch,
      sorting,
    ]
  )

  const {
    data: allData,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    isPlaceholderData,
  } = useInfiniteQuery({
    queryKey: [
      ...queryKey,
      statusFilter,
      globalFilter,
      searchField,
      fuzzySearch,
      sorting,
    ],
    queryFn,
    initialPageParam: 0,
    getNextPageParam: getNextPageOffset,
    placeholderData: keepPreviousData,
  })

  const data = useMemo(() => allData?.pages.flatMap((page) => page.data) ?? [], [allData])
  const total = allData?.pages[0]?.total ?? 0

  return {
    data,
    total,
    isLoading,
    isFetchingNextPage,
    hasNextPage: Boolean(hasNextPage),
    fetchNextPage,
    refetch,
    isPlaceholderData,
  }
}

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
    debounceMs = 200,
    columnSizingDebounceMs = 500,
    extraParams = {},
    initialSearch = '',
    initialSearchField,
    storageKeyPrefix = 'table-col-sizes',
    expandStorageKey,
    defaultExpanded = false,
  } = options
  const queryClient = useQueryClient()
  const expandStorageId = expandStorageKey || tableId
  const columnSizingStorageKey = `${storageKeyPrefix}-${tableId}`

  const filterState = useFilterState({
    defaultStatus,
    defaultSearchField,
    initialSearch,
    initialSearchField,
    debounceMs,
    expandStorageId,
  })
  const { columnSizing, handleColumnSizingChange } = useColumnSizingState(
    columnSizingStorageKey,
    columnSizingDebounceMs
  )
  const { isAllExpanded, toggleExpandAll, resetExpanded } = useExpandAllState(
    expandStorageId,
    defaultExpanded
  )
  const queryState = useTableQueryData({
    api,
    queryKey,
    pageSize,
    extraParams,
    statusFilter: filterState.statusFilter,
    defaultStatus,
    globalFilter: filterState.globalFilter,
    searchField: filterState.searchField,
    fuzzySearch: filterState.fuzzySearch,
    sorting: filterState.sorting,
  })
  const baseQueryKey = useMemo(
    () => buildBaseQueryKey(queryKey, defaultStatus, defaultSearchField),
    [queryKey, defaultStatus, defaultSearchField]
  )
  const cachedBaseData = queryClient.getQueryData<InfiniteData<ListResponseData>>(baseQueryKey)
  const grandTotal = cachedBaseData?.pages[0]?.total
  const displayCount = getDisplayCount({
    hasFilter: filterState.hasFilter,
    grandTotal,
    total: queryState.total,
    isPlaceholderData: queryState.isPlaceholderData,
  })

  /** 手动使列表缓存失效，便于外部在提交后强制刷新。 */
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  return {
    searchInput: filterState.searchInput,
    setSearchInput: filterState.handleSearchInputChange,
    applySearchImmediate: filterState.applySearchImmediate,
    globalFilter: filterState.globalFilter,
    statusFilter: filterState.statusFilter,
    setStatusFilter: filterState.setStatusFilter,
    searchField: filterState.searchField,
    setSearchField: filterState.setSearchField,
    fuzzySearch: filterState.fuzzySearch,
    setFuzzySearch: filterState.setFuzzySearch,
    sorting: filterState.sorting,
    setSorting: filterState.handleSortingChange,
    hasFilter: filterState.hasFilter,
    displayCount,
    columnSizing,
    setColumnSizing: handleColumnSizingChange,
    isAllExpanded,
    toggleExpandAll,
    resetExpanded,
    data: queryState.data,
    total: queryState.total,
    isLoading: queryState.isLoading,
    isFetchingNextPage: queryState.isFetchingNextPage,
    hasNextPage: queryState.hasNextPage,
    fetchNextPage: queryState.fetchNextPage,
    refetch: queryState.refetch,
    invalidate,
    resetFilters: filterState.resetFilters,
  }
}

export default useTableState
