/* eslint-disable react-refresh/only-export-components -- Hook utility module exports shared table helpers. */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
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
import {
  SEARCH_INPUT_MAX_LENGTH,
  getEffectiveSearchMaxLength,
} from '@/lib/searchLimits'

export interface ListResponseData {
  data: unknown[]
  total: number
}

export interface FilterAPI {
  list: (
    params: Record<string, unknown>,
    options?: { searchIntent?: 'user' | 'background' },
  ) => Promise<{ data: ListResponseData }>
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
  api: FilterAPI
  queryKey?: string[]
  tableId: string
  statusOptions?: FilterOption[]
  searchFieldOptions?: SearchFieldOption[]
  defaultStatus?: string
  defaultSearchField?: string
  pageSize?: number
  debounceMs?: number
  columnSizingDebounceMs?: number
  extraParams?: Record<string, unknown>
  // 外部结果集已经有业务排序时，禁止把表头排序带进请求。
  suppressSorting?: boolean
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
  applySearchImmediate: (value: string, field?: string) => void
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
  setAllExpanded: (value: boolean) => void
  toggleExpandAll: () => void
  resetExpanded: () => void
  data: unknown[]
  total: number
  isLoading: boolean
  isFetching: boolean
  isError: boolean
  error: unknown
  isFetchingNextPage: boolean
  isPlaceholderData: boolean
  hasNextPage: boolean
  fetchNextPage: TableQueryResult['fetchNextPage']
  refetch: TableQueryResult['refetch']
  invalidate: () => void
  resetFilters: () => void
}

export const DEFAULT_STATUS_OPTIONS: FilterOption[] = [
  { value: 'all', label: '全部状态' },
  { value: 'in_stock', label: '在库' },
  { value: 'run_short', label: '快用完' },
  { value: 'not_in_stock', label: '未找到' },
  { value: 'borrowed', label: '借出' },
  { value: 'consumed', label: '已用完' },
]

export const DEFAULT_SEARCH_FIELD_OPTIONS: SearchFieldOption[] = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'cas_number', label: 'CAS号' },
  { value: 'storage_location', label: '位置' },
  { value: 'brand', label: '品牌' },
]

export const SEARCH_MAX_LENGTH = SEARCH_INPUT_MAX_LENGTH

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
  isFetching: boolean
  isError: boolean
  error: unknown
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

function isSameSorting(current: SortingState, next: SortingState): boolean {
  return current.length === next.length && current.every(
    (item, index) => item.id === next[index]?.id && item.desc === next[index]?.desc
  )
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

// 列宽缓存属于偏好设置，读取失败时回退默认布局。
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

  const setAllExpanded = useCallback((value: boolean) => {
    setIsAllExpanded(value)
  }, [])

  const resetExpanded = useCallback(() => {
    // 返回契约包含 resetExpanded；单行展开重置由外层表格实例处理。
  }, [])

  return { isAllExpanded, setAllExpanded, toggleExpandAll, resetExpanded }
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
  const sortingRef = useRef<SortingState>([])
  const normalizedSearchInput = searchInput.trim()
  const pendingUserSearchRef = useRef(false)

  const setFuzzySearch = useCallback(
    (value: boolean) => {
      const nextValue = enableFuzzySearch ? value : false
      if (nextValue !== fuzzySearch) pendingUserSearchRef.current = true
      setStoredFuzzySearch(nextValue)
    },
    [enableFuzzySearch, fuzzySearch]
  )

  useEffect(() => {
    if (enableFuzzySearch) {
      setFuzzySearchState(expandStorageId, storedFuzzySearch)
    }
  }, [enableFuzzySearch, storedFuzzySearch, expandStorageId])

  useEffect(() => {
    setSearchMatchModeState(expandStorageId, matchMode)
  }, [expandStorageId, matchMode])

  const setMatchMode = useCallback(
    (value: SearchMatchMode) => {
      if (value !== matchMode) pendingUserSearchRef.current = true
      setMatchModeState(value)
    },
    [matchMode]
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      const searchMaxLength = getEffectiveSearchMaxLength(searchInput, searchField)
      const shouldSync =
        globalFilter !== normalizedSearchInput &&
        searchInput.length <= searchMaxLength
      if (shouldSync) {
        pendingUserSearchRef.current = true
        setGlobalFilter(normalizedSearchInput)
      }
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [searchInput, normalizedSearchInput, globalFilter, searchField, debounceMs])

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
    const nextField = field ?? searchField
    setSearchInput(nextValue)
    if (nextValue.length <= getEffectiveSearchMaxLength(nextValue, nextField)) {
      const valueChanged = globalFilter !== nextValue
      const fieldChanged = field !== undefined && field !== searchField
      if (valueChanged || fieldChanged) {
        pendingUserSearchRef.current = true
      }
      setGlobalFilter(nextValue)
    }
    if (field !== undefined) {
      setSearchField(field)
    }
  }, [globalFilter, searchField])

  // 对外暴露排序更新器，保持兼容 React Table 回调签名。
  const handleSortingChange = useCallback(
    (updater: SortingState | ((prev: SortingState) => SortingState)) => {
      const current = sortingRef.current
      const next = typeof updater === 'function' ? updater(current) : updater
      if (isSameSorting(current, next)) return

      pendingUserSearchRef.current = true
      sortingRef.current = next
      setSorting(next)
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
    handleSortingChange([])
  }, [defaultStatus, defaultSearchField, setFuzzySearch, setMatchMode, handleSortingChange])

  const handleStatusFilterChange = useCallback(
    (value: string) => {
      if (value !== statusFilter) pendingUserSearchRef.current = true
      setStatusFilter(value)
    },
    [statusFilter]
  )

  const handleSearchFieldChange = useCallback(
    (value: string) => {
      if (value !== searchField) pendingUserSearchRef.current = true
      setSearchField(value)
    },
    [searchField]
  )

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
    setStatusFilter: handleStatusFilterChange,
    searchField,
    setSearchField: handleSearchFieldChange,
    fuzzySearch,
    setFuzzySearch,
    matchMode,
    setMatchMode,
    sorting,
    handleSortingChange,
    hasFilter,
    resetFilters,
    pendingUserSearchRef,
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

