'use client'

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

function TooltipProvider({
  // 给 tooltip 加入一个小的延迟，避免在侧边栏折叠/动画过程中
  // 因短暂经过触发区域而打开大量 tooltip
  delayDuration = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot='tooltip-provider'
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot='tooltip' {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot='tooltip-trigger' {...props} />
}

function TooltipContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot='tooltip-content'
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md bg-primary px-3 py-1.5 text-[12.8px] text-primary-foreground text-balance shadow-md',
          'will-change-[transform,opacity]', 
          'animate-in fade-in-0 zoom-in-[0.98] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          'data-[side=bottom]:slide-in-from-top-1.5',
          'data-[side=top]:slide-in-from-bottom-1.5',
          'data-[side=left]:slide-in-from-right-1.5',
          'data-[side=right]:slide-in-from-left-1.5',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98] data-[state=closed]:duration-200',
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow 
          className='fill-primary' 
          width={10} 
          height={5} 
        />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }