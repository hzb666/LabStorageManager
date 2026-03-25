import { useEffect, useMemo, useState } from 'react'
import type {
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
} from '@tanstack/react-table'

type SearchRecord = Record<string, unknown>

type ColumnFilterConfig =
  | {
      columnId: string
      searchKey: string
      type: 'string'
      // Optional transformers for custom types
      serialize?: (value: unknown) => unknown
      deserialize?: (value: unknown) => unknown
    }
  | {
      columnId: string
      searchKey: string
      type: 'array'
      serialize?: (value: unknown) => unknown
      deserialize?: (value: unknown) => unknown
    }

export type NavigateFn = (opts: {
  search:
    | true
    | SearchRecord
    | ((prev: SearchRecord) => Partial<SearchRecord> | SearchRecord)
  replace?: boolean
}) => void

type UseTableUrlStateParams = {
  search: SearchRecord
  navigate: NavigateFn
  pagination?: {
    pageKey?: string
    pageSizeKey?: string
    defaultPage?: number
    defaultPageSize?: number
  }
  globalFilter?: {
    enabled?: boolean
    key?: string
    trim?: boolean
  }
  columnFilters?: ColumnFilterConfig[]
}

type UseTableUrlStateReturn = {
  // Global filter
  globalFilter?: string
  onGlobalFilterChange?: OnChangeFn<string>
  // Column filters
  columnFilters: ColumnFiltersState
  onColumnFiltersChange: OnChangeFn<ColumnFiltersState>
  // Pagination
  pagination: PaginationState
  onPaginationChange: OnChangeFn<PaginationState>
  // Helpers
  ensurePageInRange: (
    pageCount: number,
    opts?: { resetTo?: 'first' | 'last' }
  ) => void
}

// 提供默认的序列化/反序列化透传逻辑，避免各处重复声明恒等函数。
const identity = <T,>(value: T) => value

/** 归一化分页配置，统一提供 page/pageSize 键名和默认值。 */
function resolvePaginationConfig(cfg: UseTableUrlStateParams['pagination']) {
  return {
    pageKey: cfg?.pageKey ?? ('page' as string),
    pageSizeKey: cfg?.pageSizeKey ?? ('pageSize' as string),
    defaultPage: cfg?.defaultPage ?? 1,
    defaultPageSize: cfg?.defaultPageSize ?? 10,
  }
}

/** 归一化全局搜索配置，统一启用开关、URL key 与 trim 策略。 */
function resolveGlobalFilterConfig(cfg: UseTableUrlStateParams['globalFilter']) {
  return {
    globalFilterKey: cfg?.key ?? ('filter' as string),
    globalFilterEnabled: cfg?.enabled ?? true,
    trimGlobal: cfg?.trim ?? true,
  }
}

// 统一读取 search 对象中的字段值，减少索引访问散落在各处。
const getSearchValue = (search: SearchRecord, key: string) => search[key]

// 合并 URL search patch，同时保留原有 search 中未覆盖的字段。
const mergeSearchPatch = (prev: SearchRecord, patch: SearchRecord) => ({
  ...(prev as Record<string, unknown>),
  ...patch,
})

// 根据当前 URL search 构造表格列筛选初始值，保持与配置定义的字段类型一致。
const buildInitialColumnFilters = (
  search: SearchRecord,
  columnFiltersCfg: ColumnFilterConfig[]
): ColumnFiltersState => {
  const collected: ColumnFiltersState = []

  for (const cfg of columnFiltersCfg) {
    const raw = getSearchValue(search, cfg.searchKey)
    const deserialize = cfg.deserialize ?? identity

    if (cfg.type === 'string') {
      const value = (deserialize(raw) as string) ?? ''
      if (typeof value === 'string' && value.trim() !== '') {
        collected.push({ id: cfg.columnId, value })
      }
      continue
    }

    const value = (deserialize(raw) as unknown[]) ?? []
    if (Array.isArray(value) && value.length > 0) {
      collected.push({ id: cfg.columnId, value })
    }
  }

  return collected
}

// 根据 URL search 还原分页状态，并把页码转换成 TanStack Table 使用的从 0 开始索引。
const buildPaginationState = (
  search: SearchRecord,
  pageKey: string,
  pageSizeKey: string,
  defaultPage: number,
  defaultPageSize: number
): PaginationState => {
  const rawPage = getSearchValue(search, pageKey)
  const rawPageSize = getSearchValue(search, pageSizeKey)
  const pageNum = typeof rawPage === 'number' ? rawPage : defaultPage
  const pageSizeNum =
    typeof rawPageSize === 'number' ? rawPageSize : defaultPageSize

  return { pageIndex: Math.max(0, pageNum - 1), pageSize: pageSizeNum }
}

