const FONT_READY_CLASS = 'web-fonts-ready'
const FONT_STATE_ATTRIBUTE = 'data-font-state'
const FONT_STYLESHEET_ID = 'app-web-fonts'
const FONT_TIMEOUT_MS = 1000
const FONT_STYLESHEET_URL =
  'https://fonts.googleapis.cn/css2?family=Noto+Sans+SC:wght@400;700&display=swap'

function markFontState(state: 'loading' | 'fallback' | 'ready') {
  document.documentElement.setAttribute(FONT_STATE_ATTRIBUTE, state)
}

function markWebFontsReady() {
  const root = document.documentElement
  root.classList.add(FONT_READY_CLASS)
  markFontState('ready')
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
    link.href = FONT_STYLESHEET_URL
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
    document.fonts.load('400 1em "Noto Sans SC"'),
    document.fonts.load('700 1em "Noto Sans SC"'),
  ])
}

async function bootstrapFontLoading() {
  markFontState('loading')

  const fallbackTimer = window.setTimeout(() => {
    if (document.documentElement.getAttribute(FONT_STATE_ATTRIBUTE) === 'loading') {
      markFontState('fallback')
    }
  }, FONT_TIMEOUT_MS)

  try {
    await ensureFontStylesheet()
    await waitForFonts()
    window.clearTimeout(fallbackTimer)
    markWebFontsReady()
  } catch {
    window.clearTimeout(fallbackTimer)
    if (document.documentElement.getAttribute(FONT_STATE_ATTRIBUTE) !== 'ready') {
      markFontState('fallback')
    }
  }
}

void bootstrapFontLoading()
