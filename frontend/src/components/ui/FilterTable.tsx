import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { ColumnDef, RowData, Table } from "@tanstack/react-table";
import { useLocation } from "react-router-dom";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { StaleBanner } from "@/components/ui/StaleBanner";
import {
  TableEmptyState,
  TableFilters,
  TableLoadingState,
  type TableSearchInputProps,
} from "@/components/ui/TableFilters";
import { useListSSE } from "@/hooks/useListSSE";
import { useInlineSearchCompletion } from "@/hooks/useInlineSearchCompletion";
import {
  DEFAULT_SEARCH_FIELD_OPTIONS,
  DEFAULT_STATUS_OPTIONS,
  useTableState,
} from "@/hooks/useTableState";
import type {
  FilterAPI,
  FilterOption,
  SearchFieldOption,
} from "@/hooks/useTableState";
import { getInventoryTableColumns } from "@/lib/tableConfigs";
import type { SearchMatchMode } from "@/lib/searchMatchMode";
import { useSSEStore } from "@/store/sseStore";
import { cn } from "@/lib/utils";

declare module "@tanstack/react-table" {
  interface TableMeta<TData extends RowData> {
    fuzzySearch: boolean;
    matchMode: SearchMatchMode;
    onEdit?: (item: TData) => void;
    onBorrowSuccess?: () => void;
  }
}

export interface FilterTableProps {
  api: FilterAPI;
  queryKey?: string[];
  tableId: string;
  customColumns?: ColumnDef<Record<string, unknown>, unknown>[];
  onEdit?: (item: Record<string, unknown>) => void;
  onBorrowSuccess?: () => void;
  onQueryError?: (error: unknown) => void;
  onQueryDataReady?: (context: FilterTableQueryDataReadyContext) => void;
  statusOptions?: FilterOption[];
  searchFieldOptions?: SearchFieldOption[];
  showFuzzySearch?: boolean;
  showMatchMode?: boolean;
  defaultStatus?: string;
  defaultSearchField?: string;
  pageSize?: number;
  debounceMs?: number;
  extraParams?: Record<string, unknown>;
  suppressSorting?: boolean;
  searchPlaceholder?: string;
  searchInputDisabled?: boolean;
  searchInputDisabledReason?: string;
  searchInputDisabledValue?: string;
  onSearchInputDisabledClear?: () => void;
  searchResetSignal?: unknown;
  sortingResetSignal?: unknown;
  expandAllSignal?: unknown;
  collapseAllSignal?: unknown;
  searchActions?: React.ReactNode;
  title?: React.ReactNode;
  enableExpandAll?: boolean;
  disableExpandedRowAnimation?: boolean;
  renderExpandedRow?: (item: Record<string, unknown>) => React.ReactNode;
  noteField?: string;
  scrollHeight?: number | string;
  className?: string;
  filterClassName?: string;
  cardClassName?: string;
  emptyText?: string;
  endMessage?: string;
  toolbarActions?: React.ReactNode;
  mobileMinTableWidth?: number;
  mobileColumnMinSizes?: Readonly<Record<string, number>>;
  inlineCompletionEndpoint?: '/inventory/' | '/reagent-orders/' | '/consumable-orders/';
  enableInlineCompletion?: boolean;
  realtime?: {
    room: string;
    eventTypes: readonly string[];
    staleOnly?: boolean;
    moveUpdatedRowToStartWhenUnsorted?: boolean;
    onRefresh?: () => void | Promise<void>;
    searchFieldMap?: Partial<Record<string, string[]>>;
    onSafePatch?: (event: import("@/hooks/useSSE").SSEEventEnvelope) => void;
    shouldHandleEvent?: (
      event: import("@/hooks/useSSE").SSEEventEnvelope,
      context: import("@/hooks/useListSSE").ListSSEContext,
    ) => boolean;
  };
}

export interface FilterTableQueryDataReadyContext {
  extraParams: Record<string, unknown>;
  globalFilter: string;
  hasSorting: boolean;
  searchField: string;
  total: number;
}

const DEFAULT_FILTER_TABLE_PROPS = {
  className: "",
  debounceMs: 300,
  defaultSearchField: "all",
  defaultStatus: "all",
  emptyText: "暂无数据",
  enableExpandAll: true,
  extraParams: {} as Record<string, unknown>,
  pageSize: 50,
  queryKey: ["list"] as string[],
  searchFieldOptions: DEFAULT_SEARCH_FIELD_OPTIONS,
  searchInputDisabled: false,
  searchPlaceholder: "搜索名称、CAS号、位置...",
  showFuzzySearch: true,
  statusOptions: DEFAULT_STATUS_OPTIONS,
} satisfies Partial<FilterTableProps>;

