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
import { TableEmptyState, TableFilters, TableLoadingState } from "@/components/ui/TableFilters";
import { useListSSE } from "@/hooks/useListSSE";
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
import { cn } from "@/lib/utils";

declare module "@tanstack/react-table" {
  interface TableMeta<TData extends RowData> {
    fuzzySearch: boolean;
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
  toolbarActions?: React.ReactNode;
  realtime?: {
    room: string;
    eventTypes: readonly string[];
    staleOnly?: boolean;
    onRefresh?: () => void | Promise<void>;
    searchFieldMap?: Partial<Record<string, string[]>>;
    onSafePatch?: (event: import("@/hooks/useSSE").SSEEventEnvelope) => void;
    shouldHandleEvent?: (
      event: import("@/hooks/useSSE").SSEEventEnvelope,
      context: import("@/hooks/useListSSE").ListSSEContext,
    ) => boolean;
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
  const lastResetSignalRef = useRef<unknown>(resetSignal);

  useEffect(() => {
    if (Object.is(resetSignal, lastResetSignalRef.current)) {
      return;
    }

    lastResetSignalRef.current = resetSignal;
    if (searchInputDisabled) {
      applySearchImmediate("", defaultSearchField);
    }
  }, [applySearchImmediate, defaultSearchField, resetSignal, searchInputDisabled]);
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
  table,
}: Readonly<{
  enableExpandAll: boolean;
  expandAllSignal: unknown;
  filter: ReturnType<typeof useTableState>;
  table: Table<Record<string, unknown>>;
}>) {
  const tableRef = useRef(table);

  useEffect(() => {
    tableRef.current = table;
  }, [table]);

  const lastSignalRef = useRef<unknown>(expandAllSignal);

  useEffect(() => {
    if (Object.is(expandAllSignal, lastSignalRef.current)) {
      return;
    }

    lastSignalRef.current = expandAllSignal;
    if (!enableExpandAll || expandAllSignal === null || expandAllSignal === undefined) {
      return;
    }

    filter.setAllExpanded(true);
  }, [enableExpandAll, expandAllSignal, filter]);
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
  const lastSignalRef = useRef<unknown>(collapseAllSignal);

  useEffect(() => {
    if (Object.is(collapseAllSignal, lastSignalRef.current)) {
      return;
    }

    lastSignalRef.current = collapseAllSignal;
    if (!enableExpandAll || collapseAllSignal === null || collapseAllSignal === undefined) {
      return;
    }

    filter.setAllExpanded(false);
  }, [collapseAllSignal, enableExpandAll, filter]);
}

function useSortingResetSignal({
  filter,
  sortingResetSignal,
}: Readonly<{
  filter: ReturnType<typeof useTableState>;
  sortingResetSignal: unknown;
}>) {
  const lastSignalRef = useRef<unknown>(sortingResetSignal);

  useEffect(() => {
    if (Object.is(sortingResetSignal, lastSignalRef.current)) {
      return;
    }

    lastSignalRef.current = sortingResetSignal;
    if (sortingResetSignal === null || sortingResetSignal === undefined) {
      return;
    }

    filter.setSorting([]);
  }, [filter, sortingResetSignal]);
}

function useQueryErrorEffect({
  filter,
  onQueryError,
}: Readonly<{
  filter: ReturnType<typeof useTableState>;
  onQueryError?: (error: unknown) => void;
}>) {
  useEffect(() => {
    if (filter.isError) {
      onQueryError?.(filter.error);
    }
  }, [filter.error, filter.isError, onQueryError]);
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
    <CardHeader>
      <div className="flex items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-lg">
          {title}
          <span className="text-muted-foreground font-normal">
            (&thinsp;{displayCount}&thinsp;)
          </span>
        </CardTitle>
        {enableExpandAll && (
          <Button
            variant="modern"
            size="lg"
            onClick={onToggleExpandAll}
            disabled={disableExpandAll}
            className={
              disableExpandAll ? "text-muted-foreground opacity-60" : ""
            }
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
              (candidate): candidate is number => typeof candidate === "number",
            ) ?? null
          );
        })
        .filter((id): id is number => id !== null),
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
    shouldHandleEvent: realtime?.shouldHandleEvent,
  });

  return {
    handleRealtimeRefresh,
    staleKey,
  };
}

interface FilterTableContentProps {
  emptyText: string;
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
}

// 根据加载态、空态和数据态切换表格主体内容。
function FilterTableContent({
  emptyText,
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
        onIsAtTopChange={setIsTableAtTop}
      />
    </div>
  );
}

function FilterTableRealtimeBanner({
  realtime,
  staleKey,
  onRefresh,
}: Readonly<{
  realtime?: FilterTableProps["realtime"];
  staleKey: string;
  onRefresh: () => void | Promise<void>;
}>) {
  if (!realtime) {
    return null;
  }

  return (
    <StaleBanner
      staleKey={staleKey}
      onRefresh={onRefresh}
    />
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
    />
  );
}

