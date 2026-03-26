import React from 'react'
import { pinyin as toPinyin } from 'pinyin-pro'

interface HighlightTextProps {
  text?: string | number | null
  highlight?: string
  // 允许忽略分隔符，并在精确命中失败时回退到拼音/首字母匹配。
  fuzzy?: boolean
}

interface TextToken {
  text: string
  type: 'hanzi' | 'latin' | 'separator'
}

interface LatinMatch {
  consumed: number
  start: number
  end: number
}

type HighlightRange = { start: number; end: number } | 'full'

const HIGHLIGHT_CLASS = 'bg-yellow-400/40 dark:bg-yellow-500/40'
const SEPARATORS = String.raw`[\s\u00A0\u2002\u2003\u2009_.\-]`
const SEPARATOR_REGEX = new RegExp(`${SEPARATORS}+`, 'g')
const HANZI_REGEX = /[\u3400-\u9fff]/
const LATIN_OR_DIGIT_REGEX = /[A-Za-z0-9]/

// 转义高亮词中的正则特殊字符，确保精确匹配按字面量执行。
const escapeRegExp = (str: string) => str.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

const regexCache = new Map<string, RegExp>()
const tokenCache = new Map<string, TextToken[]>()
const hanziPinyinCache = new Map<string, string>()

// 归一化模糊查询词，去掉分隔符并统一为小写。
const normalizeFuzzyText = (value: string) => value.replaceAll(SEPARATOR_REGEX, '').toLowerCase()

// 构建并缓存精确高亮使用的正则，避免重复创建相同表达式。
const getExactRegex = (highlight: string): RegExp => {
  const cacheKey = `e_${highlight}`
  const cached = regexCache.get(cacheKey)
  if (cached) return cached

  const regex = new RegExp(`(${escapeRegExp(highlight)})`, 'gi')
  regexCache.set(cacheKey, regex)
  if (regexCache.size > 50) regexCache.clear()
  return regex
}

// 获取单个汉字对应的无声调拼音，并做缓存以降低重复转换成本。
const getHanziPinyin = (char: string): string => {
  const cached = hanziPinyinCache.get(char)
  if (cached !== undefined) return cached

  const result = toPinyin(char, { toneType: 'none', type: 'array' })
  const pinyinValue = Array.isArray(result)
    ? String(result[0] ?? '').replaceAll(/\s+/g, '').toLowerCase()
    : String(result ?? '').replaceAll(/\s+/g, '').toLowerCase()

  hanziPinyinCache.set(char, pinyinValue)
  return pinyinValue
}

// 将原文本拆成汉字、拉丁/数字、分隔符三类 token，便于后续模糊匹配逐段扫描。
const tokenizeText = (text: string): TextToken[] => {
  const cached = tokenCache.get(text)
  if (cached) return cached

  const tokens: TextToken[] = []
  let index = 0

  while (index < text.length) {
    const char = text[index]

    if (HANZI_REGEX.test(char)) {
      tokens.push({ text: char, type: 'hanzi' })
      index += 1
      continue
    }

    if (LATIN_OR_DIGIT_REGEX.test(char)) {
      let end = index + 1
      while (end < text.length && LATIN_OR_DIGIT_REGEX.test(text[end])) {
        end += 1
      }
      tokens.push({ text: text.slice(index, end), type: 'latin' })
      index = end
      continue
    }

    let end = index + 1
    while (end < text.length && !HANZI_REGEX.test(text[end]) && !LATIN_OR_DIGIT_REGEX.test(text[end])) {
      end += 1
    }
    tokens.push({ text: text.slice(index, end), type: 'separator' })
    index = end
  }

  tokenCache.set(text, tokens)
  if (tokenCache.size > 200) tokenCache.clear()
  return tokens
}

// 判断当前汉字是否能消费剩余查询词，支持汉字本身与拼音前缀两种命中方式。
const findHanziPrefixMatch = (char: string, remainingQuery: string): number => {
  if (!remainingQuery) return 0

  if (remainingQuery.startsWith(char.toLowerCase())) {
    return char.length
  }

  const pinyinValue = getHanziPinyin(char)
  const maxLength = Math.min(remainingQuery.length, pinyinValue.length)
  for (let length = maxLength; length >= 1; length -= 1) {
    if (pinyinValue.startsWith(remainingQuery.slice(0, length))) {
      return length
    }
  }

  return 0
}

// 在拉丁 token 中寻找最长可命中的子串，返回命中区间与消费长度。
const findLatinSubstringMatch = (tokenText: string, remainingQuery: string): LatinMatch | null => {
  const normalizedToken = tokenText.toLowerCase()
  const maxLength = Math.min(normalizedToken.length, remainingQuery.length)

  for (let length = maxLength; length >= 1; length -= 1) {
    const candidate = remainingQuery.slice(0, length)
    const start = normalizedToken.indexOf(candidate)
    if (start !== -1) {
      return {
        consumed: length,
        start,
        end: start + length,
      }
    }
  }

  return null
}

