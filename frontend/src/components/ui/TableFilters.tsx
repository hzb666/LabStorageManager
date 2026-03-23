/**
 * 表格筛选组件
 * 独立渲染筛选栏和空状态提示
 */
import React, { startTransition, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from './Input'
import { Checkbox } from './Checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './Select'
import type { FilterOption, SearchFieldOption } from '@/hooks/useTableState'
import { DEFAULT_STATUS_OPTIONS, DEFAULT_SEARCH_FIELD_OPTIONS, SEARCH_MAX_LENGTH } from '@/hooks/useTableState'

export { SEARCH_MAX_LENGTH }

const DEFAULT_SEARCH_FIELD_ALL_VALUE = 'all'

// ============================================================================
// 类型定义
// ============================================================================

export interface TableFiltersProps {
  // 搜索相关
  searchInput: string
  onSearchInputChange: (value: string) => void
  searchPlaceholder?: string
  
  // 模糊搜索
  fuzzySearch: boolean
  onFuzzySearchChange: (value: boolean) => void
  showFuzzySearch?: boolean
  
  // 搜索字段
  searchField: string
  onSearchFieldChange: (value: string) => void
  searchFieldOptions?: SearchFieldOption[]
  
  // 状态筛选
  statusFilter: string
  onStatusFilterChange?: (value: string) => void
  statusOptions?: FilterOption[]
  
  // className
  className?: string
}

export interface TableSearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
  inputClassName?: string
  containerClassName?: string
}

// ============================================================================
// 空状态组件（暴露给 FilterTable 使用）
// ============================================================================

export function TableEmptyState({
  searchKeyword,
  statusFilter,
  hasFilter,
  emptyText = '暂无数据',
  statusOptions = DEFAULT_STATUS_OPTIONS
}: Readonly<{
  searchKeyword?: string
  statusFilter?: string
  hasFilter?: boolean
  emptyText?: string
  statusOptions?: FilterOption[]
}>) {
  const normalizedKeyword = (searchKeyword ?? '').trim()

  const getMessage = () => {
    if (normalizedKeyword && statusFilter && statusFilter !== 'all') {
      // 从 statusOptions 中查找对应的中文标签
      const statusOption = statusOptions.find(opt => opt.value === statusFilter)
      const statusLabel = statusOption?.label || statusFilter
      return `未找到匹配"${normalizedKeyword}"的"${statusLabel}"记录`
    }

    if (normalizedKeyword) {
      return `未找到匹配"${normalizedKeyword}"的记录`
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

  return (
    <div className={containerClassName}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10 pointer-events-none" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={isSearchTooLong}
        className={`pl-9 text-base w-full inline-flex leading-none outline-none ${inputClassName} ${
          isSearchTooLong
            ? 'pr-44 !border-destructive focus-visible:!border-destructive focus-visible:!ring-destructive/20'
            : value
              ? 'pr-8'
              : 'pr-3'
        }`}
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

// ============================================================================
// 主组件 - 仅渲染过滤控件，不包裹子元素
// ============================================================================

export function TableFilters({
  searchInput,
  onSearchInputChange,
  searchPlaceholder = '搜索名称、CAS号、位置...',
  fuzzySearch,
  onFuzzySearchChange,
  showFuzzySearch = true,
  searchField,
  onSearchFieldChange,
  searchFieldOptions = DEFAULT_SEARCH_FIELD_OPTIONS,
  statusFilter,
  onStatusFilterChange,
  statusOptions = DEFAULT_STATUS_OPTIONS,
  className = '',
}: Readonly<TableFiltersProps>) {
  const handleSearchChange = (value: string) => {
    onSearchInputChange(value)
  }

  const handleFuzzySearchChange = (checked: boolean) => {
    startTransition(() => {
      onFuzzySearchChange(checked === true)
    })
  }

  const resolvedSearchPlaceholder = useMemo(() => {
    const normalizedField = searchField.trim()
    if (!normalizedField || normalizedField === DEFAULT_SEARCH_FIELD_ALL_VALUE) {
      return searchPlaceholder
    }

    const selectedOption = searchFieldOptions.find((option) => option.value === normalizedField)
    if (!selectedOption || selectedOption.value === DEFAULT_SEARCH_FIELD_ALL_VALUE) {
      return searchPlaceholder
    }

    const optionLabel = selectedOption.label.trim()
    if (!optionLabel) {
      return searchPlaceholder
    }

    return `搜索${optionLabel}...`
  }, [searchField, searchFieldOptions, searchPlaceholder])

  return (
    <div className={`flex flex-col sm:flex-row gap-3 items-stretch sm:items-center ${className}`}>
      {/* 搜索输入框 */}
      <TableSearchInput
        value={searchInput}
        onChange={handleSearchChange}
        placeholder={resolvedSearchPlaceholder}
      />
      
      {/* 筛选控件 */}
      <div className="flex flex-wrap gap-2 items-center justify-between w-full sm:w-auto">
        {/* 模糊搜索开关 */}
        {showFuzzySearch && (
          <label className="flex items-center gap-2 text-base cursor-pointer whitespace-nowrap">
            <Checkbox
              checked={fuzzySearch}
              onCheckedChange={handleFuzzySearchChange}
            />
            <span className="text-base pr-2">模糊搜索</span>
          </label>
        )}

        {/* 搜索字段选择 */}
        {searchFieldOptions && searchFieldOptions.length > 1 && (
          <Select value={searchField} onValueChange={(val) => { onSearchFieldChange(val) }}>
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

        {/* 状态筛选选择 */}
        {statusOptions && statusOptions.length > 0 && onStatusFilterChange && (
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
      </div>
    </div>
  )
}

export default TableFilters