// 将当前列筛选状态重新序列化成 URL patch，供导航函数统一回写。
const buildColumnFilterPatch = (
  nextFilters: ColumnFiltersState,
  columnFiltersCfg: ColumnFilterConfig[]
): SearchRecord => {
  const patch: SearchRecord = {}

  for (const cfg of columnFiltersCfg) {
    const found = nextFilters.find((filter) => filter.id === cfg.columnId)
    const serialize = cfg.serialize ?? identity

    if (cfg.type === 'string') {
      const value = typeof found?.value === 'string' ? found.value : ''
      patch[cfg.searchKey] =
        value.trim() !== '' ? serialize(value) : undefined
      continue
    }

    const value = Array.isArray(found?.value) ? (found.value as unknown[]) : []
    patch[cfg.searchKey] = value.length > 0 ? serialize(value) : undefined
  }

  return patch
}

// 读取当前页码并在缺失时回退到默认页，供越界修正逻辑复用。
const getCurrentPageNumber = (
  search: SearchRecord,
  pageKey: string,
  defaultPage: number
) => {
  const currentPage = getSearchValue(search, pageKey)
  return typeof currentPage === 'number' ? currentPage : defaultPage
}

/** 从 URL search 里提取全局搜索初始值，保证输入框和地址参数一致。 */
function getInitialGlobalFilterValue(
  search: SearchRecord,
  globalFilterEnabled: boolean,
  globalFilterKey: string
): string | undefined {
  if (!globalFilterEnabled) return undefined
  const raw = getSearchValue(search, globalFilterKey)
  return typeof raw === 'string' ? raw : ''
}

/** 创建分页回写处理器，并在默认值场景下清理 URL 参数。 */
function createPaginationChangeHandler(args: {
  pagination: PaginationState
  navigate: NavigateFn
  pageKey: string
  pageSizeKey: string
  defaultPage: number
  defaultPageSize: number
}): OnChangeFn<PaginationState> {
  const { pagination, navigate, pageKey, pageSizeKey, defaultPage, defaultPageSize } = args
  return (updater) => {
    const next = typeof updater === 'function' ? updater(pagination) : updater
    const nextPage = next.pageIndex + 1
    const nextPageSize = next.pageSize
    navigate({
      search: (prev) => mergeSearchPatch(prev, {
        [pageKey]: nextPage <= defaultPage ? undefined : nextPage,
        [pageSizeKey]:
          nextPageSize === defaultPageSize ? undefined : nextPageSize,
      }),
    })
  }
}

/** 创建全局搜索回写处理器，统一执行 trim 和分页重置规则。 */
function createGlobalFilterChangeHandler(args: {
  globalFilterEnabled: boolean
  trimGlobal: boolean
  globalFilter: string
  setGlobalFilter: (value: string) => void
  navigate: NavigateFn
  pageKey: string
  globalFilterKey: string
}): OnChangeFn<string> | undefined {
  const { globalFilterEnabled, trimGlobal, globalFilter, setGlobalFilter, navigate, pageKey, globalFilterKey } = args
  if (!globalFilterEnabled) return undefined

  return (updater) => {
    const next =
      typeof updater === 'function'
        ? updater(globalFilter)
        : updater
    const value = trimGlobal ? next.trim() : next
    setGlobalFilter(value)
    navigate({
      search: (prev) => mergeSearchPatch(prev, {
        [pageKey]: undefined,
        [globalFilterKey]: value ? value : undefined,
      }),
    })
  }
}

/** 创建列筛选回写处理器，统一序列化并在筛选变化后回到第一页。 */
function createColumnFiltersChangeHandler(args: {
  columnFilters: ColumnFiltersState
  setColumnFilters: (value: ColumnFiltersState) => void
  columnFiltersCfg: ColumnFilterConfig[]
  navigate: NavigateFn
  pageKey: string
}): OnChangeFn<ColumnFiltersState> {
  const { columnFilters, setColumnFilters, columnFiltersCfg, navigate, pageKey } = args
  return (updater) => {
    const next =
      typeof updater === 'function' ? updater(columnFilters) : updater
    setColumnFilters(next)
    const patch = buildColumnFilterPatch(next, columnFiltersCfg)

    navigate({
      search: (prev) => mergeSearchPatch(prev, {
        [pageKey]: undefined,
        ...patch,
      }),
    })
  }
}