function useValidStatusFilter({
  defaultStatus,
  setStatusFilter,
  statusFilter,
  statusOptions,
}: Readonly<{
  defaultStatus: string;
  setStatusFilter: (value: string) => void;
  statusFilter: string;
  statusOptions: FilterOption[];
}>) {
  useEffect(() => {
    const hasCurrentStatus = statusOptions.some((option) => option.value === statusFilter);
    if (!hasCurrentStatus) {
      setStatusFilter(defaultStatus);
    }
  }, [defaultStatus, setStatusFilter, statusFilter, statusOptions]);
}

function useInitialUrlSearchState({
  defaultSearchField,
  locationSearch,
  searchFieldOptions,
}: Readonly<{
  defaultSearchField: string;
  locationSearch: string;
  searchFieldOptions: SearchFieldOption[];
}>) {
  return useMemo(() => {
    return getInitialUrlSearchState({
      defaultSearchField,
      locationSearch,
      searchFieldOptions,
    });
  }, [defaultSearchField, locationSearch, searchFieldOptions]);
}

function useFilterTableInstance({
  actionRefs,
  customColumns,
  filter,
}: Readonly<{
  actionRefs: ReturnType<typeof useActionRefs>;
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
    getRowCanExpand: () => true,
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
      onEdit: (item) => actionRefs.onEditRef.current?.(item),
      onBorrowSuccess: () => actionRefs.onBorrowSuccessRef.current?.(),
    },
  });
}

// 组合筛选栏、表格状态与数据表格渲染，是 FilterTable 的总入口。
export function FilterTable({
  api,
  queryKey = ["list"],
  tableId,
  customColumns,
  onEdit,
  onBorrowSuccess,
  onQueryError,
  statusOptions = DEFAULT_STATUS_OPTIONS,
  searchFieldOptions = DEFAULT_SEARCH_FIELD_OPTIONS,
  showFuzzySearch = true,
  showMatchMode,
  defaultStatus = "all",
  defaultSearchField = "all",
  pageSize = 50,
  debounceMs = 300,
  extraParams = {},
  suppressSorting,
  searchPlaceholder = "搜索名称、CAS号、位置...",
  searchInputDisabled = false,
  searchInputDisabledReason,
  searchInputDisabledValue,
  onSearchInputDisabledClear,
  searchResetSignal,
  sortingResetSignal,
  expandAllSignal,
  collapseAllSignal,
  searchActions,
  title,
  enableExpandAll = true,
  disableExpandedRowAnimation,
  renderExpandedRow,
  noteField,
  scrollHeight,
  className = "",
  filterClassName,
  cardClassName,
  emptyText = "暂无数据",
  toolbarActions,
  realtime,
}: Readonly<FilterTableProps>) {
  const location = useLocation();
  const actionRefs = useActionRefs({ onEdit, onBorrowSuccess });
  const [isTableAtTop, setIsTableAtTop] = useState(true);

  const initialUrlSearchState = useInitialUrlSearchState({
    defaultSearchField, locationSearch: location.search, searchFieldOptions,
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

  useQueryErrorEffect({ filter, onQueryError });

  useValidStatusFilter({
    defaultStatus,
    setStatusFilter: filter.setStatusFilter,
    statusFilter: filter.statusFilter,
    statusOptions,
  });

  useSearchResetSignal({
    applySearchImmediate: filter.applySearchImmediate,
    defaultSearchField,
    resetSignal: searchResetSignal,
    searchInputDisabled,
  });

  const { handleRealtimeRefresh, staleKey } = useFilterTableRealtime({
    extraParams,
    filter,
    isTableAtTop,
    queryKey,
    realtime,
    searchFieldOptions,
  });

  useLocationSearchSync({
    applySearchImmediate: filter.applySearchImmediate,
    defaultSearchField,
    initialUrlSearchState,
    locationSearch: location.search,
  });

  const table = useFilterTableInstance({ actionRefs, customColumns, filter });

  useExpandedResetOnFilterChange({ enableExpandAll, filter, table });
  useExpandAllSignal({ enableExpandAll, expandAllSignal, filter, table });
  useCollapseAllSignal({ enableExpandAll, collapseAllSignal, filter });
  useSortingResetSignal({ filter, sortingResetSignal });

  const calculatedScrollHeight = useMemo(() => {
    return getScrollHeight(filter.data.length, scrollHeight);
  }, [filter.data.length, scrollHeight]);

  // 当列表已下滚时，阻止“展开全部”，避免用户在中段展开后产生强烈跳动。
  const disableExpandAll = shouldDisableExpandAll(filter.isAllExpanded, isTableAtTop);

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
          />
          <FilterTableRealtimeBanner
            realtime={realtime}
            staleKey={staleKey}
            onRefresh={handleRealtimeRefresh}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default FilterTable;