function resolveFilterTableProps(props: Readonly<FilterTableProps>) {
  return {
    ...props,
    className: props.className ?? DEFAULT_FILTER_TABLE_PROPS.className,
    debounceMs: props.debounceMs ?? DEFAULT_FILTER_TABLE_PROPS.debounceMs,
    defaultSearchField:
      props.defaultSearchField ?? DEFAULT_FILTER_TABLE_PROPS.defaultSearchField,
    defaultStatus: props.defaultStatus ?? DEFAULT_FILTER_TABLE_PROPS.defaultStatus,
    emptyText: props.emptyText ?? DEFAULT_FILTER_TABLE_PROPS.emptyText,
    enableExpandAll: props.enableExpandAll ?? DEFAULT_FILTER_TABLE_PROPS.enableExpandAll,
    extraParams: props.extraParams ?? DEFAULT_FILTER_TABLE_PROPS.extraParams,
    pageSize: props.pageSize ?? DEFAULT_FILTER_TABLE_PROPS.pageSize,
    queryKey: props.queryKey ?? DEFAULT_FILTER_TABLE_PROPS.queryKey,
    searchFieldOptions:
      props.searchFieldOptions ?? DEFAULT_FILTER_TABLE_PROPS.searchFieldOptions,
    searchInputDisabled:
      props.searchInputDisabled ?? DEFAULT_FILTER_TABLE_PROPS.searchInputDisabled,
    searchPlaceholder:
      props.searchPlaceholder ?? DEFAULT_FILTER_TABLE_PROPS.searchPlaceholder,
    showFuzzySearch: props.showFuzzySearch ?? DEFAULT_FILTER_TABLE_PROPS.showFuzzySearch,
    statusOptions: props.statusOptions ?? DEFAULT_FILTER_TABLE_PROPS.statusOptions,
  };
}

// 从地址栏解析初始搜索词与搜索字段，作为表格首屏状态来源。
function getInitialUrlSearchState({
  defaultSearchField,
  locationSearch,
  searchFieldOptions,
}: Readonly<{
  defaultSearchField: string;
  locationSearch: string;
  searchFieldOptions: SearchFieldOption[];
}>) {
  try {
    const query = new URLSearchParams(locationSearch);
    const nextSearch = query.get("search")?.trim() ?? "";
    const nextField = query.get("field")?.trim() ?? "";
    const hasValidField = searchFieldOptions.some(
      (option) => option.value === nextField,
    );

    return {
      search: nextSearch,
      field: hasValidField ? nextField : defaultSearchField,
      hasQuery: query.has("search") || query.has("field"),
    };
  } catch {
    return {
      search: "",
      field: defaultSearchField,
      hasQuery: false,
    };
  }
}

// 为表格生成稳定行 id，优先使用业务主键，其次回退到索引。
function getTableRowId(row: Record<string, unknown>, index: number): string {
  if (typeof row.id === "string" || typeof row.id === "number") {
    return String(row.id);
  }

  if (typeof row.uuid === "string" || typeof row.uuid === "number") {
    return String(row.uuid);
  }

  return String(index);
}

// 短列表用 `auto` 避免空白滚动容器，长列表再撑满视口高度。
function getScrollHeight(
  rowCount: number,
  scrollHeight?: number | string,
): number | string {
  if (scrollHeight !== undefined) {
    return scrollHeight;
  }

  if (rowCount <= 10) {
    return "auto";
  }

  return "calc(100vh - 112px - 16px)";
}

function shouldDisableExpandAll(isAllExpanded: boolean, isTableAtTop: boolean): boolean {
  return !isAllExpanded && !isTableAtTop;
}

function resolveTableColumns(
  customColumns?: ColumnDef<Record<string, unknown>, unknown>[],
): ColumnDef<Record<string, unknown>, unknown>[] {
  if (customColumns && customColumns.length > 0) {
    return customColumns;
  }

  return getInventoryTableColumns() as ColumnDef<
    Record<string, unknown>,
    unknown
  >[];
}

function resolveRealtimeSearchFields(
  args: Readonly<{
    searchField: string;
    searchFieldOptions: SearchFieldOption[];
    searchFieldMap?: Partial<Record<string, string[]>>;
  }>,
): string[] {
  const { searchField, searchFieldOptions, searchFieldMap } = args;
  const expandField = (field: string): string[] => {
    const mapped = searchFieldMap?.[field];
    if (mapped && mapped.length > 0) {
      return mapped;
    }
    return [field];
  };

  if (searchField && searchField !== "all") {
    return expandField(searchField);
  }

  return Array.from(
    new Set(
      searchFieldOptions
        .map((option) => option.value)
        .filter((value) => value !== "all")
        .flatMap((value) => expandField(value)),
    ),
  );
}

