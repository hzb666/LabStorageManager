const MIN_ZOOM = 25
const MAX_ZOOM = 200
const ZOOM_STEP = 10

export function initializeProcedureReportZoom(preview: Window) {
  const document = preview.document
  const host = document.getElementById('report-pages')
  const decrease = document.getElementById('report-zoom-out') as HTMLButtonElement | null
  const increase = document.getElementById('report-zoom-in') as HTMLButtonElement | null
  const reset = document.getElementById('report-zoom-reset') as HTMLButtonElement | null
  const fit = document.getElementById('report-zoom-fit') as HTMLButtonElement | null
  if (!host || !decrease || !increase || !reset || !fit) return

  let percent = 100
  let fitWidth = preview.innerWidth <= 700
  const fitPercent = () => {
    const sheet = host.querySelector<HTMLElement>('.report-sheet')
    if (!sheet) return 100
    const style = preview.getComputedStyle(host)
    const available = host.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
    const pageWidth = Number.parseFloat(preview.getComputedStyle(sheet).width)
    return Math.floor(available / pageWidth * 100)
  }
  const setZoom = (value: number, fitting = false) => {
    percent = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value)))
    fitWidth = fitting
    document.documentElement.style.setProperty('--report-scale', String(percent / 100))
    reset.textContent = `${percent}%`
    reset.setAttribute('aria-label', `当前缩放 ${percent}%，点击恢复 100%`)
    decrease.disabled = percent <= MIN_ZOOM
    increase.disabled = percent >= MAX_ZOOM
    fit.setAttribute('aria-pressed', String(fitting))
  }

  decrease.addEventListener('click', () => setZoom(percent - ZOOM_STEP))
  increase.addEventListener('click', () => setZoom(percent + ZOOM_STEP))
  reset.addEventListener('click', () => setZoom(100))
  fit.addEventListener('click', () => setZoom(fitPercent(), true))
  preview.addEventListener('resize', () => {
    if (fitWidth) setZoom(fitPercent(), true)
  })
  const resetZoom = () => {
    const fitting = preview.innerWidth <= 700
    setZoom(fitting ? fitPercent() : 100, fitting)
  }
  resetZoom()
  return resetZoom
}
