import { Star, AlertCircle, Lock, CheckCircle2 } from "lucide-react"

export const inputConfigs: Record<string, { 
  icon: React.ElementType; 
  text: string;     // 文字与图标颜色
  border: string;   // 静态边框颜色 (带透明度)
  focus: string;    // 聚焦时的边框加深与发光效果
}> = {
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