// 根据命中区间把 token 数组渲染成高亮后的 React 节点。
const buildHighlightedTokens = (
  tokens: TextToken[],
  highlightedRanges: Map<number, HighlightRange>
) => {
  return tokens.map((token, index) => {
    const match = highlightedRanges.get(index)
    if (!match) {
      return <span key={index}>{token.text}</span>
    }

    if (match === 'full') {
      return (
        <span key={index} className={HIGHLIGHT_CLASS}>
          {token.text}
        </span>
      )
    }

    const before = token.text.slice(0, match.start)
    const middle = token.text.slice(match.start, match.end)
    const after = token.text.slice(match.end)

    return (
      <span key={index}>
        {before}
        <span className={HIGHLIGHT_CLASS}>{middle}</span>
        {after}
      </span>
    )
  })
}

// 按 token 类型分发匹配逻辑，统一返回当前 token 的高亮区间与消费长度。
const getTokenHighlightRange = (token: TextToken, remainingQuery: string): [HighlightRange, number] | null => {
  if (token.type === 'hanzi') {
    const consumed = findHanziPrefixMatch(token.text, remainingQuery)
    return consumed === 0 ? null : ['full', consumed]
  }

  const latinMatch = findLatinSubstringMatch(token.text, remainingQuery)
  if (!latinMatch) {
    return null
  }

  return [
    {
      start: latinMatch.start,
      end: latinMatch.end,
    },
    latinMatch.consumed,
  ]
}

// 从指定起点开始扫描 token 序列，尝试为整个模糊查询词构建完整的高亮区间映射。
const scanHighlightRangesFromIndex = (
  tokens: TextToken[],
  normalizedQuery: string,
  startIndex: number
): Map<number, HighlightRange> | null => {
  let queryIndex = 0
  const highlightedRanges = new Map<number, HighlightRange>()

  for (let tokenIndex = startIndex; tokenIndex < tokens.length && queryIndex < normalizedQuery.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]

    if (token.type === 'separator') {
      continue
    }

    const remainingQuery = normalizedQuery.slice(queryIndex)
    const tokenMatch = getTokenHighlightRange(token, remainingQuery)
    if (!tokenMatch) {
      return null
    }

    const [highlightRange, consumed] = tokenMatch
    highlightedRanges.set(tokenIndex, highlightRange)
    queryIndex += consumed
  }

  return queryIndex === normalizedQuery.length ? highlightedRanges : null
}

// 执行模糊高亮，支持忽略分隔符并在汉字与拼音之间回退匹配。
const getFuzzyHighlightedNodes = (text: string, highlight: string): React.ReactNode => {
  const normalizedQuery = normalizeFuzzyText(highlight)
  if (!normalizedQuery) return text

  const tokens = tokenizeText(text)

  for (let startIndex = 0; startIndex < tokens.length; startIndex += 1) {
    const highlightedRanges = scanHighlightRangesFromIndex(tokens, normalizedQuery, startIndex)
    if (highlightedRanges) {
      return <>{buildHighlightedTokens(tokens, highlightedRanges)}</>
    }
  }

  return text
}

// 执行精确高亮，直接按大小写不敏感的字面量分段渲染。
const getExactHighlightedNodes = (text: string, highlight: string): React.ReactNode | null => {
  const regex = getExactRegex(highlight)
  const parts = text.split(regex)

  if (parts.length === 1) return null

  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className={HIGHLIGHT_CLASS}>
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  )
}

// 统一渲染搜索高亮文本，在精确匹配失败时回退到模糊/拼音高亮。
export const HighlightText = React.memo(function HighlightText({
  text,
  highlight,
  fuzzy = false,
}: HighlightTextProps) {
  if (text === null || text === undefined || text === '') return null
  const strText = String(text)

  if (!highlight || highlight.trim() === '') {
    return <>{strText}</>
  }

  const trimmedHighlight = highlight.trim()

  if (fuzzy) {
    return <>{getFuzzyHighlightedNodes(strText, trimmedHighlight)}</>
  }

  const exactHighlightedNodes = getExactHighlightedNodes(strText, trimmedHighlight)
  if (exactHighlightedNodes) return <>{exactHighlightedNodes}</>

  // 非模糊搜索下，如果命中了拼音字段（如首字母），回退到拼音映射高亮。
  return <>{getFuzzyHighlightedNodes(strText, trimmedHighlight)}</>
})
