import { useState, useEffect, useCallback, useMemo } from 'react'
import { useInfiniteQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query'
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import type { SortingState, ColumnSizingState } from '@tanstack/react-table'
import {
  getExpandAllState,
  getFuzzySearchState,
  getSearchMatchModeState,
  setExpandAllState,
  setFuzzySearchState,
  setSearchMatchModeState,
  getTableColumnSizing,
  setTableColumnSizing,
} from '@/lib/storage/appTableStorage'
import {
  DEFAULT_SEARCH_MATCH_MODE,
  type SearchMatchMode,
} from '@/lib/searchMatchMode'

export interface ListResponseData {
  data: unknown[]
  total: number
}

export interface FilterAPI {
  list: (params: Record<string, unknown>) => Promise<{ data: ListResponseData }>
}

export interface FilterOption {
  value: string
  label: string
}

export interface SearchFieldOption {
  value: string
  label: string
}

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
  // 历史兼容参数（新实现已统一写入 app-table.columnSizing）
  storageKeyPrefix?: string
  // 展开状态 localStorage 标识（统一存储到单个 key 的 JSON 中）
  expandStorageKey?: string
  // 默认是否展开全部
  defaultExpanded?: boolean
  // 是否允许模糊搜索；禁用时即使本地存储有旧状态也不会带到请求中。
  enableFuzzySearch?: boolean
}

type TableQueryResult = UseInfiniteQueryResult<InfiniteData<ListResponseData>, unknown>

export interface UseTableStateReturn {
  searchInput: string
  setSearchInput: (value: string) => void
  // 立即应用搜索（同步更新输入框和查询条件）
  applySearchImmediate: (value: string, field?: string) => void
  // 防抖后的搜索关键词
  globalFilter: string
  statusFilter: string
  setStatusFilter: (value: string) => void
  searchField: string
  setSearchField: (value: string) => void
  fuzzySearch: boolean
  setFuzzySearch: (value: boolean) => void
  matchMode: SearchMatchMode
  setMatchMode: (value: SearchMatchMode) => void
  sorting: SortingState
  setSorting: (sorting: SortingState | ((prev: SortingState) => SortingState)) => void
  hasFilter: boolean
  displayCount: string
  columnSizing: ColumnSizingState
  setColumnSizing: (updater: ColumnSizingState | ((prev: ColumnSizingState) => ColumnSizingState)) => void
  isAllExpanded: boolean
  toggleExpandAll: () => void
  resetExpanded: () => void
  data: unknown[]
  total: number
  // 加载状态
  isLoading: boolean
  // 加载更多状态
  isFetchingNextPage: boolean
  // 是否还有更多数据
  hasNextPage: boolean
  // 加载更多数据
  fetchNextPage: TableQueryResult['fetchNextPage']
  refetch: TableQueryResult['refetch']
  // 手动使缓存失效
  invalidate: () => void
  // 重置筛选状态
  resetFilters: () => void
}

export const DEFAULT_STATUS_OPTIONS: FilterOption[] = [
  { value: 'all', label: '全部状态' },
  { value: 'in_stock', label: '在库' },
  { value: 'not_in_stock', label: '没有' },
  { value: 'borrowed', label: '借出' },
  { value: 'consumed', label: '已用完' },
]

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
  enableFuzzySearch: boolean
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

type TableQueryFilters = {
  statusFilter: string
  globalFilter: string
  searchField: string
  fuzzySearch: boolean
  matchMode: SearchMatchMode
  sorting: SortingState
}

// 默认状态和 `all` 都不进请求参数，尽量让“无筛选”请求保持稳定形态。
function buildListParams(args: {
  pageParam: number
  pageSize: number
  extraParams: Record<string, unknown>
  defaultStatus: string
  filters: TableQueryFilters
}): Record<string, unknown> {
  const {
    pageParam,
    pageSize,
    extraParams,
    defaultStatus,
    filters,
  } = args
  const { statusFilter, globalFilter, searchField, fuzzySearch, matchMode, sorting } = filters
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
    params.match_mode = matchMode
  }

  const sort = sorting[0]
  if (sort) {
    params.sort_by = sort.id
    params.sort_order = sort.desc ? 'desc' : 'asc'
  }

  return params
}

// 列宽缓存只是一层偏好设置；读失败时回退默认布局，别让表格因此不可用。
function readColumnSizingStorage(tableId: string): ColumnSizingState {
  if (globalThis.window === undefined) return {}
  try {
    return getTableColumnSizing(tableId) as ColumnSizingState
  } catch {
    return {}
  }
}