// 通过 ref 持有外部动作回调，避免表格 meta 因函数引用变化而频繁重建。
function useActionRefs({
  onBorrowSuccess,
  onEdit,
}: Readonly<Pick<FilterTableProps, "onBorrowSuccess" | "onEdit">>) {
  const onEditRef = useRef(onEdit);
  const onBorrowSuccessRef = useRef(onBorrowSuccess);

  useEffect(() => {
    onEditRef.current = onEdit;
    onBorrowSuccessRef.current = onBorrowSuccess;
  }, [onEdit, onBorrowSuccess]);

  return { onEditRef, onBorrowSuccessRef };
}

// 只在地址栏搜索态真的变化后回流，避免本地搜索更新再次把自己触发一遍。
function useLocationSearchSync({
  applySearchImmediate,
  defaultSearchField,
  initialUrlSearchState,
  locationSearch,
}: Readonly<{
  applySearchImmediate: (search: string, field?: string) => void;
  defaultSearchField: string;
  initialUrlSearchState: ReturnType<typeof getInitialUrlSearchState>;
  locationSearch: string;
}>) {
  const lastAppliedSearchRef = useRef<string>(locationSearch);

  useEffect(() => {
    if (locationSearch === lastAppliedSearchRef.current) {
      return;
    }

    if (!locationSearch || !initialUrlSearchState.hasQuery) {
      applySearchImmediate("", defaultSearchField);
      lastAppliedSearchRef.current = locationSearch;
      return;
    }

    applySearchImmediate(
      initialUrlSearchState.search,
      initialUrlSearchState.field,
    );
    lastAppliedSearchRef.current = locationSearch;
  }, [
    applySearchImmediate,
    defaultSearchField,
    initialUrlSearchState.field,
    initialUrlSearchState.hasQuery,
    initialUrlSearchState.search,
    locationSearch,
  ]);
}

function useChangedSignalEffect({
  effect,
  signal,
}: Readonly<{
  effect: () => void;
  signal: unknown;
}>) {
  const lastSignalRef = useRef<unknown>(signal);

  useEffect(() => {
    if (Object.is(signal, lastSignalRef.current)) {
      return;
    }

    lastSignalRef.current = signal;
    effect();
  }, [effect, signal]);
}

// 外部筛选接管结果集时清空文字搜索，避免同一请求同时携带两套搜索条件。
function useSearchResetSignal({
  applySearchImmediate,
  defaultSearchField,
  resetSignal,
  searchInputDisabled,
}: Readonly<{
  applySearchImmediate: (search: string, field?: string) => void;
  defaultSearchField: string;
  resetSignal: unknown;
  searchInputDisabled: boolean;
}>) {
  useChangedSignalEffect({
    signal: resetSignal,
    effect: () => {
      if (searchInputDisabled) {
        applySearchImmediate("", defaultSearchField);
      }
    },
  });
}

// 在筛选条件变化后重置展开态，避免旧展开行与新结果集错位。
function useExpandedResetOnFilterChange({
  enableExpandAll,
  filter,
  table,
}: Readonly<{
  enableExpandAll: boolean;
  filter: ReturnType<typeof useTableState>;
  table: Table<Record<string, unknown>>;
}>) {
  const tableRef = useRef(table);

  useEffect(() => {
    tableRef.current = table;
  }, [table]);

  const prevFiltersRef = useRef({
    globalFilter: filter.globalFilter,
    statusFilter: filter.statusFilter,
    searchField: filter.searchField,
    fuzzySearch: filter.fuzzySearch,
    matchMode: filter.matchMode,
    sorting: filter.sorting,
  });

  useEffect(() => {
    const prev = prevFiltersRef.current;
    const current = {
      globalFilter: filter.globalFilter,
      statusFilter: filter.statusFilter,
      searchField: filter.searchField,
      fuzzySearch: filter.fuzzySearch,
      matchMode: filter.matchMode,
      sorting: filter.sorting,
    };

    const hasFilterChanged =
      prev.globalFilter !== current.globalFilter ||
      prev.statusFilter !== current.statusFilter ||
      prev.searchField !== current.searchField ||
      prev.fuzzySearch !== current.fuzzySearch ||
      prev.matchMode !== current.matchMode ||
      prev.sorting !== current.sorting;

    if (!hasFilterChanged) {
      return;
    }

    tableRef.current.resetExpanded();
    if (enableExpandAll && filter.isAllExpanded) {
      tableRef.current.toggleAllRowsExpanded(true);
    }
    prevFiltersRef.current = current;
  }, [
    enableExpandAll,
    filter.fuzzySearch,
    filter.globalFilter,
    filter.isAllExpanded,
    filter.matchMode,
    filter.searchField,
    filter.sorting,
    filter.statusFilter,
  ]);
}

