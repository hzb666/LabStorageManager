import React from 'react'
import { pinyin as toPinyin } from 'pinyin-pro'

interface HighlightTextProps {
  /** 要展示和匹配的文本，支持传入数字或可空类型 */
  text?: string | number | null
  /** 当前的搜索高亮词 */
  highlight?: string
  /** 是否开启模糊匹配 */
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

const HIGHLIGHT_CLASS = 'bg-amber-200 dark:bg-amber-800/50'
const SEPARATORS = String.raw`[\s\u00A0\u2002\u2003\u2009_.\-]`
const SEPARATOR_REGEX = new RegExp(`${SEPARATORS}+`, 'g')
const HANZI_REGEX = /[\u3400-\u9fff]/
const LATIN_OR_DIGIT_REGEX = /[A-Za-z0-9]/

const escapeRegExp = (str: string) => str.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

const regexCache = new Map<string, RegExp>()
const tokenCache = new Map<string, TextToken[]>()
const hanziPinyinCache = new Map<string, string>()

const normalizeFuzzyText = (value: string) => value.replaceAll(SEPARATOR_REGEX, '').toLowerCase()

const getExactRegex = (highlight: string): RegExp => {
  const cacheKey = `e_${highlight}`
  const cached = regexCache.get(cacheKey)
  if (cached) return cached

  const regex = new RegExp(`(${escapeRegExp(highlight)})`, 'gi')
  regexCache.set(cacheKey, regex)
  if (regexCache.size > 50) regexCache.clear()
  return regex
}

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

const buildHighlightedTokens = (
  tokens: TextToken[],
  highlightedRanges: Map<number, { start: number; end: number } | 'full'>
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

const getFuzzyHighlightedNodes = (text: string, highlight: string): React.ReactNode => {
  const normalizedQuery = normalizeFuzzyText(highlight)
  if (!normalizedQuery) return text

  const tokens = tokenizeText(text)

  for (let startIndex = 0; startIndex < tokens.length; startIndex += 1) {
    let queryIndex = 0
    let matched = false
    const highlightedRanges = new Map<number, { start: number; end: number } | 'full'>()

    for (let tokenIndex = startIndex; tokenIndex < tokens.length && queryIndex < normalizedQuery.length; tokenIndex += 1) {
      const token = tokens[tokenIndex]

      if (token.type === 'separator') {
        continue
      }

      const remainingQuery = normalizedQuery.slice(queryIndex)

      if (token.type === 'hanzi') {
        const consumed = findHanziPrefixMatch(token.text, remainingQuery)
        if (consumed === 0) {
          matched = false
          break
        }

        highlightedRanges.set(tokenIndex, 'full')
        queryIndex += consumed
        matched = true
        continue
      }

      const latinMatch = findLatinSubstringMatch(token.text, remainingQuery)
      if (!latinMatch) {
        matched = false
        break
      }

      highlightedRanges.set(tokenIndex, {
        start: latinMatch.start,
        end: latinMatch.end,
      })
      queryIndex += latinMatch.consumed
      matched = true
    }

    if (matched && queryIndex === normalizedQuery.length) {
      return <>{buildHighlightedTokens(tokens, highlightedRanges)}</>
    }
  }

  return text
}

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
