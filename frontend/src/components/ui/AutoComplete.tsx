import * as React from 'react'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverPortal,
} from '@radix-ui/react-popover'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
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
  onSelect?: (option: AutocompleteOption) => void
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

interface AutocompleteMenuProps {
  activeIndex: number
  highlight: string
  onActiveIndexChange: (index: number) => void
  onSelect: (option: AutocompleteOption) => void
  options: AutocompleteOption[]
}

interface AutocompletePopupProps {
  activeIndex: number
  highlight: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onActiveIndexChange: (index: number) => void
  onSelect: (option: AutocompleteOption) => void
  options: AutocompleteOption[]
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

function AutocompleteMenu({
  activeIndex,
  highlight,
  onActiveIndexChange,
  onSelect,
  options,
}: Readonly<AutocompleteMenuProps>) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const [canScrollUp, setCanScrollUp] = React.useState(false)
  const [canScrollDown, setCanScrollDown] = React.useState(false)

  React.useEffect(() => {
    const list = listRef.current
    if (!list) return

    const updateScrollButtons = () => {
      setCanScrollUp(list.scrollTop > 0)
      setCanScrollDown(Math.ceil(list.scrollTop + list.clientHeight) < list.scrollHeight)
    }

    updateScrollButtons()
    const frame = window.requestAnimationFrame(updateScrollButtons)
    const observer = new ResizeObserver(updateScrollButtons)
    observer.observe(list)
    observer.observe(list.firstElementChild ?? list)
    list.addEventListener('scroll', updateScrollButtons, { passive: true })
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      list.removeEventListener('scroll', updateScrollButtons)
    }
  }, [options.length])

  React.useEffect(() => {
    const activeOption = listRef.current?.querySelector<HTMLElement>(
      `[data-autocomplete-index="${activeIndex}"]`
    )
    activeOption?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const scrollByPage = (direction: -1 | 1) => {
    const list = listRef.current
    if (!list) return
    list.scrollBy({ top: direction * list.clientHeight * 0.75, behavior: 'smooth' })
  }

  return (
    <>
      {canScrollUp && (
        <button
          type="button"
          aria-label="向上滚动选项"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => scrollByPage(-1)}
          className="flex shrink-0 cursor-default items-center justify-center py-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <ChevronUpIcon className="size-4" />
        </button>
      )}
      <div ref={listRef} role="listbox" className="no-scrollbar min-h-0 overflow-y-auto p-1">
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            data-autocomplete-index={index}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onActiveIndexChange(index)}
            onClick={() => onSelect(option)}
            className={cn(
              'relative flex w-full cursor-default items-center rounded-sm px-2 py-1.5 text-left text-base outline-hidden select-none',
              'hover:bg-accent hover:text-accent-foreground',
              index === activeIndex && 'bg-accent text-accent-foreground dark:bg-input'
            )}
          >
            <HighlightText text={option.label} highlight={highlight} fuzzy />
          </button>
        ))}
      </div>
      {canScrollDown && (
        <button
          type="button"
          aria-label="向下滚动选项"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => scrollByPage(1)}
          className="flex shrink-0 cursor-default items-center justify-center py-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <ChevronDownIcon className="size-4" />
        </button>
      )}
    </>
  )
}

function AutocompletePopup({
  activeIndex,
  highlight,
  inputRef,
  onActiveIndexChange,
  onSelect,
  options,
}: Readonly<AutocompletePopupProps>) {
  return (
    <PopoverPortal>
      <PopoverContent
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (event.target === inputRef.current) event.preventDefault()
        }}
        onWheelCapture={(event) => event.stopPropagation()}
        onTouchMoveCapture={(event) => event.stopPropagation()}
        align="start"
        sideOffset={4}
        collisionPadding={8}
        className={cn(
          'relative z-50 flex max-h-[min(16rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md bg-popover text-popover-foreground shadow-md dark:border dark:border-border',
          'origin-(--radix-popover-content-transform-origin)',
          'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95'
        )}
      >
        <AutocompleteMenu
          activeIndex={activeIndex}
          highlight={highlight}
          options={options}
          onActiveIndexChange={onActiveIndexChange}
          onSelect={onSelect}
        />
      </PopoverContent>
    </PopoverPortal>
  )
}