// 外部业务场景需要在结果集刷新后默认展开全部，例如结构检索命中后展示匹配高亮。
function useExpandAllSignal({
  enableExpandAll,
  expandAllSignal,
  filter,
}: Readonly<{
  enableExpandAll: boolean;
  expandAllSignal: unknown;
  filter: ReturnType<typeof useTableState>;
}>) {
  useChangedSignalEffect({
    signal: expandAllSignal,
    effect: () => {
      if (!enableExpandAll || expandAllSignal === null || expandAllSignal === undefined) {
        return;
      }

      filter.setAllExpanded(true);
    },
  });
}

function useCollapseAllSignal({
  collapseAllSignal,
  enableExpandAll,
  filter,
}: Readonly<{
  collapseAllSignal: unknown;
  enableExpandAll: boolean;
  filter: ReturnType<typeof useTableState>;
}>) {
  useChangedSignalEffect({
    signal: collapseAllSignal,
    effect: () => {
      if (!enableExpandAll || collapseAllSignal === null || collapseAllSignal === undefined) {
        return;
      }

      filter.setAllExpanded(false);
    },
  });
}

function useSortingResetSignal({
  filter,
  sortingResetSignal,
}: Readonly<{
  filter: ReturnType<typeof useTableState>;
  sortingResetSignal: unknown;
}>) {
  useChangedSignalEffect({
    signal: sortingResetSignal,
    effect: () => {
      if (sortingResetSignal === null || sortingResetSignal === undefined) {
        return;
      }

      filter.setSorting([]);
    },
  });
}

interface FilterTableHeaderProps {
  disableExpandAll: boolean;
  displayCount: string | number;
  enableExpandAll: boolean;
  isAllExpanded: boolean;
  onToggleExpandAll: () => void;
  title?: React.ReactNode;
}

// 渲染筛选表格卡片头部与“展开全部”控制区。
function FilterTableHeader({
  disableExpandAll,
  displayCount,
  enableExpandAll,
  isAllExpanded,
  onToggleExpandAll,
  title,
}: Readonly<FilterTableHeaderProps>) {
  if (!title) {
    return null;
  }

  return (
    <CardHeader className="px-4 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <CardTitle className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-base sm:text-lg">
          {title}
          <span className="shrink-0 text-muted-foreground font-normal">
            (&thinsp;{displayCount}&thinsp;)
          </span>
        </CardTitle>
        {enableExpandAll && (
          <Button
            variant="modern"
            size="lg"
            onClick={onToggleExpandAll}
            disabled={disableExpandAll}
            className={cn(
              "shrink-0",
              disableExpandAll && "text-muted-foreground opacity-60",
            )}
          >
            {isAllExpanded ? (
              <>
                <ChevronsDownUp className="size-4 -ml-0.5 mr-1.5" />
                收起全部
              </>
            ) : (
              <>
                <ChevronsUpDown className="size-4 -ml-0.5 mr-1.5" />
                展开全部
              </>
            )}
          </Button>
        )}
      </div>
    </CardHeader>
  );
}

