import React, { startTransition, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from './Input'
import { Checkbox } from './Checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './Select'
import { Tooltip, TooltipContent, TooltipTrigger } from './Tooltip'
import type { FilterOption, SearchFieldOption } from '@/hooks/useTableState'
import { DEFAULT_STATUS_OPTIONS, DEFAULT_SEARCH_FIELD_OPTIONS } from '@/hooks/useTableState'
import {
  DEFAULT_SEARCH_MATCH_MODE,
  SEARCH_MATCH_MODES,
  type SearchMatchMode,
} from '@/lib/searchMatchMode'

export const SEARCH_MAX_LENGTH = 100
const DEFAULT_SEARCH_FIELD_ALL_VALUE = 'all'

export interface TableFiltersProps {
  searchInput: string
  onSearchInputChange: (value: string) => void
  searchPlaceholder?: string
  
  // 模糊搜索
  fuzzySearch: boolean
  onFuzzySearchChange: (value: boolean) => void
  showFuzzySearch?: boolean
  matchMode?: SearchMatchMode
  onMatchModeChange?: (value: SearchMatchMode) => void
  showMatchMode?: boolean
  
  // 搜索字段
  searchField: string
  onSearchFieldChange: (value: string) => void
  searchFieldOptions?: SearchFieldOption[]
  
  // 状态筛选
  statusFilter: string
  onStatusFilterChange?: (value: string) => void
  statusOptions?: FilterOption[]
  
  className?: string
  actions?: React.ReactNode
}

export interface TableSearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
  inputClassName?: string
  containerClassName?: string
}

function shouldShowExtraControls({
  actions,
  showFuzzySearch,
  showMatchMode,
  showSearchFieldSelect,
  showStatusSelect,
}: Readonly<{
  actions?: React.ReactNode
  showFuzzySearch: boolean
  showMatchMode: boolean
  showSearchFieldSelect: boolean
  showStatusSelect: boolean
}>) {
  return Boolean(
    actions || showFuzzySearch || showMatchMode || showSearchFieldSelect || showStatusSelect
  )
}

function resolveSearchPlaceholder({
  searchField,
  searchFieldOptions,
  searchPlaceholder,
}: Readonly<{
  searchField: string
  searchFieldOptions: SearchFieldOption[]
  searchPlaceholder: string
}>) {
  const normalizedField = searchField.trim()
  if (!normalizedField || normalizedField === DEFAULT_SEARCH_FIELD_ALL_VALUE) {
    return searchPlaceholder
  }

  const selectedOption = searchFieldOptions.find((option) => option.value === normalizedField)
  if (!selectedOption || selectedOption.value === DEFAULT_SEARCH_FIELD_ALL_VALUE) {
    return searchPlaceholder
  }

  const optionLabel = selectedOption.label.trim()
  return optionLabel ? `搜索${optionLabel}...` : searchPlaceholder
}

