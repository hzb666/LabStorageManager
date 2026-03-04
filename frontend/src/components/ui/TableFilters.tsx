/**
 * 表格筛选组件
 * 独立渲染筛选栏和空状态提示
 */
import React, { startTransition } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from './Input'
import { Checkbox } from './Checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './Select'
import type { FilterOption, SearchFieldOption } from '@/hooks/useTableState'
import { DEFAULT_STATUS_OPTIONS, DEFAULT_SEARCH_FIELD_OPTIONS } from '@/hooks/useTableState'

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

// ============================================================================
// 空状态组件（暴露给 FilterTable 使用）
// ============================================================================

export function TableEmptyState({
  searchKeyword,
  statusFilter,
  hasFilter,
  emptyText = '暂无数据'
}: {
  searchKeyword?: string
  statusFilter?: string
  hasFilter?: boolean
  emptyText?: string
}) {
  const getMessage = () => {
    if (searchKeyword && statusFilter && statusFilter !== 'all') {
      const statusLabel = 
        statusFilter === 'in_stock' ? '在库' : 
        statusFilter === 'not_in_stock' ? '没有' : 
        statusFilter === 'borrowed' ? '借出' : 
        statusFilter === 'consumed' ? '已用完' : statusFilter
      return `未找到匹配"${searchKeyword}"的"${statusLabel}"记录`
    }
    
    if (searchKeyword) {
      return `未找到匹配"${searchKeyword}"的记录`
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
}: TableFiltersProps) {

  const handleSearchChange = (value: string) => {
    onSearchInputChange(value)
  }

  const handleFuzzySearchChange = (checked: boolean) => {
    startTransition(() => {
      onFuzzySearchChange(checked === true)
    })
  }

  return (
    <div className={`flex flex-col sm:flex-row gap-3 items-stretch sm:items-center ${className}`}>
      {/* 搜索输入框 */}
      <div className="relative flex-1 min-w-50">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
        <Input
          placeholder={searchPlaceholder}
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-9 pr-8 text-base w-full inline-flex leading-none"
        />
        {searchInput && (
          <button
            onClick={() => handleSearchChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      
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
            <SelectTrigger className="w-30 min-h-10">
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
            <SelectTrigger className="w-30 min-h-10">
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