function useFilterTableRealtime({
  extraParams,
  filter,
  isTableAtTop,
  queryKey,
  realtime,
  searchFieldOptions,
}: Readonly<{
  filter: ReturnType<typeof useTableState>;
  extraParams: Record<string, unknown>;
  isTableAtTop: boolean;
  queryKey?: readonly unknown[];
  realtime?: FilterTableProps["realtime"];
  searchFieldOptions: SearchFieldOption[];
}>) {
  const clearStaleKey = useSSEStore((state) => state.clearStaleKey);
  const activeQueryKey = useMemo<readonly unknown[]>(() => {
    const baseKey = queryKey ?? [];
    return [
      ...baseKey,
      extraParams,
      filter.statusFilter,
      filter.globalFilter,
      filter.searchField,
      filter.fuzzySearch,
      filter.matchMode,
      filter.sorting,
    ];
  }, [
    filter.fuzzySearch,
    filter.globalFilter,
    filter.matchMode,
    filter.searchField,
    filter.sorting,
    filter.statusFilter,
    extraParams,
    queryKey,
  ]);

  const loadedIds = useMemo(() => {
    return new Set(
      filter.data
        .map((row) => {
          const record = row as Record<string, unknown>;
          const candidates = [record.id, record.inventory_id, record.order_id];
          return (
            candidates.find(
              (candidate): candidate is string | number =>
                typeof candidate === "string" || typeof candidate === "number",
            ) ?? null
          );
        })
        .filter((id): id is string | number => id !== null),
    );
  }, [filter.data]);

  const activeSearchFields = useMemo(() => {
    return resolveRealtimeSearchFields({
      searchField: filter.searchField,
      searchFieldOptions,
      searchFieldMap: realtime?.searchFieldMap,
    });
  }, [filter.searchField, realtime?.searchFieldMap, searchFieldOptions]);

  const currentSortBy = filter.sorting[0]?.id;
  const staleKey = useMemo(() => {
    return `${realtime?.room ?? "__disabled__"}::${JSON.stringify(activeQueryKey)}`;
  }, [activeQueryKey, realtime?.room]);
  const isStale = useSSEStore((state) => state.hasStaleKey(staleKey));
  const staleRefreshSeenRef = useRef(false);

  useEffect(() => {
    if (!isStale) {
      staleRefreshSeenRef.current = false;
      return;
    }

    if (filter.isFetching) {
      staleRefreshSeenRef.current = true;
      return;
    }

    if (staleRefreshSeenRef.current && !filter.isError) {
      clearStaleKey(staleKey);
      staleRefreshSeenRef.current = false;
    }
  }, [clearStaleKey, filter.isError, filter.isFetching, isStale, staleKey]);

  const handleRealtimeRefresh = React.useCallback(async () => {
    if (realtime?.onRefresh) {
      await realtime.onRefresh();
      return;
    }
    filter.invalidate();
  }, [filter, realtime]);

  useListSSE({
    enabled: Boolean(realtime),
    room: realtime?.room ?? "__disabled__",
    staleKey,
    queryKey: activeQueryKey,
    eventTypes: realtime?.eventTypes ?? [],
    getContext: () => ({
      loadedIds,
      searchKeyword: filter.globalFilter,
      searchFields: activeSearchFields,
      fuzzySearch: filter.fuzzySearch,
      matchMode: filter.matchMode,
      sortBy: currentSortBy,
      statusFilter: filter.statusFilter,
      isAtListStart: isTableAtTop,
    }),
    onSafePatch: realtime?.onSafePatch,
    staleOnly: realtime?.staleOnly ?? false,
    moveUpdatedRowToStartWhenUnsorted:
      realtime?.moveUpdatedRowToStartWhenUnsorted ?? false,
    shouldHandleEvent: realtime?.shouldHandleEvent,
  });

  return {
    handleRealtimeRefresh,
    staleKey,
  };
}

interface FilterTableContentProps {
  emptyText: string;
  endMessage?: string;
  enableExpandAll: boolean;
  disableExpandedRowAnimation?: boolean;
  filter: ReturnType<typeof useTableState>;
  noteField?: string;
  renderExpandedRow?: (item: Record<string, unknown>) => React.ReactNode;
  scrollHeight: number | string;
  setIsTableAtTop: React.Dispatch<React.SetStateAction<boolean>>;
  statusOptions: FilterOption[];
  table: Table<Record<string, unknown>>;
  tableId: string;
  mobileMinTableWidth?: number;
  mobileColumnMinSizes?: Readonly<Record<string, number>>;
}

// 根据加载态、空态和数据态切换表格主体内容。
function FilterTableContent({
  emptyText,
  endMessage,
  enableExpandAll,
  disableExpandedRowAnimation,
  filter,
  noteField,
  renderExpandedRow,
  scrollHeight,
  setIsTableAtTop,
  statusOptions,
  table,
  tableId,
  mobileMinTableWidth,
  mobileColumnMinSizes,
}: Readonly<FilterTableContentProps>) {
  if (filter.isLoading && filter.data.length === 0) {
    return <TableLoadingState className="mx-6" />;
  }

  if (filter.data.length === 0) {
    return (
      <TableEmptyState
        searchKeyword={filter.globalFilter}
        statusFilter={filter.statusFilter}
        hasFilter={filter.hasFilter}
        matchMode={filter.matchMode}
        emptyText={emptyText}
        statusOptions={statusOptions}
      />
    );
  }

  return (
    <div className="px-6">
      <DataTable
        table={table}
        renderExpandedRow={renderExpandedRow}
        scrollHeight={scrollHeight}
        enableExpandAll={enableExpandAll}
        disableExpandedRowAnimation={disableExpandedRowAnimation}
        expandAllStorageKey={tableId}
        noteField={noteField}
        isAllExpanded={filter.isAllExpanded}
        onToggleExpandAll={filter.toggleExpandAll}
        hasNextPage={filter.hasNextPage}
        isFetchingNextPage={filter.isFetchingNextPage}
        fetchNextPage={filter.fetchNextPage}
        total={filter.total}
        searchKeyword={filter.globalFilter}
        endMessage={endMessage}
        onIsAtTopChange={setIsTableAtTop}
        mobileMinTableWidth={mobileMinTableWidth}
        mobileColumnMinSizes={mobileColumnMinSizes}
      />
    </div>
  );
}

