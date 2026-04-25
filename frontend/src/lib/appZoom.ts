const MOBILE_VIEWPORT_MAX_WIDTH = 767
const TABLET_SHORT_SIDE_MAX = 1024

interface ZoomBreakpoint {
  maxHeight: number
  zoom: number
}

const DESKTOP_ZOOM_BREAKPOINTS: readonly ZoomBreakpoint[] = [
  { maxHeight: 800, zoom: 0.85 },
  { maxHeight: 900, zoom: 0.9 },
  { maxHeight: 1080, zoom: 0.95 },
]

function getAvailableScreenSize() {
  return {
    width: window.screen.availWidth || window.screen.width,
    height: window.screen.availHeight || window.screen.height,
  }
}

function isTouchFirstSmallScreen(): boolean {
  if (window.matchMedia(`(max-width: ${MOBILE_VIEWPORT_MAX_WIDTH}px)`).matches) {
    return true
  }

  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
    return true
  }

  const { width, height } = getAvailableScreenSize()
  return navigator.maxTouchPoints > 0 && Math.min(width, height) <= TABLET_SHORT_SIDE_MAX
}

function getDesktopZoom(): number {
  const { height } = getAvailableScreenSize()

  for (const breakpoint of DESKTOP_ZOOM_BREAKPOINTS) {
    if (height <= breakpoint.maxHeight) {
      return breakpoint.zoom
    }
  }

  return 1
}

export function applyAppZoom(): void {
  const zoom = isTouchFirstSmallScreen() ? 1 : getDesktopZoom()
  document.documentElement.style.setProperty('zoom', String(zoom))
}
