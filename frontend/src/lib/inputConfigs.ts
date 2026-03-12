import * as React from "react"
import { Star, AlertCircle, Lock, CheckCircle2 } from "lucide-react"

// ==========================================
// 1. 标签状态配置
// ==========================================
export interface InputTagConfig {
  icon: React.ElementType;
  text: string;
  border: string;
  focus: string;
}

export const inputConfigs: Record<string, InputTagConfig> = {
  "[强调]": { 
    icon: Star, 
    text: "text-amber-600 dark:text-amber-500", 
    border: "border-amber-500/40 dark:border-amber-500/30",
    focus: "focus-visible:border-amber-500 focus-visible:ring-amber-500/20"
  },
  "[紧急]": { 
    icon: AlertCircle, 
    text: "text-red-600 dark:text-red-500", 
    border: "border-red-500/40 dark:border-red-500/30",
    focus: "focus-visible:border-red-500 focus-visible:ring-red-500/20"
  },
  "[私密]": { 
    icon: Lock, 
    text: "text-purple-600 dark:text-purple-500", 
    border: "border-purple-500/40 dark:border-purple-500/30",
    focus: "focus-visible:border-purple-500 focus-visible:ring-purple-500/20"
  },
  "[完成]": { 
    icon: CheckCircle2, 
    text: "text-emerald-600 dark:text-emerald-500", 
    border: "border-emerald-500/40 dark:border-emerald-500/30",
    focus: "focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20"
  },
};

// ==========================================
// 2. Input 组件提取出的结构样式
// ==========================================
export interface InputStyles {
  wrapper: string;
  leftArea: string;
  prefixButton: {
    base: string;
    loading: string;
    default: string;
    icon: string;
  };
  tagButton: {
    base: string;
    inactive: string;
    iconBase: string;
  };
  input: {
    base: string;
    inactive: string;
    numberApperance: string;
  };
  stepper: {
    wrapper: string;
    button: string;
    icon: string;
  };
  suffixArea: string;
}

export const defaultInputStyles: InputStyles = {
  // 完全保留原有的 input 样式结构
  wrapper: "relative flex items-center w-full group",
  leftArea: "absolute left-1.5 top-1 bottom-1 flex items-center z-10",
  
  // 美化后的 prefixButton：大小与动画一致，增加了悬浮背景，体验更好
  prefixButton: {
    base: "group inline-flex h-7 w-7 items-center justify-center rounded outline-none p-0 transition-all duration-300 ease-out",
    loading: "text-muted-foreground/50 cursor-default",
    default: "text-muted-foreground/50 hover:text-foreground hover:bg-muted/50",
    icon: "w-4 h-4 shrink-0 transition-all duration-300 ease-out group-hover:scale-110 group-active:scale-90",
  },
  
  // 原有的 tag toggle 按钮样式
  tagButton: {
    base: "group inline-flex h-7 w-7 items-center justify-center rounded outline-none p-0 transition-colors duration-300 ease-out",
    inactive: "text-muted-foreground/30 hover:text-muted-foreground/70",
    iconBase: "w-4 h-4 shrink-0 transition-all duration-300 ease-out group-hover:scale-110 group-active:scale-90",
  },
  
  // 原有的核心输入框样式
  input: {
    base: "inline-flex h-10 leading-10! w-full rounded-md border bg-card text-base transition-all duration-300 ease-out placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ring-offset-background",
    inactive: "border-input text-foreground focus-visible:border-ring focus-visible:ring-ring/30",
    numberApperance: "[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&]:-moz-appearance:textfield",
  },
  
  // 原有的数字加减控制器样式
  stepper: {
    wrapper: "absolute right-1 top-1 bottom-1 w-6 flex flex-col rounded-sm overflow-hidden bg-transparent z-10",
    button: "flex flex-1 items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-accent/80 transition-all disabled:opacity-30 disabled:cursor-not-allowed",
    icon: "w-3.5 h-3.5",
  },
  suffixArea: "absolute right-1 top-1 bottom-1 flex items-center z-10 pr-2",
};