function FilterTableControls({
  filter,
  searchFieldOptions,
  searchInputDisabled,
  searchInputDisabledReason,
  searchInputDisabledValue,
  onSearchInputDisabledClear,
  searchActions,
  searchPlaceholder,
  showFuzzySearch,
  showMatchMode,
  statusOptions,
  filterClassName,
  toolbarActions,
  inlineCompletion,
}: Readonly<{
  filter: ReturnType<typeof useTableState>;
  searchFieldOptions: SearchFieldOption[];
  searchInputDisabled: boolean;
  searchInputDisabledReason?: string;
  searchInputDisabledValue?: string;
  onSearchInputDisabledClear?: () => void;
  searchActions?: React.ReactNode;
  searchPlaceholder: string;
  showFuzzySearch?: boolean;
  showMatchMode?: boolean;
  statusOptions: FilterOption[];
  filterClassName?: string;
  toolbarActions?: React.ReactNode;
  inlineCompletion?: TableSearchInputProps["inlineCompletion"];
}>) {
  return (
    <TableFilters
      className={filterClassName}
      searchInput={filter.searchInput}
      onSearchInputChange={filter.setSearchInput}
      searchInputDisabled={searchInputDisabled}
      searchInputDisabledReason={searchInputDisabledReason}
      searchInputDisabledValue={searchInputDisabledValue}
      onSearchInputDisabledClear={onSearchInputDisabledClear}
      statusFilter={filter.statusFilter}
      onStatusFilterChange={filter.setStatusFilter}
      searchField={filter.searchField}
      onSearchFieldChange={filter.setSearchField}
      fuzzySearch={filter.fuzzySearch}
      onFuzzySearchChange={filter.setFuzzySearch}
      matchMode={filter.matchMode}
      onMatchModeChange={filter.setMatchMode}
      statusOptions={statusOptions}
      searchFieldOptions={searchFieldOptions}
      searchActions={searchActions}
      searchPlaceholder={searchPlaceholder}
      showFuzzySearch={showFuzzySearch}
      showMatchMode={showMatchMode}
      actions={toolbarActions}
      inlineCompletion={inlineCompletion}
    />
  );
}

function useFilterTableInstance({
  actionRefs,
  canExpandRows,
  customColumns,
  filter,
}: Readonly<{
  actionRefs: ReturnType<typeof useActionRefs>;
  canExpandRows: boolean;
  customColumns?: ColumnDef<Record<string, unknown>, unknown>[];
  filter: ReturnType<typeof useTableState>;
}>) {
  const tableColumns = useMemo(() => resolveTableColumns(customColumns), [customColumns]);

  // eslint-disable-next-line react-hooks/incompatible-library
  return useReactTable({
    defaultColumn: { sortDescFirst: false, sortingFn: "text" },
    data: filter.data as Record<string, unknown>[],
    columns: tableColumns,
    getRowId: getTableRowId,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => canExpandRows,
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    onColumnSizingChange: filter.setColumnSizing,
    manualSorting: true,
    onSortingChange: filter.setSorting,
    state: {
      sorting: filter.sorting,
      columnSizing: filter.columnSizing,
      globalFilter: filter.globalFilter,
    },
    meta: {
      fuzzySearch: filter.fuzzySearch,
      matchMode: filter.matchMode,
      onEdit: (item) => actionRefs.onEditRef.current?.(item),
      onBorrowSuccess: () => actionRefs.onBorrowSuccessRef.current?.(),
    },
  });
}

