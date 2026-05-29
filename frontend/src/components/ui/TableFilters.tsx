import React, { startTransition, useMemo, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
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
import {
  SEARCH_INPUT_MAX_LENGTH,
  getEffectiveSearchMaxLength,
} from '@/lib/searchLimits'
import { cn } from '@/lib/utils'

export const SEARCH_MAX_LENGTH = SEARCH_INPUT_MAX_LENGTH
const DEFAULT_SEARCH_FIELD_ALL_VALUE = 'all'

export interface TableFiltersProps {
  searchInput: string
  onSearchInputChange: (value: string) => void
  searchPlaceholder?: string
  searchInputDisabled?: boolean
  searchInputDisabledReason?: string
  searchInputDisabledValue?: string
  onSearchInputDisabledClear?: () => void
  searchActions?: React.ReactNode
  inlineCompletion?: TableSearchInputProps['inlineCompletion']
  
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
  disabled?: boolean
  disabledReason?: string
  disabledValue?: string
  onDisabledClear?: () => void
  inputClassName?: string
  containerClassName?: string
  inlineCompletion?: InlineCompletionConfig
}

interface InlineCompletionConfig {
  suffix: string | null
  hidden: boolean
  onAccept: () => string
  onDismiss: () => void
}

export function TableLoadingState({
  className,
  label = '加载中',
}: Readonly<{
  className?: string
  label?: string
}>) {
  return (
    <div
      className={cn(
        'flex min-h-[25.5rem] items-center justify-center text-muted-foreground',
        className,
      )}
      role="status"
      aria-label={label}
    >
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  )
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

export function TooltipSelect({
  disabled = false,
  onValueChange,
  options,
  placeholder,
  tooltip,
  value,
}: Readonly<{
  disabled?: boolean
  onValueChange: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  placeholder: string
  tooltip: string
  value: string
}>) {
  const [isSelectOpen, setIsSelectOpen] = useState(false)
  const [isTooltipOpen, setIsTooltipOpen] = useState(false)

  const handleSelectOpenChange = (open: boolean) => {
    setIsSelectOpen(open)
    if (open) {
      setIsTooltipOpen(false)
    }
  }

  const handleValueChange = (nextValue: string) => {
    setIsTooltipOpen(false)
    onValueChange(nextValue)
  }

  return (
    <Tooltip open={!isSelectOpen && isTooltipOpen}>
      <Select
        disabled={disabled}
        value={value}
        onValueChange={handleValueChange}
        onOpenChange={handleSelectOpenChange}
      >
        <TooltipTrigger asChild>
          <SelectTrigger
            className="w-1/3 sm:w-30 min-h-10"
            onPointerEnter={() => setIsTooltipOpen(true)}
            onPointerLeave={() => setIsTooltipOpen(false)}
            onBlur={() => setIsTooltipOpen(false)}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
        </TooltipTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <TooltipContent side="bottom">
        <p>{tooltip}</p>
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
  searchControlsDisabled,
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
  searchControlsDisabled: boolean
  showFuzzySearch: boolean
  showMatchMode: boolean
  statusFilter: string
  statusOptions: FilterOption[]
}>) {
  const showSearchFieldSelect = searchFieldOptions.length > 1
  const showStatusSelect = statusOptions.length > 0 && Boolean(onStatusFilterChange)
  const canShowMatchMode = showMatchMode && Boolean(onMatchModeChange)
  const handleStatusFilterChange = onStatusFilterChange ?? (() => undefined)
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
    if (searchControlsDisabled) {
      return
    }
    startTransition(() => {
      onFuzzySearchChange(checked === true)
    })
  }

  const handleMatchModeChange = (value: SearchMatchMode) => {
    if (searchControlsDisabled) {
      return
    }
    startTransition(() => {
      onMatchModeChange?.(value)
    })
  }

  const handleExactSearchChange = (checked: boolean) => {
    const nextMode = checked ? SEARCH_MATCH_MODES.EXACT : SEARCH_MATCH_MODES.CONTAINS
    handleMatchModeChange(nextMode)
  }

  return (
    <div className="flex flex-wrap gap-2 items-center justify-between shrink-0">
      {showFuzzySearch && (
        <TooltipCheckbox tooltip="忽略空格、连字符、下划线等格式差异">
          <label
            className={cn(
              'flex items-center gap-2 text-base whitespace-nowrap',
              searchControlsDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
            )}
          >
            <Checkbox
              checked={fuzzySearch}
              disabled={searchControlsDisabled}
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
          <label
            className={cn(
              'flex items-center gap-2 text-base whitespace-nowrap',
              searchControlsDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
            )}
          >
            <Checkbox
              checked={matchMode === SEARCH_MATCH_MODES.EXACT}
              disabled={searchControlsDisabled}
              onCheckedChange={handleExactSearchChange}
            />
            <span className="text-base pr-2">完整匹配</span>
          </label>
        </TooltipCheckbox>
      )}

      {showSearchFieldSelect && (
        <TooltipSelect
          disabled={searchControlsDisabled}
          value={searchField}
          onValueChange={onSearchFieldChange}
          options={searchFieldOptions}
          placeholder="全部"
          tooltip="搜索字段"
        />
      )}

      {showStatusSelect && (
        <TooltipSelect
          value={statusFilter}
          onValueChange={handleStatusFilterChange}
          options={statusOptions}
          placeholder="全部状态"
          tooltip="筛选"
        />
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

function getSearchDisplayValue({
  disabled,
  disabledValue,
  value,
}: Readonly<{
  disabled: boolean
  disabledValue?: string
  value: string
}>) {
  return disabled ? (disabledValue ?? value) : value
}

function getSearchInputPaddingClassName({
  canClear,
  isSearchTooLong,
}: Readonly<{
  canClear: boolean
  isSearchTooLong: boolean
}>) {
  if (isSearchTooLong) {
    // 错误文案和清空按钮会共占右侧空间，不提前留白就会压住输入文本。
    return 'pr-45 border-destructive! focus-visible:border-destructive! focus-visible:ring-destructive/20!'
  }
  return canClear ? 'pr-8' : 'pr-3'
}

function getSearchPlaceholder({
  disabled,
  disabledReason,
  placeholder,
}: Readonly<{
  disabled: boolean
  disabledReason?: string
  placeholder: string
}>) {
  return disabled ? (disabledReason ?? placeholder) : placeholder
}

function canClearSearchInput({
  disabled,
  disabledValue,
  onDisabledClear,
  value,
}: Readonly<{
  disabled: boolean
  disabledValue?: string
  onDisabledClear?: () => void
  value: string
}>) {
  return disabled ? Boolean(disabledValue && onDisabledClear) : Boolean(value)
}

function hasActiveInlineCompletion(
  inlineCompletion?: InlineCompletionConfig,
): inlineCompletion is InlineCompletionConfig & { suffix: string } {
  return Boolean(inlineCompletion && !inlineCompletion.hidden && inlineCompletion.suffix)
}

function acceptInlineCompletion({
  inlineCompletion,
  onChange,
  value,
}: Readonly<{
  inlineCompletion: InlineCompletionConfig
  onChange: (value: string) => void
  value: string
}>) {
  const accepted = inlineCompletion.onAccept()
  if (accepted !== value) {
    onChange(accepted)
  }
}

function isCaretAtSearchEnd(input: HTMLInputElement, value: string) {
  return input.selectionStart === value.length && input.selectionEnd === value.length
}

function handleInlineCompletionKeyDown(
  event: React.KeyboardEvent<HTMLInputElement>,
  params: Readonly<{
    inlineCompletion?: InlineCompletionConfig
    onChange: (value: string) => void
    value: string
  }>,
) {
  const { inlineCompletion, onChange, value } = params
  if (!hasActiveInlineCompletion(inlineCompletion)) return

  if (event.key === 'Escape') {
    event.preventDefault()
    inlineCompletion.onDismiss()
    return
  }

  if (event.key === 'Tab') {
    event.preventDefault()
    acceptInlineCompletion({ inlineCompletion, onChange, value })
    return
  }

  if (event.key === 'ArrowRight' && isCaretAtSearchEnd(event.currentTarget, value)) {
    event.preventDefault()
    acceptInlineCompletion({ inlineCompletion, onChange, value })
  }
}

function SearchInputIcon({
  showDisabledValueHint,
}: Readonly<{
  showDisabledValueHint: boolean
}>) {
  return (
    <Search
      className={cn(
        'absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 pointer-events-none',
        showDisabledValueHint
          ? 'text-gray-500 dark:text-gray-400'
          : 'text-muted-foreground',
      )}
    />
  )
}

function InlineCompletionGhost({
  inlineCompletion,
  value,
  visible,
}: Readonly<{
  inlineCompletion?: InlineCompletionConfig
  value: string
  visible: boolean
}>) {
  if (!visible) return null

  return (
    <div
      aria-hidden
      className={cn(
        'absolute inset-0 z-[5] pointer-events-none overflow-hidden',
        'flex items-center',
      )}
    >
      <span className="invisible whitespace-pre pl-9 text-base leading-none">
        {value}
      </span>
      <span className="text-muted-foreground/40 whitespace-pre text-base leading-none select-none">
        {inlineCompletion?.suffix}
      </span>
    </div>
  )
}

function SearchInputActions({
  canClear,
  disabled,
  isSearchTooLong,
  onClear,
  searchErrorText,
}: Readonly<{
  canClear: boolean
  disabled: boolean
  isSearchTooLong: boolean
  onClear: () => void
  searchErrorText: string
}>) {
  return (
    <div className="absolute right-1 top-1 bottom-1 flex items-center bg-transparent z-10 pointer-events-none">
      {isSearchTooLong && (
        <span className="text-sm text-destructive mr-1 whitespace-nowrap pointer-events-auto">
          {searchErrorText}
        </span>
      )}
      {canClear && (
        <button
          type="button"
          aria-label={disabled ? '清除结构筛选' : '清空搜索'}
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground shrink-0 p-1 pointer-events-auto flex items-center justify-center mr-0.5"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

// 渲染表格搜索输入框，并处理超长校验与一键清空交互。
export function TableSearchInput({
  value,
  onChange,
  placeholder = '搜索名称、CAS号、位置...',
  maxLength = SEARCH_MAX_LENGTH,
  disabled = false,
  disabledReason,
  disabledValue,
  onDisabledClear,
  inputClassName = '',
  containerClassName = 'relative flex-1 min-w-70',
  inlineCompletion,
}: Readonly<TableSearchInputProps>) {
  const displayValue = getSearchDisplayValue({ disabled, disabledValue, value })
  const isSearchTooLong = !disabled && value.length > maxLength
  const canClear = canClearSearchInput({ disabled, disabledValue, onDisabledClear, value })
  const searchErrorText = `不能超过 ${maxLength} 个字符` // 稍微缩短文案
  const inputPaddingClassName = getSearchInputPaddingClassName({ canClear, isSearchTooLong })
  const resolvedPlaceholder = getSearchPlaceholder({ disabled, disabledReason, placeholder })
  const showDisabledValueHint = disabled && Boolean(disabledValue)
  const showGhost = hasActiveInlineCompletion(inlineCompletion) && !disabled && value.length > 0
  const handleClear = () => {
    if (disabled) {
      onDisabledClear?.()
      return
    }
    onChange('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    handleInlineCompletionKeyDown(e, { inlineCompletion, onChange, value })
  }

  return (
    <div className={containerClassName} title={disabled ? disabledReason : undefined}>
      <SearchInputIcon showDisabledValueHint={showDisabledValueHint} />
      <InlineCompletionGhost
        inlineCompletion={inlineCompletion}
        value={value}
        visible={showGhost}
      />
      <Input
        placeholder={resolvedPlaceholder}
        value={displayValue}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-invalid={isSearchTooLong}
        className={cn(
          'pl-9 text-base w-full inline-flex leading-none outline-none',
          showDisabledValueHint
            && 'bg-gray-100! border-gray-300! text-gray-700! disabled:opacity-100! dark:bg-gray-800/60! dark:border-gray-700! dark:text-gray-300!',
          inputClassName,
          inputPaddingClassName,
        )}
      />
      <SearchInputActions
        canClear={canClear}
        disabled={disabled}
        isSearchTooLong={isSearchTooLong}
        onClear={handleClear}
        searchErrorText={searchErrorText}
      />
    </div>
  )
}

export function TableFilters({
  searchInput,
  onSearchInputChange,
  searchPlaceholder = '搜索名称、CAS号、位置...',
  searchInputDisabled = false,
  searchInputDisabledReason,
  searchInputDisabledValue,
  onSearchInputDisabledClear,
  searchActions,
  inlineCompletion,
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
    <div className={`flex flex-wrap gap-3 items-center ${className}`}>
      <div className="flex min-w-70 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <TableSearchInput
          value={searchInput}
          onChange={onSearchInputChange}
          maxLength={getEffectiveSearchMaxLength(searchInput, searchField)}
          placeholder={resolvedSearchPlaceholder}
          disabled={searchInputDisabled}
          disabledReason={searchInputDisabledReason}
          disabledValue={searchInputDisabledValue}
          onDisabledClear={onSearchInputDisabledClear}
          inlineCompletion={inlineCompletion}
        />
        {searchActions && (
          <div className="flex items-center">
            {searchActions}
          </div>
        )}
      </div>

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
        searchControlsDisabled={searchInputDisabled}
        showFuzzySearch={showFuzzySearch}
        showMatchMode={showMatchMode}
        statusFilter={statusFilter}
        statusOptions={statusOptions}
      />
    </div>
  )
}

export default TableFilters
