const FONT_READY_CLASS = 'web-fonts-ready'
const FONT_STATE_ATTRIBUTE = 'data-font-state'
const FONT_STYLESHEET_ID = 'wiki-web-fonts'
const LOCAL_FONT_STYLE_ID = 'wiki-local-web-fonts'
const LOCAL_FONT_PREFERENCE_KEY = 'wiki-preferred-font-source'
const LOCAL_FONT_PREFERENCE_VALUE = 'source-han-sans-cn-vf-v1'
const GOOGLE_FONT_FAMILY = 'Noto Sans SC'
const LOCAL_FONT_FAMILY = 'SourceHanSansCN-VF-Local'
const FONT_TIMEOUT_MS = 1000
const GOOGLE_FONT_MIRROR_URL =
  'https://fonts.googleapis.cn/css2?family=Noto+Sans+SC:wght@400;500;700&display=swap'

const baseUrl = import.meta.env.BASE_URL || '/'
const LOCAL_FONT_URL = `${baseUrl}lib/SourceHanSansCN-VF.woff2`

function markFontState(state: 'loading' | 'fallback' | 'ready') {
  document.documentElement.setAttribute(FONT_STATE_ATTRIBUTE, state)
}

function markWebFontsReady() {
  const root = document.documentElement
  root.classList.add(FONT_READY_CLASS)
  markFontState('ready')
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function shouldPreferLocalFont() {
  try {
    return localStorage.getItem(LOCAL_FONT_PREFERENCE_KEY) === LOCAL_FONT_PREFERENCE_VALUE
  } catch {
    return false
  }
}

function rememberLocalFontPreference() {
  try {
    localStorage.setItem(LOCAL_FONT_PREFERENCE_KEY, LOCAL_FONT_PREFERENCE_VALUE)
  } catch {
    // ignore localStorage errors
  }
}

function clearLocalFontPreference() {
  try {
    localStorage.removeItem(LOCAL_FONT_PREFERENCE_KEY)
  } catch {
    // ignore localStorage errors
  }
}

function ensureFontStylesheet() {
  return new Promise<void>((resolve, reject) => {
    const existingLink = document.getElementById(FONT_STYLESHEET_ID) as HTMLLinkElement | null

    if (existingLink) {
      if (existingLink.sheet) {
        resolve()
        return
      }

      existingLink.addEventListener('load', () => resolve(), { once: true })
      existingLink.addEventListener('error', () => reject(new Error('Web font stylesheet failed to load.')), {
        once: true,
      })
      return
    }

    const link = document.createElement('link')
    link.id = FONT_STYLESHEET_ID
    link.rel = 'stylesheet'
    link.href = GOOGLE_FONT_MIRROR_URL
    link.addEventListener('load', () => resolve(), { once: true })
    link.addEventListener('error', () => reject(new Error('Web font stylesheet failed to load.')), {
      once: true,
    })
    document.head.appendChild(link)
  })
}

async function waitForFonts() {
  if (!('fonts' in document)) {
    return
  }

  await Promise.all([
    document.fonts.load(`400 1em "${GOOGLE_FONT_FAMILY}"`),
    document.fonts.load(`500 1em "${GOOGLE_FONT_FAMILY}"`),
    document.fonts.load(`700 1em "${GOOGLE_FONT_FAMILY}"`),
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
      font-weight: 400 700;
      font-style: normal;
      font-display: swap;
    }
  `
  document.head.appendChild(style)
}

async function waitForLocalFonts() {
  ensureLocalFontStylesheet()

  if (!('fonts' in document)) {
    return
  }

  await Promise.all([
    document.fonts.load(`400 1em "${LOCAL_FONT_FAMILY}"`),
    document.fonts.load(`500 1em "${LOCAL_FONT_FAMILY}"`),
    document.fonts.load(`700 1em "${LOCAL_FONT_FAMILY}"`),
  ])
}

async function loadMirrorFonts() {
  await Promise.race([
    (async () => {
      await ensureFontStylesheet()
      await waitForFonts()
    })(),
    delay(FONT_TIMEOUT_MS).then(() => {
      throw new Error('Web font loading timed out.')
    }),
  ])
}

async function loadLocalFonts() {
  await waitForLocalFonts()
  rememberLocalFontPreference()
}

async function bootstrapFontLoading() {
  markFontState('loading')

  try {
    if (shouldPreferLocalFont()) {
      try {
        await loadLocalFonts()
        markWebFontsReady()
        return
      } catch {
        clearLocalFontPreference()
      }
    }

    await loadMirrorFonts()
    markWebFontsReady()
  } catch {
    try {
      await loadLocalFonts()
      markWebFontsReady()
    } catch {
      clearLocalFontPreference()
      markFontState('fallback')
    }
  }
}

if (typeof document !== 'undefined') {
  void bootstrapFontLoading()
}
