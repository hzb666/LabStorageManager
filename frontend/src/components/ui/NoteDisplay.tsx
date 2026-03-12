import * as React from "react"
import { cn } from "@/lib/utils"
import { inputConfigs } from "@/lib/inputConfigs"

export interface NoteDisplayProps {
  label?: string;
  text?: string;
  className?: string;
}

export const NoteDisplay: React.FC<NoteDisplayProps> = ({ label, text = '', className }) => {
  const isEmpty = !text || text === "-";
  const matchedTag = !isEmpty ? Object.keys(inputConfigs).find(tag => text.startsWith(tag)) : null;

  const config = matchedTag ? inputConfigs[matchedTag] : null;
  const Icon = config?.icon;
  const content = matchedTag ? text.slice(matchedTag.length) : text;

  return (
    <div className={cn("text-base wrap-break-word leading-relaxed text-foreground", className)}>
      {label && <span>{label}：</span>}
      {isEmpty && <span>-</span>}

      {!isEmpty && (
        <span className={cn(config?.text)}>
          {Icon && (
            <Icon 
              // align-[-0.125em] 是排版的黄金法则，使得 16px 图标完美嵌在 16px 文字的中轴线上
              className="inline-block w-4 h-4 mr-1 align-[-0.125em] fill-current" 
            />
          )}
          <span>{content}</span>
        </span>
      )}
    </div>
  );
};