export function Autocomplete({
  options,
  value = '',
  onChange,
  onSelect,
  placeholder,
  disabled,
  className,
  minSearchLength = 1,
  showAllOnFocus = false,
}: Readonly<AutocompleteProps>) {
  const [open, setOpen] = React.useState(false)
  const [isInputFocused, setIsInputFocused] = React.useState(false)
  const [inputValue, setInputValue] = React.useState(value)
  const [debouncedInputValue, setDebouncedInputValue] = React.useState(value)
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [dismissedWhileFocused, setDismissedWhileFocused] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const justSelectedRef = React.useRef(false)
  const canSearch = React.useMemo(
    () => shouldStartSearch(debouncedInputValue, minSearchLength),
    [debouncedInputValue, minSearchLength]
  )
  const shouldShowAllOptions = shouldShowAutocompleteOptionsOnFocus(
    showAllOnFocus,
    isInputFocused,
    inputValue
  ) && !dismissedWhileFocused
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
  const shouldOpen = shouldOpenAutocompletePopover({
    open,
    canSearch,
    filteredOptionsLength: filteredOptions.length,
    shouldShowAllOptionsOnFocus: shouldShowAllOptions,
  })
  const handleValueChange = (val: string) => {
    setInputValue(val)
    onChange?.(val)
    setActiveIndex(0)
    setDismissedWhileFocused(false)
    setOpen((showAllOnFocus && isInputFocused) || shouldStartSearch(val, minSearchLength))
  }
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    handleValueChange(val)
  }
  const handleInputFocus = () => {
    setIsInputFocused(true)
    setDismissedWhileFocused(false)
    if (showAllOnFocus || shouldStartSearch(inputValue, minSearchLength)) {
      setOpen(true)
    }
  }
  const handleSelect = (option: AutocompleteOption) => {
    justSelectedRef.current = true
    setOpen(false)
    setIsInputFocused(true)
    setInputValue(option.label)
    setDebouncedInputValue(option.label)
    onChange?.(option.label)
    onSelect?.(option)
    inputRef.current?.focus()
  }
  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setDismissedWhileFocused(true)
      setOpen(false)
      return
    }

    if (event.nativeEvent.isComposing || filteredOptions.length === 0) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((current) =>
        (current + direction + filteredOptions.length) % filteredOptions.length
      )
      setOpen(true)
      return
    }

    if (event.key === 'Enter' && shouldOpen) {
      event.preventDefault()
      handleSelect(filteredOptions[activeIndex] ?? filteredOptions[0])
    }
  }
  return (
    <Popover
      open={shouldOpen}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          if (document.activeElement === inputRef.current) {
            setDismissedWhileFocused(true)
          } else {
            setIsInputFocused(false)
            setDismissedWhileFocused(false)
          }
        }
      }}
    >
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          value={inputValue}
          placeholder={placeholder}
          disabled={disabled}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shouldOpen}
          className={cn('w-full', className)}
          onChange={handleInputChange}
          onBlur={() => setIsInputFocused(false)}
          onClick={() => {
            setIsInputFocused(true)
            setDismissedWhileFocused(false)
            setOpen(true)
          }}
          onFocus={handleInputFocus}
          onKeyDown={handleInputKeyDown}
        />
      </PopoverAnchor>
      <AutocompletePopup
        activeIndex={activeIndex}
        highlight={debouncedInputValue}
        inputRef={inputRef}
        options={filteredOptions}
        onActiveIndexChange={setActiveIndex}
        onSelect={handleSelect}
      />
    </Popover>
  )
}
