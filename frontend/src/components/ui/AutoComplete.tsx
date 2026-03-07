import * as React from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import { Input } from './Input'
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

export function Autocomplete({
  options,
  value = '',
  onChange,
  placeholder,
  disabled,
  className,
}: AutocompleteProps) {
  const [open, setOpen] = React.useState(false)
  const [inputValue, setInputValue] = React.useState(value)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // 监听外部 value 的变化（保证组件内部状态同步更新）
  React.useEffect(() => {
    setInputValue(value)
  }, [value])

  // 过滤建议列表 (忽略大小写)
  const filteredOptions = React.useMemo(() => {
    if (!inputValue) return []
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(inputValue.toLowerCase())
    )
  }, [options, inputValue])

  // 处理输入变化与双字符触发逻辑
  const handleValueChange = (val: string) => {
    setInputValue(val)
    onChange?.(val)

    // 输入字符 >= 2 时才打开下拉面板
    if (val.length >= 2) {
      setOpen(true)
    } else {
      setOpen(false)
    }
  }

  // 直接处理 Input 的 onChange 事件
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInputValue(val)
    onChange?.(val)
    
    if (val.length >= 2) {
      setOpen(true)
    } else {
      setOpen(false)
    }
  }

  // 处理选中建议
  const handleSelect = (option: AutocompleteOption) => {
    setInputValue(option.label)
    onChange?.(option.label)
    setOpen(false)
    // 选中后将焦点交还给输入框
    inputRef.current?.focus()
  }

  return (
    <Command
      // 关闭 cmdk 内置的过滤，因为我们上面使用了自定义的 filteredOptions 逻辑
      shouldFilter={false}
      className={cn('relative w-full', className)}
    >
      <Popover open={open && filteredOptions.length > 0} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {/* Command.Input 会接管键盘的上下箭头和回车事件 */}
          <Command.Input
            asChild
            value={inputValue}
            onValueChange={handleValueChange}
          >
            <Input
              ref={inputRef}
              placeholder={placeholder}
              disabled={disabled}
              className="w-full"
              onChange={handleInputChange}
              // 点击输入框时，如果已经满足条件直接展开
              onClick={() => inputValue.length >= 2 && setOpen(true)}
            />
          </Command.Input>
        </PopoverTrigger>

        <PopoverContent
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            'relative z-50 w-[var(--radix-popover-trigger-width)] min-w-[8rem] p-1 max-h-[200px] overflow-hidden',
            'rounded-md border bg-popover text-popover-foreground shadow-md dark:border-border',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2'
          )}
          sideOffset={4}
          align="start"
          asChild // 将 PopoverContent 作为 Command.List 的直接容器
        >
          <Command.List className="h-full overflow-x-hidden overflow-y-auto">
            <div className="flex flex-col">
              {filteredOptions.map((option) => (
                <Command.Item
                  key={option.value}
                  // value 属性供 cmdk 内部追踪状态使用
                  value={option.value}
                  onSelect={() => handleSelect(option)}
                  className={cn(
                    'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 px-2 text-base outline-none select-none',
                    // 使用 cmdk 提供的 data-[selected=true] 替代原先的 hover 伪类，
                    // 这样无论是键盘上下键还是鼠标经过，都能正确高亮
                    'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
                    'data-[disabled]:pointer-events-none data-[disabled]:opacity-50'
                  )}
                >
                  {option.label}
                </Command.Item>
              ))}
            </div>
          </Command.List>
        </PopoverContent>
      </Popover>
    </Command>
  )
}