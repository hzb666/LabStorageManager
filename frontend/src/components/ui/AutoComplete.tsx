import * as React from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import { pinyin as toPinyin } from 'pinyin-pro'
import { Input } from './Input'
import { HighlightText } from './HighlightText'
import { cn } from '@/lib/utils'

export interface AutocompleteOption {
  label: string
  value: string
}

interface AutocompleteProps {
  options: AutocompleteOption[]
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  minSearchLength?: number
  showAllOnFocus?: boolean
}

interface OptionSearchIndex {
  normalizedLabel: string
  fullPinyin: string
  initials: string
}

interface CachedOptionSearchIndex {
  index: OptionSearchIndex
  expiresAt: number
}

const HANZI_REGEX = /[\u3400-\u9fff]/
const SEARCH_SEPARATOR_REGEX = /[\s_.-]+/g
const OPTION_SEARCH_INDEX_CACHE_MAX_SIZE = 500
const OPTION_SEARCH_INDEX_CACHE_TTL_MS = 10 * 60 * 1000
const optionSearchIndexCache = new Map<string, CachedOptionSearchIndex>()

const pruneOptionSearchIndexCache = (now: number): void => {
  for (const [label, cached] of optionSearchIndexCache) {
    if (cached.expiresAt <= now) {
      optionSearchIndexCache.delete(label)
    }
  }

  while (optionSearchIndexCache.size > OPTION_SEARCH_INDEX_CACHE_MAX_SIZE) {
    const oldestEntry = optionSearchIndexCache.keys().next()
    if (oldestEntry.done) break
    optionSearchIndexCache.delete(oldestEntry.value)
  }
}

const normalizeSearchKeyword = (value: string) =>
  value.trim().replaceAll(SEARCH_SEPARATOR_REGEX, '').toLowerCase()

const shouldStartSearch = (value: string, minSearchLength: number): boolean => {
  const trimmed = value.trim()
  if (!trimmed) return false

  if (HANZI_REGEX.test(trimmed)) {
    return true
  }

  return normalizeSearchKeyword(trimmed).length >= minSearchLength
}

const shouldShowAutocompleteOptionsOnFocus = (
  showAllOnFocus: boolean,
  isInputFocused: boolean,
  inputValue: string,
) => showAllOnFocus && isInputFocused && !normalizeSearchKeyword(inputValue)

const shouldOpenAutocompletePopover = (params: {
  open: boolean
  canSearch: boolean
  filteredOptionsLength: number
  shouldShowAllOptionsOnFocus: boolean
}) => {
  const { open, canSearch, filteredOptionsLength, shouldShowAllOptionsOnFocus } = params
  return (
    (open || shouldShowAllOptionsOnFocus) &&
    (canSearch || shouldShowAllOptionsOnFocus) &&
    filteredOptionsLength > 0
  )
}

const getOptionSearchIndex = (label: string): OptionSearchIndex => {
  const now = Date.now()
  const cached = optionSearchIndexCache.get(label)
  if (cached && cached.expiresAt > now) {
    // 命中后续期并刷新顺序，避免高频键被淘汰
    optionSearchIndexCache.delete(label)
    optionSearchIndexCache.set(label, {
      index: cached.index,
      expiresAt: now + OPTION_SEARCH_INDEX_CACHE_TTL_MS,
    })
    return cached.index
  }
  if (cached) {
    optionSearchIndexCache.delete(label)
  }

  const pinyinArray = toPinyin(label, { toneType: 'none', type: 'array' })
  const pinyinTokens = (Array.isArray(pinyinArray) ? pinyinArray : [String(pinyinArray)])
    .map((token) => normalizeSearchKeyword(String(token)))
    .filter(Boolean)

  const index = {
    normalizedLabel: normalizeSearchKeyword(label),
    fullPinyin: pinyinTokens.join(''),
    initials: pinyinTokens.map((token) => token[0]).join(''),
  }

  optionSearchIndexCache.set(label, {
    index,
    expiresAt: now + OPTION_SEARCH_INDEX_CACHE_TTL_MS,
  })
  pruneOptionSearchIndexCache(now)
  return index
}

const isOptionMatched = (option: AutocompleteOption, input: string): boolean => {
  const normalizedInput = normalizeSearchKeyword(input)
  if (!normalizedInput) return false

  const index = getOptionSearchIndex(option.label)
  return (
    index.normalizedLabel.includes(normalizedInput) ||
    index.fullPinyin.includes(normalizedInput) ||
    index.initials.includes(normalizedInput)
  )
}