function TooltipCheckbox({
  children,
  tooltip,
}: Readonly<{
  children: React.ReactNode
  tooltip: React.ReactNode
}>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">
        {typeof tooltip === 'string' ? <p>{tooltip}</p> : tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

function TableFilterExtraControls({
  actions,
  fuzzySearch,
  matchMode,
  onFuzzySearchChange,
  onMatchModeChange,
  onSearchFieldChange,
  onStatusFilterChange,
  searchField,
  searchFieldOptions,
  showFuzzySearch,
  showMatchMode,
  statusFilter,
  statusOptions,
}: Readonly<{
  actions?: React.ReactNode
  fuzzySearch: boolean
  matchMode: SearchMatchMode
  onFuzzySearchChange: (value: boolean) => void
  onMatchModeChange?: (value: SearchMatchMode) => void
  onSearchFieldChange: (value: string) => void
  onStatusFilterChange?: (value: string) => void
  searchField: string
  searchFieldOptions: SearchFieldOption[]
  showFuzzySearch: boolean
  showMatchMode: boolean
  statusFilter: string
  statusOptions: FilterOption[]
}>) {
  const showSearchFieldSelect = searchFieldOptions.length > 1
  const showStatusSelect = statusOptions.length > 0 && Boolean(onStatusFilterChange)
  const canShowMatchMode = showMatchMode && Boolean(onMatchModeChange)
  const showExtraControls = shouldShowExtraControls({
    actions,
    showFuzzySearch,
    showMatchMode: canShowMatchMode,
    showSearchFieldSelect,
    showStatusSelect,
  })

  if (!showExtraControls) {
    return null
  }

  const handleFuzzySearchChange = (checked: boolean) => {
    startTransition(() => {
      onFuzzySearchChange(checked === true)
    })
  }

  const handleMatchModeChange = (value: SearchMatchMode) => {
    startTransition(() => {
      onMatchModeChange?.(value)
    })
  }

  const handleExactSearchChange = (checked: boolean) => {
    const nextMode = checked ? SEARCH_MATCH_MODES.EXACT : SEARCH_MATCH_MODES.CONTAINS
    handleMatchModeChange(nextMode)
  }

  return (
    <div className="flex flex-wrap gap-2 items-center justify-between w-full sm:w-auto">
      {showFuzzySearch && (
        <TooltipCheckbox tooltip="忽略空格、连字符、下划线等格式差异">
          <label className="flex items-center gap-2 text-base cursor-pointer whitespace-nowrap">
            <Checkbox
              checked={fuzzySearch}
              onCheckedChange={handleFuzzySearchChange}
            />
            <span className="text-base pr-2">忽略格式</span>
          </label>
        </TooltipCheckbox>
      )}

      {canShowMatchMode && (
        <TooltipCheckbox
          tooltip={
            <div className="space-y-0.5 text-left">
              <p>完整匹配：只匹配完整字段值</p>
              <p>包含匹配：输入字段片段即可匹配</p>
            </div>
          }
        >
          <label className="flex items-center gap-2 text-base cursor-pointer whitespace-nowrap">
            <Checkbox
              checked={matchMode === SEARCH_MATCH_MODES.EXACT}
              onCheckedChange={handleExactSearchChange}
            />
            <span className="text-base pr-2">完整匹配</span>
          </label>
        </TooltipCheckbox>
      )}

      {showSearchFieldSelect && (
        <Select value={searchField} onValueChange={onSearchFieldChange}>
          <SelectTrigger className="w-1/3 sm:w-30 min-h-10">
            <SelectValue placeholder="全部" />
          </SelectTrigger>
          <SelectContent>
            {searchFieldOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {showStatusSelect && (
        <Select value={statusFilter} onValueChange={onStatusFilterChange}>
          <SelectTrigger className="w-1/3 sm:w-30 min-h-10">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {actions}
    </div>
  )
}

// 把搜索词和状态筛选的空态文案集中在这里，避免每个表格各写一版组合提示。
export function TableEmptyState({
  searchKeyword,
  statusFilter,
  hasFilter,
  matchMode = DEFAULT_SEARCH_MATCH_MODE,
  emptyText = '暂无数据',
  statusOptions = DEFAULT_STATUS_OPTIONS
}: Readonly<{
  searchKeyword?: string
  statusFilter?: string
  hasFilter?: boolean
  matchMode?: SearchMatchMode
  emptyText?: string
  statusOptions?: FilterOption[]
}>) {
  const normalizedKeyword = (searchKeyword ?? '').trim()
  const searchVerb = matchMode === SEARCH_MATCH_MODES.EXACT ? '完整匹配' : '匹配'

  // 根据搜索词与状态筛选生成空状态文案。
  const getMessage = () => {
    if (normalizedKeyword && statusFilter && statusFilter !== 'all') {
      const statusOption = statusOptions.find(opt => opt.value === statusFilter)
      const statusLabel = statusOption?.label || statusFilter
      return `未找到${searchVerb}"${normalizedKeyword}"的"${statusLabel}"记录`
    }

    if (normalizedKeyword) {
      return `未找到${searchVerb}"${normalizedKeyword}"的记录`
    }

    if (hasFilter) {
      return '未找到符合条件的记录'
    }

    return emptyText
  }

  return (
    <div className="text-center py-8 text-muted-foreground">
      {getMessage()}
    </div>
  )
}

// 渲染表格搜索输入框，并处理超长校验与一键清空交互。
export function TableSearchInput({
  value,
  onChange,
  placeholder = '搜索名称、CAS号、位置...',
  maxLength = SEARCH_MAX_LENGTH,
  inputClassName = '',
  containerClassName = 'relative flex-1 min-w-50',
}: Readonly<TableSearchInputProps>) {
  const isSearchTooLong = value.length > maxLength
  const searchErrorText = `不能超过 ${maxLength} 个字符` // 稍微缩短文案
  let inputPaddingClassName = 'pr-3'
  if (isSearchTooLong) {
    // 错误文案和清空按钮会共占右侧空间，不提前留白就会压住输入文本。
    inputPaddingClassName =
      'pr-45 border-destructive! focus-visible:border-destructive! focus-visible:ring-destructive/20!'
  } else if (value) {
    inputPaddingClassName = 'pr-8'
  }

  return (
    <div className={containerClassName}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10 pointer-events-none" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={isSearchTooLong}
        className={`pl-9 text-base w-full inline-flex leading-none outline-none ${inputClassName} ${inputPaddingClassName}`}
      />
      <div className="absolute right-1 top-1 bottom-1 flex items-center bg-transparent z-10 pointer-events-none">
        {isSearchTooLong && (
          <span className="text-sm text-destructive mr-1 whitespace-nowrap pointer-events-auto">
            {searchErrorText}
          </span>
        )}
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-muted-foreground hover:text-foreground shrink-0 p-1 pointer-events-auto flex items-center justify-center mr-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}

export function TableFilters({
  searchInput,
  onSearchInputChange,
  searchPlaceholder = '搜索名称、CAS号、位置...',
  fuzzySearch,
  onFuzzySearchChange,
  showFuzzySearch = true,
  matchMode = DEFAULT_SEARCH_MATCH_MODE,
  onMatchModeChange,
  showMatchMode = true,
  searchField,
  onSearchFieldChange,
  searchFieldOptions = DEFAULT_SEARCH_FIELD_OPTIONS,
  statusFilter,
  onStatusFilterChange,
  statusOptions = DEFAULT_STATUS_OPTIONS,
  className = '',
  actions,
}: Readonly<TableFiltersProps>) {
  // 搜索字段变化时同步改占位文案，减少用户误判当前到底在搜哪一列。
  const resolvedSearchPlaceholder = useMemo(() => {
    return resolveSearchPlaceholder({ searchField, searchFieldOptions, searchPlaceholder })
  }, [searchField, searchFieldOptions, searchPlaceholder])

  return (
    <div className={`flex flex-col sm:flex-row gap-3 items-stretch sm:items-center p-1 ${className}`}>
      <TableSearchInput
        value={searchInput}
        onChange={onSearchInputChange}
        placeholder={resolvedSearchPlaceholder}
      />

      <TableFilterExtraControls
        actions={actions}
        fuzzySearch={fuzzySearch}
        matchMode={matchMode}
        onFuzzySearchChange={onFuzzySearchChange}
        onMatchModeChange={onMatchModeChange}
        onSearchFieldChange={onSearchFieldChange}
        onStatusFilterChange={onStatusFilterChange}
        searchField={searchField}
        searchFieldOptions={searchFieldOptions}
        showFuzzySearch={showFuzzySearch}
        showMatchMode={showMatchMode}
        statusFilter={statusFilter}
        statusOptions={statusOptions}
      />
    </div>
  )
}

export default TableFilters