// 管理列宽状态并执行防抖持久化，避免主 Hook 混入存储细节。
function useColumnSizingState(
  tableId: string,
  columnSizingDebounceMs: number
) {
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() =>
    readColumnSizingStorage(tableId)
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (Object.keys(columnSizing).length > 0) {
          setTableColumnSizing(tableId, columnSizing as Record<string, number>)
        }
      } catch {
        // 列宽偏好不值得阻塞表格交互，存储失败时直接退回内存态。
      }
    }, columnSizingDebounceMs)

    return () => clearTimeout(timer)
  }, [columnSizing, tableId, columnSizingDebounceMs])

  // 兼容对象与函数两种更新器，保证调用方 API 不变。
  const handleColumnSizingChange = useCallback(
    (updater: ColumnSizingState | ((prev: ColumnSizingState) => ColumnSizingState)) => {
      setColumnSizing((prev) => (typeof updater === 'function' ? updater(prev) : updater))
    },
    []
  )

  return { columnSizing, handleColumnSizingChange }
}

// 管理“展开全部”状态并做本地持久化，隔离 UI 存储细节。
function useExpandAllState(expandStorageId: string, defaultExpanded: boolean) {
  const [isAllExpanded, setIsAllExpanded] = useState<boolean>(() =>
    getExpandAllState(expandStorageId, defaultExpanded)
  )

  useEffect(() => {
    setExpandAllState(expandStorageId, isAllExpanded)
  }, [isAllExpanded, expandStorageId])

  // 切换全部展开状态，供表格工具栏复用。
  const toggleExpandAll = useCallback(() => {
    setIsAllExpanded((prev) => !prev)
  }, [])

  const resetExpanded = useCallback(() => {
    // 这里故意保留空实现，只是维持返回契约；真正的单行展开重置仍由外层表格实例处理。
  }, [])

  return { isAllExpanded, toggleExpandAll, resetExpanded }
}

// 管理筛选、搜索、排序状态，并统一防抖与模糊搜索持久化逻辑。
function useFilterState(options: FilterStateOptions) {
  const {
    defaultStatus,
    defaultSearchField,
    initialSearch,
    initialSearchField,
    debounceMs,
    expandStorageId,
    enableFuzzySearch,
  } = options
  const normalizedInitialSearch = initialSearch.trim()
  const normalizedInitialSearchField = initialSearchField ?? defaultSearchField
  const [searchInput, setSearchInput] = useState(normalizedInitialSearch)
  const [globalFilter, setGlobalFilter] = useState(normalizedInitialSearch)
  const [statusFilter, setStatusFilter] = useState(defaultStatus)
  const [searchField, setSearchField] = useState(normalizedInitialSearchField)
  const [storedFuzzySearch, setStoredFuzzySearch] = useState<boolean>(() =>
    enableFuzzySearch ? getFuzzySearchState(expandStorageId, false) : false
  )
  const fuzzySearch = enableFuzzySearch ? storedFuzzySearch : false
  const [matchMode, setMatchModeState] = useState<SearchMatchMode>(() =>
    getSearchMatchModeState(expandStorageId, DEFAULT_SEARCH_MATCH_MODE)
  )
  const [sorting, setSorting] = useState<SortingState>([])
  const normalizedSearchInput = searchInput.trim()

  const setFuzzySearch = useCallback(
    (value: boolean) => {
      setStoredFuzzySearch(enableFuzzySearch ? value : false)
    },
    [enableFuzzySearch]
  )

  useEffect(() => {
    if (enableFuzzySearch) {
      setFuzzySearchState(expandStorageId, storedFuzzySearch)
    }
  }, [enableFuzzySearch, storedFuzzySearch, expandStorageId])

  useEffect(() => {
    setSearchMatchModeState(expandStorageId, matchMode)
  }, [expandStorageId, matchMode])

  const setMatchMode = useCallback((value: SearchMatchMode) => {
    setMatchModeState(value)
  }, [])

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

  // 处理搜索输入变化，并在清空时立即同步全局筛选。
  const handleSearchInputChange = useCallback(
    (value: string) => {
      setSearchInput(value)
      if (!value.trim() && globalFilter) {
        setGlobalFilter('')
      }
    },
    [globalFilter]
  )

  // URL 直达和地址栏回流都要立刻生效，不能再额外等一轮输入防抖。
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

  // 对外暴露排序更新器，保持兼容 React Table 回调签名。
  const handleSortingChange = useCallback(
    (updater: SortingState | ((prev: SortingState) => SortingState)) => {
      setSorting(updater)
    },
    []
  )

  // 一键重置筛选状态，供页面“清空筛选”按钮复用。
  const resetFilters = useCallback(() => {
    setSearchInput('')
    setGlobalFilter('')
    setStatusFilter(defaultStatus)
    setSearchField(defaultSearchField)
    setFuzzySearch(false)
    setMatchMode(DEFAULT_SEARCH_MATCH_MODE)
    setSorting([])
  }, [defaultStatus, defaultSearchField, setFuzzySearch, setMatchMode])

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
    matchMode,
    setMatchMode,
    sorting,
    handleSortingChange,
    hasFilter,
    resetFilters,
  }
}

