const FONT_READY_CLASS = 'web-fonts-ready'
const FONT_STATE_ATTRIBUTE = 'data-font-state'
const LOCAL_FONT_STYLE_ID = 'wiki-local-web-fonts'
const LOCAL_FONT_FAMILY = 'SourceHanSansCN-VF-Local'
const FONT_TIMEOUT_MS = 3000
const LOCAL_FONT_URL = `${import.meta.env.BASE_URL}lib/SourceHanSansCN-VF.woff2`
const FONT_SAMPLE_TEXT =
  'LabStorageManager 实验室库存管理系统智能化全生命周期资产管理系统可追溯高智能强协同全文搜索结构检索'

type FontSource = 'local'
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

async function loadLocalFonts() {
  const fontText = getPageFontText()

  await Promise.race([
    waitForLocalFonts(fontText),
    delay(FONT_TIMEOUT_MS).then(() => {
      throw new Error('Local font loading timed out.')
    })
  ])
}

async function bootstrapFontLoading() {
  markFontState('loading')

  try {
    await loadLocalFonts()
    markWebFontsReady('local')
  } catch {
    markFontState('fallback')
  }
}

if (typeof window !== 'undefined') {
  void bootstrapFontLoading()
}