/** 创建页码越界修正处理器，避免 URL 中保留不可达页码。 */
function createEnsurePageInRangeHandler(args: {
  search: SearchRecord
  navigate: NavigateFn
  pageKey: string
  defaultPage: number
}) {
  const { search, navigate, pageKey, defaultPage } = args
  return (
    pageCount: number,
    opts: { resetTo?: 'first' | 'last' } = { resetTo: 'first' }
  ) => {
    const pageNum = getCurrentPageNumber(search, pageKey, defaultPage)
    if (pageCount > 0 && pageNum > pageCount) {
      navigate({
        replace: true,
        search: (prev) => mergeSearchPatch(prev, {
          [pageKey]: opts.resetTo === 'last' ? pageCount : undefined,
        }),
      })
    }
  }
}

// 管理表格与 URL search 的初始化与回写关系，统一处理分页、全局搜索和列筛选状态。
export function useTableUrlState(
  params: UseTableUrlStateParams
): UseTableUrlStateReturn {
  const {
    search,
    navigate,
    pagination: paginationCfg,
    globalFilter: globalFilterCfg,
    columnFilters: columnFiltersCfg = [],
  } = params

  const { pageKey, pageSizeKey, defaultPage, defaultPageSize } =
    resolvePaginationConfig(paginationCfg)
  const { globalFilterKey, globalFilterEnabled, trimGlobal } =
    resolveGlobalFilterConfig(globalFilterCfg)

  // 根据当前 URL search 构造列筛选初始值。
  const initialColumnFilters: ColumnFiltersState = useMemo(() => {
    return buildInitialColumnFilters(search, columnFiltersCfg)
  }, [columnFiltersCfg, search])

  const [columnFilters, setColumnFilters] =
    useState<ColumnFiltersState>(initialColumnFilters)

  // 当外部 URL search 变化时，回流列筛选状态，避免组件显示与地址栏脱节。
  useEffect(() => {
    setColumnFilters(initialColumnFilters)
  }, [initialColumnFilters])

  const pagination: PaginationState = useMemo(() => {
    return buildPaginationState(
      search,
      pageKey,
      pageSizeKey,
      defaultPage,
      defaultPageSize
    )
  }, [search, pageKey, pageSizeKey, defaultPage, defaultPageSize])

  // 同步分页变化到 URL，并在回到默认值时清理对应的 search 字段。
  const onPaginationChange = useMemo(
    () => createPaginationChangeHandler({
      pagination,
      navigate,
      pageKey,
      pageSizeKey,
      defaultPage,
      defaultPageSize,
    }),
    [pagination, navigate, pageKey, pageSizeKey, defaultPage, defaultPageSize]
  )

  const [globalFilter, setGlobalFilter] = useState<string | undefined>(() => {
    return getInitialGlobalFilterValue(search, globalFilterEnabled, globalFilterKey)
  })

  // 当外部 URL search 变化时，同步全局搜索词，保证输入框与真实查询参数一致。
  useEffect(() => {
    if (!globalFilterEnabled) {
      setGlobalFilter(undefined)
      return
    }

    const raw = getSearchValue(search, globalFilterKey)
    setGlobalFilter(typeof raw === 'string' ? raw : '')
  }, [globalFilterEnabled, globalFilterKey, search])

  // 同步全局搜索词到本地状态和 URL，并在搜索变化后重置页码。
  const onGlobalFilterChange = useMemo(
    () => createGlobalFilterChangeHandler({
      globalFilterEnabled,
      trimGlobal,
      globalFilter: globalFilter ?? '',
      setGlobalFilter,
      navigate,
      pageKey,
      globalFilterKey,
    }),
    [globalFilterEnabled, trimGlobal, globalFilter, setGlobalFilter, navigate, pageKey, globalFilterKey]
  )

  // 同步列筛选变化到 URL，并在筛选条件变化后回到第一页。
  const onColumnFiltersChange = useMemo(
    () => createColumnFiltersChangeHandler({
      columnFilters,
      setColumnFilters,
      columnFiltersCfg,
      navigate,
      pageKey,
    }),
    [columnFilters, setColumnFilters, columnFiltersCfg, navigate, pageKey]
  )

  // 当当前页超出总页数时，把 URL 中的页码修正到首页或末页。
  const ensurePageInRange = useMemo(
    () => createEnsurePageInRangeHandler({
      search,
      navigate,
      pageKey,
      defaultPage,
    }),
    [search, navigate, pageKey, defaultPage]
  )

  return {
    globalFilter: globalFilterEnabled ? (globalFilter ?? '') : undefined,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  }
}