// 计算表头显示数量，在筛选态下按“当前/总量”格式展示。
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

// 这个 key 顺序必须和 useInfiniteQuery 的无筛选场景完全一致，否则会读不到总数缓存。
function buildBaseQueryKey(
  queryKey: string[],
  defaultStatus: string,
  defaultSearchField: string
): readonly unknown[] {
  return [
    ...queryKey,
    defaultStatus,
    '',
    defaultSearchField,
    false,
    DEFAULT_SEARCH_MATCH_MODE,
    [],
  ]
}

// 计算下一页偏移量，供无限查询统一复用。
function getNextPageOffset(lastPage: ListResponseData, allPages: ListResponseData[]): number | null {
  const currentLoadedCount = allPages.reduce(
    (acc, page) => acc + page.data.length,
    0
  )
  return currentLoadedCount < (lastPage.total || 0)
    ? currentLoadedCount
    : null
}

function useTableQueryData(args: {
  api: FilterAPI
  queryKey: string[]
  pageSize: number
  extraParams: Record<string, unknown>
  defaultStatus: string
  filters: TableQueryFilters
}): TableQueryState {
  const {
    api,
    queryKey,
    pageSize,
    extraParams,
    defaultStatus,
    filters,
  } = args
  const { statusFilter, globalFilter, searchField, fuzzySearch, matchMode, sorting } = filters

  const queryFn = useCallback(
    async ({ pageParam = 0 }: { pageParam?: number }) => {
      const params = buildListParams({
        pageParam,
        pageSize,
        extraParams,
        defaultStatus,
        filters,
      })
      const response = await api.list(params)
      return response.data
    },
    [
      api,
      pageSize,
      extraParams,
      defaultStatus,
      filters,
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
      matchMode,
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
    expandStorageKey,
    defaultExpanded = false,
    enableFuzzySearch = true,
  } = options
  const queryClient = useQueryClient()
  const expandStorageId = expandStorageKey || tableId

  const filterState = useFilterState({
    defaultStatus,
    defaultSearchField,
    initialSearch,
    initialSearchField,
    debounceMs,
    expandStorageId,
    enableFuzzySearch,
  })
  const { columnSizing, handleColumnSizingChange } = useColumnSizingState(
    tableId,
    columnSizingDebounceMs
  )
  const { isAllExpanded, toggleExpandAll, resetExpanded } = useExpandAllState(
    expandStorageId,
    defaultExpanded
  )
  // 先把筛选条件固化成稳定快照，再交给 queryFn 和 queryKey 共享，避免两边各自拼一套依赖。
  const queryFilters = useMemo<TableQueryFilters>(
    () => ({
      statusFilter: filterState.statusFilter,
      globalFilter: filterState.globalFilter,
      searchField: filterState.searchField,
      fuzzySearch: filterState.fuzzySearch,
      matchMode: filterState.matchMode,
      sorting: filterState.sorting,
    }),
    [
      filterState.statusFilter,
      filterState.globalFilter,
      filterState.searchField,
      filterState.fuzzySearch,
      filterState.matchMode,
      filterState.sorting,
    ]
  )
  const queryState = useTableQueryData({
    api,
    queryKey,
    pageSize,
    extraParams,
    defaultStatus,
    filters: queryFilters,
  })
  const baseQueryKey = useMemo(
    () => buildBaseQueryKey(queryKey, defaultStatus, defaultSearchField),
    [queryKey, defaultStatus, defaultSearchField]
  )
  // 表头在筛选态下还要显示总量，所以这里读取“无筛选”缓存的第一页总数，不额外发请求。
  const cachedBaseData = queryClient.getQueryData<InfiniteData<ListResponseData>>(baseQueryKey)
  const grandTotal = cachedBaseData?.pages[0]?.total
  const displayCount = getDisplayCount({
    hasFilter: filterState.hasFilter,
    grandTotal,
    total: queryState.total,
    isPlaceholderData: queryState.isPlaceholderData,
  })

  // 提交完成后统一打失效，让列表和依赖它的统计卡片一起回到最新快照。
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
    matchMode: filterState.matchMode,
    setMatchMode: filterState.setMatchMode,
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