// 缓存 key 顺序和列表查询保持一致，确保命中同一组缓存。
function buildTableQueryKey(
  queryKey: string[],
  extraParams: Record<string, unknown>,
  filters: TableQueryFilters
): readonly unknown[] {
  const { statusFilter, globalFilter, searchField, fuzzySearch, matchMode, sorting } = filters
  return [
    ...queryKey,
    extraParams,
    statusFilter,
    globalFilter,
    searchField,
    fuzzySearch,
    matchMode,
    sorting,
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
  pendingUserSearchRef: RefObject<boolean>
}): TableQueryState {
  const {
    api,
    queryKey,
    pageSize,
    extraParams,
    defaultStatus,
    filters,
    pendingUserSearchRef,
  } = args

  const queryFn = useCallback(
    async ({ pageParam = 0 }: { pageParam?: number }) => {
      const params = buildListParams({
        pageParam,
        pageSize,
        extraParams,
        defaultStatus,
        filters,
      })
      const isUserSearch = pageParam === 0 && pendingUserSearchRef.current
      if (isUserSearch) {
        pendingUserSearchRef.current = false
      }
      const response = await api.list(params, {
        searchIntent: isUserSearch ? 'user' : 'background',
      })
      return response.data
    },
    [
      api,
      pageSize,
      extraParams,
      defaultStatus,
      filters,
      pendingUserSearchRef,
    ]
  )

  const {
    data: allData,
    isLoading,
    isFetching,
    isFetchingNextPage,
    isError,
    error,
    hasNextPage,
    fetchNextPage,
    refetch,
    isPlaceholderData,
  } = useInfiniteQuery({
    queryKey: buildTableQueryKey(queryKey, extraParams, filters),
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
    isFetching,
    isError,
    error,
    isFetchingNextPage,
    isPlaceholderData,
    hasNextPage: Boolean(hasNextPage),
    fetchNextPage,
    refetch,
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
    suppressSorting = false,
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
  const { isAllExpanded, setAllExpanded, toggleExpandAll, resetExpanded } = useExpandAllState(
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
      sorting: suppressSorting ? [] : filterState.sorting,
    }),
    [
      filterState.statusFilter,
      filterState.globalFilter,
      filterState.searchField,
      filterState.fuzzySearch,
      filterState.matchMode,
      filterState.sorting,
      suppressSorting,
    ]
  )
  const queryState = useTableQueryData({
    api,
    queryKey,
    pageSize,
    extraParams,
    defaultStatus,
    filters: queryFilters,
    pendingUserSearchRef: filterState.pendingUserSearchRef,
  })
  const baseQueryKey = useMemo(
    () =>
      buildTableQueryKey(queryKey, extraParams, {
        statusFilter: defaultStatus,
        globalFilter: '',
        searchField: defaultSearchField,
        fuzzySearch: false,
        matchMode: DEFAULT_SEARCH_MATCH_MODE,
        sorting: [],
      }),
    [queryKey, extraParams, defaultStatus, defaultSearchField]
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
    setAllExpanded,
    toggleExpandAll,
    resetExpanded,
    data: queryState.data,
    total: queryState.total,
    isLoading: queryState.isLoading,
    isFetching: queryState.isFetching,
    isError: queryState.isError,
    error: queryState.error,
    isFetchingNextPage: queryState.isFetchingNextPage,
    isPlaceholderData: queryState.isPlaceholderData,
    hasNextPage: queryState.hasNextPage,
    fetchNextPage: queryState.fetchNextPage,
    refetch: queryState.refetch,
    invalidate,
    resetFilters: filterState.resetFilters,
  }
}

export default useTableState
