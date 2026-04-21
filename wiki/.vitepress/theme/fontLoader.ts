const FONT_READY_CLASS = 'web-fonts-ready'
const FONT_STATE_ATTRIBUTE = 'data-font-state'
const FONT_STYLESHEET_ID = 'wiki-google-web-fonts'
const LOCAL_FONT_STYLE_ID = 'wiki-local-web-fonts'
const GOOGLE_FONT_FAMILY = 'Noto Sans SC'
const LOCAL_FONT_FAMILY = 'SourceHanSansCN-VF-Local'
const FONT_TIMEOUT_MS = 1000
const FONT_STYLESHEET_BASE_URL =
  'https://fonts.googleapis.cn/css2?family=Noto+Sans+SC:wght@400;700&display=swap'
const LOCAL_FONT_URL = `${import.meta.env.BASE_URL}lib/SourceHanSansCN-VF.woff2`
const GOOGLE_FONT_URL_MAX_LENGTH = 7500
const FONT_SAMPLE_TEXT =
  'LabStorageManager 实验室库存管理系统智能化全生命周期资产管理系统可追溯高智能强协同全文搜索结构检索'

type FontSource = 'google' | 'local'
type FontState = 'loading' | 'fallback' | FontSource

function markFontState(state: FontState) {
  document.documentElement.setAttribute(FONT_STATE_ATTRIBUTE, state)
}

function markWebFontsReady(source: FontSource) {
  document.documentElement.classList.add(FONT_READY_CLASS)
  markFontState(source)
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function getPageFontText() {
  const textRoots = document.querySelectorAll(
    '.VPNav, .VPSidebar, .VPLocalNav, .VPContent, .VPHome, .VPFooter'
  )
  const pageText = Array.from(textRoots)
    .map((element) => element.textContent ?? '')
    .join('')
  const text = `${FONT_SAMPLE_TEXT}${pageText}`.replace(/\s+/g, '')
  const uniqueCharacters = Array.from(new Set(Array.from(text))).join('')

  return uniqueCharacters || FONT_SAMPLE_TEXT
}

function getFontStylesheetUrl(fontText: string) {
  const fontUrl = `${FONT_STYLESHEET_BASE_URL}&text=${encodeURIComponent(fontText)}`

  if (fontUrl.length > GOOGLE_FONT_URL_MAX_LENGTH) {
    throw new Error('Google font text subset URL is too long.')
  }

  return fontUrl
}

function ensureFontStylesheet(fontText: string) {
  return new Promise<void>((resolve, reject) => {
    const fontStylesheetUrl = getFontStylesheetUrl(fontText)
    const existingLink = document.getElementById(FONT_STYLESHEET_ID) as HTMLLinkElement | null

    if (existingLink) {
      if (existingLink.href === fontStylesheetUrl && existingLink.sheet) {
        resolve()
        return
      }
      existingLink.remove()
    }

    const link = document.createElement('link')
    link.id = FONT_STYLESHEET_ID
    link.rel = 'stylesheet'
    link.href = fontStylesheetUrl
    link.addEventListener('load', () => resolve(), { once: true })
    link.addEventListener('error', () => reject(new Error('Google font stylesheet failed to load.')), {
      once: true
    })
    document.head.appendChild(link)
  })
}

async function waitForGoogleFonts(fontText: string) {
  if (!('fonts' in document)) {
    return
  }

  await Promise.all([
    document.fonts.load(`400 1em "${GOOGLE_FONT_FAMILY}"`, fontText),
    document.fonts.load(`700 1em "${GOOGLE_FONT_FAMILY}"`, fontText)
  ])
}

function ensureLocalFontStylesheet() {
  const existingStyle = document.getElementById(LOCAL_FONT_STYLE_ID)
  if (existingStyle) {
    return
  }

  const style = document.createElement('style')
  style.id = LOCAL_FONT_STYLE_ID
  style.textContent = `
    @font-face {
      font-family: '${LOCAL_FONT_FAMILY}';
      src: url('${LOCAL_FONT_URL}') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
      unicode-range: U+2E80-2EFF, U+3000-303F, U+31C0-31EF, U+3400-4DBF,
        U+4E00-9FFF, U+F900-FAFF, U+FE10-FE1F, U+FE30-FE4F, U+FF00-FFEF;
    }

    @font-face {
      font-family: '${LOCAL_FONT_FAMILY}';
      src: url('${LOCAL_FONT_URL}') format('woff2');
      font-weight: 700;
      font-style: normal;
      font-display: swap;
      unicode-range: U+2E80-2EFF, U+3000-303F, U+31C0-31EF, U+3400-4DBF,
        U+4E00-9FFF, U+F900-FAFF, U+FE10-FE1F, U+FE30-FE4F, U+FF00-FFEF;
    }
  `
  document.head.appendChild(style)
}

async function waitForLocalFonts(fontText = getPageFontText()) {
  ensureLocalFontStylesheet()

  if (!('fonts' in document)) {
    return
  }

  await Promise.all([
    document.fonts.load(`400 1em "${LOCAL_FONT_FAMILY}"`, fontText),
    document.fonts.load(`700 1em "${LOCAL_FONT_FAMILY}"`, fontText)
  ])
}

async function loadGoogleFonts() {
  const fontText = getPageFontText()

  await Promise.race([
    (async () => {
      await ensureFontStylesheet(fontText)
      await waitForGoogleFonts(fontText)
    })(),
    delay(FONT_TIMEOUT_MS).then(() => {
      throw new Error('Google font loading timed out.')
    })
  ])
}

async function bootstrapFontLoading() {
  markFontState('loading')

  try {
    await loadGoogleFonts()
    markWebFontsReady('google')
  } catch {
    try {
      await waitForLocalFonts()
      markWebFontsReady('local')
    } catch {
      markFontState('fallback')
    }
  }
}

if (typeof window !== 'undefined') {
  void bootstrapFontLoading()
}
