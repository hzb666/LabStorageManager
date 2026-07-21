import React from 'react'
import { pinyin as toPinyin } from 'pinyin-pro'

import {
  SEARCH_MATCH_MODES,
  splitSegmentedSearchTerms,
  type SearchMatchMode,
} from '@/lib/searchMatchMode'

interface HighlightTextProps {
  text?: string | number | null
  highlight?: string
  // 允许忽略分隔符，并在精确命中失败时回退到拼音/首字母匹配。
  fuzzy?: boolean
  matchMode?: SearchMatchMode
}

interface TextToken {
  text: string
  type: 'hanzi' | 'latin' | 'separator'
  start: number
}

interface LatinMatch {
  consumed: number
  start: number
  end: number
}

interface HighlightRange {
  start: number
  end: number
}

const HIGHLIGHT_CLASS = 'bg-yellow-400/40 dark:bg-yellow-500/40'
const SEPARATORS = String.raw`[\s\u00A0\u2002\u2003\u2009_.\-]`
const SEPARATOR_REGEX = new RegExp(`${SEPARATORS}+`, 'g')
const HANZI_REGEX = /[\u3400-\u9fff]/
const LATIN_OR_DIGIT_REGEX = /[A-Za-z0-9]/

// 转义高亮词中的正则特殊字符，确保精确匹配按字面量执行。
const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

const regexCache = new Map<string, RegExp>()
const tokenCache = new Map<string, TextToken[]>()
const hanziPinyinCache = new Map<string, string>()

// 归一化模糊查询词，去掉分隔符并统一为小写。
const normalizeFuzzyText = (value: string): string =>
  value.replaceAll(SEPARATOR_REGEX, '').toLowerCase()