function useFilterTableEffects({
  defaultStatus,
  defaultSearchField,
  enableExpandAll,
  expandAllSignal,
  collapseAllSignal,
  extraParams,
  filter,
  initialUrlSearchState,
  locationSearch,
  onQueryDataReady,
  onQueryError,
  searchInputDisabled,
  searchResetSignal,
  sortingResetSignal,
  statusOptions,
  table,
}: Readonly<{
  defaultStatus: string;
  defaultSearchField: string;
  enableExpandAll: boolean;
  expandAllSignal: unknown;
  collapseAllSignal: unknown;
  extraParams: Record<string, unknown>;
  filter: ReturnType<typeof useTableState>;
  initialUrlSearchState: ReturnType<typeof getInitialUrlSearchState>;
  locationSearch: string;
  onQueryDataReady?: (context: FilterTableQueryDataReadyContext) => void;
  onQueryError?: (error: unknown) => void;
  searchInputDisabled: boolean;
  searchResetSignal: unknown;
  sortingResetSignal: unknown;
  statusOptions: FilterOption[];
  table: Table<Record<string, unknown>>;
}>) {
  const { setStatusFilter, statusFilter } = filter;

  useEffect(() => {
    if (filter.isError) {
      onQueryError?.(filter.error);
    }
  }, [filter.error, filter.isError, onQueryError]);

  useEffect(() => {
    if (!onQueryDataReady || filter.isLoading || filter.isFetching) {
      return;
    }

    if (filter.isPlaceholderData || filter.isError) {
      return;
    }

    onQueryDataReady({
      extraParams,
      globalFilter: filter.globalFilter,
      hasSorting: filter.sorting.length > 0,
      searchField: filter.searchField,
      total: filter.total,
    });
  }, [
    extraParams,
    filter.globalFilter,
    filter.isError,
    filter.isFetching,
    filter.isLoading,
    filter.isPlaceholderData,
    filter.searchField,
    filter.sorting,
    filter.total,
    onQueryDataReady,
  ]);

  useEffect(() => {
    const hasCurrentStatus = statusOptions.some((option) => option.value === statusFilter);
    if (!hasCurrentStatus) {
      setStatusFilter(defaultStatus);
    }
  }, [defaultStatus, setStatusFilter, statusFilter, statusOptions]);

  useSearchResetSignal({
    applySearchImmediate: filter.applySearchImmediate,
    defaultSearchField,
    resetSignal: searchResetSignal,
    searchInputDisabled,
  });
  useLocationSearchSync({
    applySearchImmediate: filter.applySearchImmediate,
    defaultSearchField,
    initialUrlSearchState,
    locationSearch,
  });
  useExpandedResetOnFilterChange({ enableExpandAll, filter, table });
  useExpandAllSignal({ enableExpandAll, expandAllSignal, filter });
  useCollapseAllSignal({ enableExpandAll, collapseAllSignal, filter });
  useSortingResetSignal({ filter, sortingResetSignal });
}

function useFilterTableInlineCompletion({
  enabled,
  endpoint,
  filter,
  searchInputDisabled,
}: Readonly<{
  enabled?: boolean;
  endpoint?: FilterTableProps["inlineCompletionEndpoint"];
  filter: ReturnType<typeof useTableState>;
  searchInputDisabled?: boolean;
}>): TableSearchInputProps["inlineCompletion"] | undefined {
  const isAndSearch = filter.searchInput.includes("&&")

  const isEnabled = Boolean(
    enabled &&
      endpoint &&
      !searchInputDisabled &&
      filter.searchField === "all" &&
      !isAndSearch,
  );
  const inlineCompletion = useInlineSearchCompletion({
    endpoint: endpoint ?? "",
    field: filter.searchField,
    value: filter.searchInput,
    enabled: isEnabled,
  });

  if (!isEnabled) {
    return undefined;
  }

  return {
    suffix: inlineCompletion.completion?.suffix ?? null,
    hidden: inlineCompletion.hidden,
    onAccept: () => {
      const accepted = inlineCompletion.onAccept();
      if (accepted !== filter.searchInput) {
        filter.applySearchImmediate(accepted);
        inlineCompletion.submitFeedback(true);
      }
      return accepted;
    },
    onDismiss: () => {
      inlineCompletion.onDismiss();
      inlineCompletion.submitFeedback(false);
    },
  };
}

