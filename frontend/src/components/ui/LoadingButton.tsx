import React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button"; // 确保路径正确
import { cn } from "@/lib/utils";

// 1. 动态提取你的 Button 组件的 Props 类型
export interface LoadingButtonProps extends React.ComponentProps<typeof Button> {
  isLoading?: boolean;
  loadingText?: React.ReactNode;
  iconClassName?: string;
}

export const LoadingButton = React.forwardRef<HTMLButtonElement, LoadingButtonProps>(
  ({ children, isLoading = false, loadingText, iconClassName, className, disabled, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        disabled={isLoading || disabled}
        className={cn("relative", className)}
        {...props}
      >
        <div className="grid place-items-center w-full h-full">
          {/* 状态 1：默认文字（即便 Loading 时也存在，用来撑开宽度，但透明度设为 0） */}
          <span
            className={cn(
              "col-start-1 row-start-1 flex items-center justify-center transition-opacity duration-200",
              isLoading ? "opacity-0 pointer-events-none" : "opacity-100"
            )}
          >
            {children}
          </span>

          {/* 状态 2：加载状态 */}
          <span
            className={cn(
              "col-start-1 row-start-1 flex items-center justify-center transition-opacity duration-200",
              isLoading ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
          >
            <Loader2 
              className={cn(
                "size-[1.2em] animate-spin shrink-0", 
                // ✨ 关键：只有当存在 loadingText 时，才加右间距
                loadingText ? "mr-2" : "mr-0", 
                iconClassName
              )} 
            />
            {/* 只有传入文字才渲染，不传则只显示图标 */}
            {loadingText}
          </span>
        </div>
      </Button>
    );
  }
);

LoadingButton.displayName = "LoadingButton";