// 构建并缓存精确高亮使用的正则，避免重复创建相同表达式。
const getExactRegex = (highlight: string): RegExp => {
  const cacheKey = `e_${highlight}`
  const cached = regexCache.get(cacheKey)
  if (cached) return cached

  const regex = new RegExp(escapeRegExp(highlight), 'gi')
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

// 将原文本拆成汉字、拉丁/数字、分隔符三类 token，保留每段在原文本中的起点。
const tokenizeText = (text: string): TextToken[] => {
  const cached = tokenCache.get(text)
  if (cached) return cached

  const tokens: TextToken[] = []
  let index = 0

  while (index < text.length) {
    const char = text[index]

    if (HANZI_REGEX.test(char)) {
      tokens.push({ text: char, type: 'hanzi', start: index })
      index += 1
      continue
    }

    if (LATIN_OR_DIGIT_REGEX.test(char)) {
      let end = index + 1
      while (end < text.length && LATIN_OR_DIGIT_REGEX.test(text[end])) {
        end += 1
      }
      tokens.push({ text: text.slice(index, end), type: 'latin', start: index })
      index = end
      continue
    }

    let end = index + 1
    while (
      end < text.length &&
      !HANZI_REGEX.test(text[end]) &&
      !LATIN_OR_DIGIT_REGEX.test(text[end])
    ) {
      end += 1
    }
    tokens.push({ text: text.slice(index, end), type: 'separator', start: index })
    index = end
  }

  tokenCache.set(text, tokens)
  if (tokenCache.size > 200) tokenCache.clear()
  return tokens
}

// 判断当前汉字是否能消费剩余查询词，支持汉字本身与拼音前缀两种命中方式。
const findHanziPrefixMatch = (char: string, remainingQuery: string): number => {
  if (!remainingQuery) return 0
  if (remainingQuery.startsWith(char.toLowerCase())) return char.length

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
const findLatinSubstringMatch = (
  tokenText: string,
  remainingQuery: string,
): LatinMatch | null => {
  const normalizedToken = tokenText.toLowerCase()
  const maxLength = Math.min(normalizedToken.length, remainingQuery.length)

  for (let length = maxLength; length >= 1; length -= 1) {
    const candidate = remainingQuery.slice(0, length)
    const start = normalizedToken.indexOf(candidate)
    if (start !== -1) {
      return { consumed: length, start, end: start + length }
    }
  }
  return null
}

// 按 token 类型分发匹配逻辑，返回 token 内的高亮区间与查询消费长度。
const getTokenHighlightRange = (
  token: TextToken,
  remainingQuery: string,
): [HighlightRange, number] | null => {
  if (token.type === 'hanzi') {
    const consumed = findHanziPrefixMatch(token.text, remainingQuery)
    return consumed === 0 ? null : [{ start: 0, end: token.text.length }, consumed]
  }

  const latinMatch = findLatinSubstringMatch(token.text, remainingQuery)
  if (!latinMatch) return null
  return [
    { start: latinMatch.start, end: latinMatch.end },
    latinMatch.consumed,
  ]
}

// 从指定起点扫描 token，尝试为整个模糊查询词构建原文本字符区间。
const scanHighlightRangesFromIndex = (
  tokens: TextToken[],
  normalizedQuery: string,
  startIndex: number,
): HighlightRange[] | null => {
  let queryIndex = 0
  const ranges: HighlightRange[] = []

  for (
    let tokenIndex = startIndex;
    tokenIndex < tokens.length && queryIndex < normalizedQuery.length;
    tokenIndex += 1
  ) {
    const token = tokens[tokenIndex]
    if (token.type === 'separator') continue

    const tokenMatch = getTokenHighlightRange(token, normalizedQuery.slice(queryIndex))
    if (!tokenMatch) return null

    const [range, consumed] = tokenMatch
    ranges.push({ start: token.start + range.start, end: token.start + range.end })
    queryIndex += consumed
  }

  return queryIndex === normalizedQuery.length ? ranges : null
}

const findFuzzyHighlightRanges = (text: string, highlight: string): HighlightRange[] => {
  const normalizedQuery = normalizeFuzzyText(highlight)
  if (!normalizedQuery) return []

  const tokens = tokenizeText(text)
  for (let startIndex = 0; startIndex < tokens.length; startIndex += 1) {
    const ranges = scanHighlightRangesFromIndex(tokens, normalizedQuery, startIndex)
    if (ranges) return ranges
  }
  return []
}

const findExactHighlightRanges = (text: string, highlight: string): HighlightRange[] => {
  const regex = getExactRegex(highlight)
  regex.lastIndex = 0
  const ranges: HighlightRange[] = []
  for (const match of text.matchAll(regex)) {
    ranges.push({ start: match.index, end: match.index + match[0].length })
  }
  return ranges
}

const mergeHighlightRanges = (ranges: HighlightRange[]): HighlightRange[] => {
  const sortedRanges = [...ranges].sort((left, right) =>
    left.start === right.start ? right.end - left.end : left.start - right.start,
  )
  const mergedRanges: HighlightRange[] = []

  for (const range of sortedRanges) {
    const previous = mergedRanges.at(-1)
    if (!previous || range.start > previous.end) {
      mergedRanges.push({ ...range })
      continue
    }
    previous.end = Math.max(previous.end, range.end)
  }
  return mergedRanges
}

const getHighlightTerms = (highlight: string, matchMode: SearchMatchMode): string[] => {
  if (matchMode === SEARCH_MATCH_MODES.EXACT) return [highlight]

  const segmentedTerms = splitSegmentedSearchTerms(highlight)
  return segmentedTerms.length > 0 ? segmentedTerms : [highlight]
}

const getHighlightRanges = (
  text: string,
  terms: string[],
  fuzzy: boolean,
): HighlightRange[] => {
  const ranges = terms.flatMap((term) => {
    if (fuzzy) return findFuzzyHighlightRanges(text, term)

    const exactRanges = findExactHighlightRanges(text, term)
    return exactRanges.length > 0 ? exactRanges : findFuzzyHighlightRanges(text, term)
  })
  return mergeHighlightRanges(ranges)
}

const buildHighlightedText = (text: string, ranges: HighlightRange[]): React.ReactNode => {
  if (ranges.length === 0) return text

  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (const range of ranges) {
    if (cursor < range.start) {
      nodes.push(<span key={`text-${cursor}`}>{text.slice(cursor, range.start)}</span>)
    }
    nodes.push(
      <span key={`highlight-${range.start}`} className={HIGHLIGHT_CLASS}>
        {text.slice(range.start, range.end)}
      </span>,
    )
    cursor = range.end
  }
  if (cursor < text.length) {
    nodes.push(<span key={`text-${cursor}`}>{text.slice(cursor)}</span>)
  }
  return <>{nodes}</>
}

// 统一渲染搜索高亮文本；空格分段查询会独立匹配并合并每个关键字的区间。
export const HighlightText = React.memo(function HighlightText({
  text,
  highlight,
  fuzzy = false,
  matchMode = SEARCH_MATCH_MODES.CONTAINS,
}: HighlightTextProps) {
  if (text === null || text === undefined || text === '') return null
  const strText = String(text)
  const trimmedHighlight = highlight?.trim()
  if (!trimmedHighlight) return <>{strText}</>

  const terms = getHighlightTerms(trimmedHighlight, matchMode)
  return <>{buildHighlightedText(strText, getHighlightRanges(strText, terms, fuzzy))}</>
})