export function Autocomplete({
  options,
  value = '',
  onChange,
  placeholder,
  disabled,
  className,
  minSearchLength = 2,
  showAllOnFocus = false,
}: Readonly<AutocompleteProps>) {
  const [open, setOpen] = React.useState(false)
  const [isInputFocused, setIsInputFocused] = React.useState(false)
  const [inputValue, setInputValue] = React.useState(value)
  const [debouncedInputValue, setDebouncedInputValue] = React.useState(value)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const justSelectedRef = React.useRef(false)
  const canSearch = React.useMemo(
    () => shouldStartSearch(debouncedInputValue, minSearchLength),
    [debouncedInputValue, minSearchLength]
  )
  const shouldShowAllOptions = shouldShowAutocompleteOptionsOnFocus(
    showAllOnFocus,
    isInputFocused,
    debouncedInputValue
  )
  React.useEffect(() => {
    setInputValue(value)
    setDebouncedInputValue(value)
  }, [value])
  React.useEffect(() => {
    if (justSelectedRef.current) {
      justSelectedRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      setDebouncedInputValue(inputValue)
    }, 100)
    return () => window.clearTimeout(timer)
  }, [inputValue])
  const filteredOptions = React.useMemo(() => {
    if (shouldShowAllOptions) return options
    if (!canSearch) return []
    return options.filter((opt) => isOptionMatched(opt, debouncedInputValue))
  }, [options, debouncedInputValue, canSearch, shouldShowAllOptions])
  const handleValueChange = (val: string) => {
    setInputValue(val)
    onChange?.(val)
    setOpen((showAllOnFocus && isInputFocused) || shouldStartSearch(val, minSearchLength))
  }
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    handleValueChange(val)
  }
  const handleSelect = (option: AutocompleteOption) => {
    justSelectedRef.current = true
    setOpen(false)
    setInputValue(option.label)
    setDebouncedInputValue(option.label)
    onChange?.(option.label)
    inputRef.current?.focus()
  }
  const handleInputFocus = () => {
    setIsInputFocused(true)
    if (showAllOnFocus || shouldStartSearch(inputValue, minSearchLength)) {
      setOpen(true)
    }
  }
  const handleInputBlur = () => {
    setIsInputFocused(false)
    setOpen(false)
  }

  return (
    <Command shouldFilter={false} className={cn('relative w-full', className)}>
      <Popover
        open={shouldOpenAutocompletePopover({
          open,
          canSearch,
          filteredOptionsLength: filteredOptions.length,
          shouldShowAllOptionsOnFocus: shouldShowAllOptions,
        })}
        onOpenChange={setOpen}
      >
        <PopoverTrigger asChild>
          <Command.Input asChild value={inputValue}>
            <Input
              ref={inputRef}
              placeholder={placeholder}
              disabled={disabled}
              className="w-full"
              onChange={handleInputChange}
              onClick={() => (
                showAllOnFocus ||
                shouldStartSearch(inputValue, minSearchLength)
              ) && setOpen(true)}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
            />
          </Command.Input>
        </PopoverTrigger>

        <PopoverContent
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            'w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] relative z-50 max-h-72 origin-(--radix-popover-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1'
          )}
          sideOffset={4}
          align="start"
          asChild // 将 PopoverContent 作为 Command.List 的直接容器
        >
          <Command.List className="scroll-my-1 overflow-x-hidden overflow-y-auto p-1">
            <div className="flex flex-col">
              {filteredOptions.map((option) => (
                <Command.Item
                  key={option.value}
                  // value 属性供 cmdk 内部追踪状态使用
                  value={option.value}
                  onSelect={() => handleSelect(option)}
                  // 防止 mousedown 时输入框失焦
                  onMouseDown={(e) => e.preventDefault()}
                  className={cn(
                    'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 px-2 text-base outline-hidden select-none',
                    'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
                    'aria-selected:bg-accent aria-selected:text-accent-foreground',
                    'dark:data-[selected=true]:bg-input dark:data-[selected=true]:text-accent-foreground',
                    'dark:aria-selected:bg-input dark:aria-selected:text-accent-foreground',
                    'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50'
                  )}
                >
                  <span className="min-w-0">
                    <HighlightText text={option.label} highlight={debouncedInputValue} fuzzy />
                  </span>
                </Command.Item>
              ))}
            </div>
          </Command.List>
        </PopoverContent>
      </Popover>
    </Command>
  )
}
