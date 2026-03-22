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
const ENGLISH_LETTER_REGEX = /[A-Za-z]/g
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

const shouldStartSearch = (value: string): boolean => {
  const trimmed = value.trim()
  if (!trimmed) return false

  if (HANZI_REGEX.test(trimmed)) {
    return true
  }

  const englishCharCount = (trimmed.match(ENGLISH_LETTER_REGEX) ?? []).length
  return englishCharCount >= 2
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
}: Readonly<AutocompleteProps>) {
  const [open, setOpen] = React.useState(false)
  const [inputValue, setInputValue] = React.useState(value)
  const [debouncedInputValue, setDebouncedInputValue] = React.useState(value)
  const inputRef = React.useRef<HTMLInputElement>(null)
  // 选中建议项后抑制搜索，防止下拉菜单闪烁
  const justSelectedRef = React.useRef(false)
  const canSearch = React.useMemo(
    () => shouldStartSearch(debouncedInputValue),
    [debouncedInputValue]
  )

  // 监听外部 value 的变化（保证组件内部状态同步更新）
  React.useEffect(() => {
    setInputValue(value)
    setDebouncedInputValue(value)
  }, [value])

  // 搜索输入防抖，避免每次按键都触发筛选
  React.useEffect(() => {
    // 选中建议项后跳过防抖更新，避免触发多余的搜索导致闪烁
    if (justSelectedRef.current) {
      justSelectedRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      setDebouncedInputValue(inputValue)
    }, 100)
    return () => window.clearTimeout(timer)
  }, [inputValue])

  // 过滤建议列表 (忽略大小写)
  const filteredOptions = React.useMemo(() => {
    if (!canSearch) return []
    return options.filter((opt) => isOptionMatched(opt, debouncedInputValue))
  }, [options, debouncedInputValue, canSearch])

  // 处理输入变化与双字符触发逻辑
  const handleValueChange = (val: string) => {
    setInputValue(val)
    onChange?.(val)

    setOpen(shouldStartSearch(val))
  }

  // 直接处理 Input 的 onChange 事件
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    handleValueChange(val)
  }

  // 处理选中建议
  const handleSelect = (option: AutocompleteOption) => {
    justSelectedRef.current = true
    setOpen(false)
    setInputValue(option.label)
    setDebouncedInputValue(option.label)
    onChange?.(option.label)
    // 选中后将焦点交还给输入框
    inputRef.current?.focus()
  }

  return (
    <Command
      // 关闭 cmdk 内置的过滤，因为我们上面使用了自定义的 filteredOptions 逻辑
      shouldFilter={false}
      className={cn('relative w-full', className)}
    >
      <Popover open={open && canSearch && filteredOptions.length > 0} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {/* Command.Input 会接管键盘的上下箭头和回车事件 */}
          <Command.Input
            asChild
            value={inputValue}
          >
            <Input
              ref={inputRef}
              placeholder={placeholder}
              disabled={disabled}
              className="w-full"
              onChange={handleInputChange}
              // 点击输入框时，满足搜索门槛才展开
              onClick={() => shouldStartSearch(inputValue) && setOpen(true)}
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
