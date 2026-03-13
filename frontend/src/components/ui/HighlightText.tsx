// src/components/ui/HighlightText.tsx
import React from 'react';

interface HighlightTextProps {
  /** 要展示和匹配的文本，支持传入数字或可空类型 */
  text?: string | number | null;
  /** 当前的搜索高亮词 */
  highlight?: string;
  /** 是否开启模糊匹配 */
  fuzzy?: boolean;
}

// 1. 提取到组件外部，涵盖了常见的空格、全半角空白符以及连接符
const SEPARATORS = String.raw`[\s\u00A0\u2002\u2003\u2009_.\-]`;
const SEPARATOR_REGEX = new RegExp(`${SEPARATORS}+`, 'g');

// 2. 正则转义工具，防止用户输入 .*+?^${}()|[]\ 等特殊字符导致正则崩溃
const escapeRegExp = (str: string) => str.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

// 3. 模块级缓存：解决几百个单元格渲染时，重复计算和创建正则实例的内存开销
const regexCache = new Map<string, RegExp>();

const getRegex = (highlight: string, fuzzy: boolean): RegExp | null => {
  const cacheKey = `${fuzzy ? 'f' : 'e'}_${highlight}`;
  
  if (regexCache.has(cacheKey)) {
    return regexCache.get(cacheKey)!;
  }

  let regex: RegExp | null = null;
  
  if (fuzzy) {
    const cleaned = highlight.replaceAll(SEPARATOR_REGEX, '');
    if (cleaned) {
      // 将 "ab" 转换为能够跨越空格和横杠匹配的正则：a[\s_.-]*b
      const fuzzyPattern = cleaned.split('').map(escapeRegExp).join(`${SEPARATORS}*`);
      regex = new RegExp(fuzzyPattern, 'i');
    }
  } else {
    // 精确匹配：包裹捕获组 ()，使得后续 split 拆分后的数组保留匹配项
    regex = new RegExp(`(${escapeRegExp(highlight)})`, 'gi');
  }

  if (regex) {
    regexCache.set(cacheKey, regex);
    // 简单的防止内存泄漏策略：当搜索词变化超过 50 种时，清空缓存
    if (regexCache.size > 50) regexCache.clear();
  }

  return regex;
};

export const HighlightText = React.memo(function HighlightText({
  text,
  highlight,
  fuzzy = false,
}: HighlightTextProps) {
  // [极速阻断 1]：如果没有文本，直接不渲染
  if (text === null || text === undefined || text === '') return null;
  const strText = String(text);

  // [极速阻断 2]：如果没有搜索词，直接原样渲染
  if (!highlight || highlight.trim() === '') {
    return <>{strText}</>;
  }

  const trimmedHighlight = highlight.trim();
  const regex = getRegex(trimmedHighlight, fuzzy);

  if (!regex) return <>{strText}</>;

  if (fuzzy) {
    // 模糊匹配逻辑：使用原生 RegExp.test 代替 String.replace，避免反复分配内存
    if (regex.test(strText)) {
      return <span className="bg-amber-200 dark:bg-amber-800/50">{strText}</span>;
    }
    return <>{strText}</>;
  }

  // 精确匹配逻辑：由于使用了带捕获组的正则 /(keyword)/gi，
  // 拆分后的数组永远是：[普通文本, 匹配文本, 普通文本, 匹配文本...] 
  const parts = strText.split(regex);

  // 如果长度为1，说明没匹配到内容
  if (parts.length === 1) return <>{strText}</>;

  return (
    <>
      {parts.map((part, i) =>
        // 索引为奇数的必然是我们通过正则匹配到的高亮文本项
        // 完全不需要调用 part.toLowerCase() === highlight.toLowerCase() 来判断
        i % 2 === 1 ? (
          <span key={i} className="bg-amber-200 dark:bg-amber-800/50">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
});