// 组合筛选栏、表格状态与数据表格渲染，是 FilterTable 的总入口。
export function FilterTable(props: Readonly<FilterTableProps>) {
  const {
    api,
    queryKey,
    tableId,
    customColumns,
    onEdit,
    onBorrowSuccess,
    onQueryError,
    onQueryDataReady,
    statusOptions,
    searchFieldOptions,
    showFuzzySearch,
    showMatchMode,
    defaultStatus,
    defaultSearchField,
    pageSize,
    debounceMs,
    extraParams,
    suppressSorting,
    searchPlaceholder,
    searchInputDisabled,
    searchInputDisabledReason,
    searchInputDisabledValue,
    onSearchInputDisabledClear,
    searchResetSignal,
    sortingResetSignal,
    expandAllSignal,
    collapseAllSignal,
    searchActions,
    title,
    enableExpandAll,
    disableExpandedRowAnimation,
    renderExpandedRow,
    noteField, scrollHeight, className, filterClassName, cardClassName,
    emptyText, endMessage, toolbarActions, realtime, mobileMinTableWidth, mobileColumnMinSizes,
    inlineCompletionEndpoint, enableInlineCompletion,
  } = resolveFilterTableProps(props);
  const location = useLocation();
  const actionRefs = useActionRefs({ onEdit, onBorrowSuccess });
  const [isTableAtTop, setIsTableAtTop] = useState(true);

  const initialUrlSearchState = getInitialUrlSearchState({
    defaultSearchField,
    locationSearch: location.search,
    searchFieldOptions,
  });

  const filter = useTableState({
    api,
    queryKey,
    tableId,
    statusOptions,
    searchFieldOptions,
    defaultStatus,
    defaultSearchField,
    pageSize,
    debounceMs,
    extraParams,
    suppressSorting: Boolean(suppressSorting),
    initialSearch: initialUrlSearchState.search,
    initialSearchField: initialUrlSearchState.field,
    enableFuzzySearch: showFuzzySearch,
  });

  const table = useFilterTableInstance({ actionRefs, canExpandRows: Boolean(renderExpandedRow), customColumns, filter });

  useFilterTableEffects({
    defaultStatus,
    defaultSearchField,
    enableExpandAll,
    expandAllSignal,
    collapseAllSignal,
    extraParams,
    filter,
    initialUrlSearchState,
    locationSearch: location.search,
    onQueryDataReady,
    onQueryError,
    searchInputDisabled,
    searchResetSignal,
    sortingResetSignal,
    statusOptions,
    table,
  });

  const { handleRealtimeRefresh, staleKey } = useFilterTableRealtime({
    extraParams,
    filter,
    isTableAtTop,
    queryKey,
    realtime,
    searchFieldOptions,
  });

  const calculatedScrollHeight = getScrollHeight(filter.data.length, scrollHeight);

  const disableExpandAll = shouldDisableExpandAll(filter.isAllExpanded, isTableAtTop);

  const inlineCompletion = useFilterTableInlineCompletion({
    enabled: enableInlineCompletion, endpoint: inlineCompletionEndpoint, filter, searchInputDisabled,
  });

  return (
    <div className={cn("space-y-6", className)}>
      <FilterTableControls
        filter={filter}
        searchFieldOptions={searchFieldOptions}
        searchInputDisabled={searchInputDisabled}
        searchInputDisabledReason={searchInputDisabledReason}
        searchInputDisabledValue={searchInputDisabledValue}
        onSearchInputDisabledClear={onSearchInputDisabledClear}
        searchActions={searchActions}
        searchPlaceholder={searchPlaceholder}
        showFuzzySearch={showFuzzySearch}
        showMatchMode={showMatchMode}
        statusOptions={statusOptions}
        filterClassName={filterClassName}
        toolbarActions={toolbarActions}
        inlineCompletion={inlineCompletion}
      />

      <Card className={cn("relative overflow-hidden", cardClassName)}>
        <FilterTableHeader
          title={title}
          displayCount={filter.displayCount}
          enableExpandAll={enableExpandAll}
          isAllExpanded={filter.isAllExpanded}
          onToggleExpandAll={filter.toggleExpandAll}
          disableExpandAll={disableExpandAll}
        />
        <CardContent className="relative p-0">
          <FilterTableContent
            emptyText={emptyText}
            endMessage={endMessage}
            enableExpandAll={enableExpandAll}
            disableExpandedRowAnimation={disableExpandedRowAnimation}
            filter={filter}
            noteField={noteField}
            renderExpandedRow={renderExpandedRow}
            scrollHeight={calculatedScrollHeight}
            setIsTableAtTop={setIsTableAtTop}
            statusOptions={statusOptions}
            table={table}
            tableId={tableId}
            mobileMinTableWidth={mobileMinTableWidth}
            mobileColumnMinSizes={mobileColumnMinSizes}
          />
          {realtime && (
            <StaleBanner
              staleKey={staleKey}
              onRefresh={handleRealtimeRefresh}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default FilterTable;
