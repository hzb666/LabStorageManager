import { cn } from "@/lib/utils"

const SIDEBAR_LOGO_SRC = "/favicon.svg"

export function SidebarLogo({ className }: { className?: string }) {
  return (
    <img
      src={SIDEBAR_LOGO_SRC}
      alt="实验室库存管理系统 Logo"
      width={36}
      height={36}
      loading="eager"
      decoding="async"
      draggable={false}
      className={cn("shrink-0 select-none dark:invert", className)}
    />
  )
}
