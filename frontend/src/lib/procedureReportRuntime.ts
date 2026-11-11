import { formatDosingValue, updateDosing, type DosingField, type DosingState } from './procedureReportCalculations'
import { initializeProcedureReportZoom } from './procedureReportZoom'
import { removeProcedureReportRow } from './procedureReportRows'

export function copyProcedureReportTheme(source: Document, target: Document) {
  const style = source.defaultView?.getComputedStyle(source.documentElement)
  if (!style) return
  for (const name of ['primary', 'primary-foreground', 'card', 'foreground', 'input', 'accent', 'accent-foreground', 'radius']) {
    const value = style.getPropertyValue(`--${name}`).trim()
    if (value) target.documentElement.style.setProperty(`--report-ui-${name}`, value)
  }
  target.documentElement.classList.toggle('report-dark-toolbar', source.documentElement.classList.contains('dark'))
}

export function copyProcedureReportFonts(source: Document, target: Document) {
  // Use the app's active font registration and browser cache, rather than starting
  // a separate 8 MB report font download when the app already uses Noto Sans SC.
  target.body.style.fontFamily = source.defaultView?.getComputedStyle(source.body).fontFamily || ''
  const loaded = [...source.fonts].filter(font => font.status === 'loaded')
  const hasFamily = (name: string) => loaded.some(font => font.family.replace(/["']/gu, '') === name)
  for (const [family, id] of [['Noto Sans SC', 'app-web-fonts'], ['SourceHanSansCN-VF-Local', 'app-local-web-fonts']]) {
    const registration = hasFamily(family) ? source.getElementById(id) : null
    if (registration) target.head.append(registration.cloneNode(true))
  }
}

function editableText(node: Node): string {
  if (node.nodeType === 3) return node.textContent || ''
  const children = [...node.childNodes]
  return children.map((child, index) => {
    // Editable line wrappers contain a placeholder BR for an empty line.
    // innerText counts both the wrapper and that BR under white-space: pre-wrap.
    if (child.nodeName === 'BR') {
      return children.length === 1 || (index === children.length - 1 && children[index - 1]?.nodeName === 'BR') ? '' : '\n'
    }
    const startsLine = index > 0 && (['DIV', 'P'].includes(child.nodeName)
      || ['DIV', 'P'].includes(children[index - 1].nodeName))
    return (startsLine ? '\n' : '') + editableText(child)
  }).join('')
}

function textElement(block: HTMLElement): HTMLElement {
  return block.matches('[contenteditable]') ? block : block.querySelector<HTMLElement>('[contenteditable]')!
}

function reportBlocks(document: Document): HTMLElement[] {
  const blocks = [...document.querySelectorAll<HTMLElement>('.page-content > *')]
    .flatMap(block => block.tagName === 'SECTION' ? [...block.children] as HTMLElement[] : [block])
  // Reassemble table fragments so editing and reprinting never duplicate rows or headers.
  const merged: HTMLElement[] = []
  for (const block of blocks) {
    const previous = merged.at(-1)
    if (block.dataset.reportText) {
      const text = editableText(textElement(block))
      textElement(block).textContent = text
      if (previous?.dataset.reportText === block.dataset.reportText) textElement(previous).textContent += text
      else merged.push(block)
    } else if (block.dataset.reportTable && previous?.dataset.reportTable === block.dataset.reportTable) {
      previous.querySelector('tbody')?.append(...block.querySelectorAll('tbody > tr'))
    } else merged.push(block)
  }
  return merged
}

function preserveEditingFocus(document: Document) {
  const active = document.activeElement as HTMLInputElement | null
  const selection = active?.tagName === 'INPUT' ? [active.selectionStart, active.selectionEnd] : null
  const range = document.getSelection()?.rangeCount ? document.getSelection()?.getRangeAt(0) : null
  const rangePosition = range ? {
    start: range.startContainer, startOffset: range.startOffset,
    end: range.endContainer, endOffset: range.endOffset,
  } : null
  return () => {
    if (!active?.isConnected) return
    active.focus({ preventScroll: true })
    if (selection) active.setSelectionRange(selection[0], selection[1])
    if (rangePosition && active.isContentEditable && rangePosition.start.isConnected) {
      const restored = document.createRange()
      restored.setStart(rangePosition.start, rangePosition.startOffset)
      restored.setEnd(rangePosition.end, rangePosition.endOffset)
      document.getSelection()?.removeAllRanges()
      document.getSelection()?.addRange(restored)
    }
  }
}

export function paginateProcedureReport(document: Document) {
  const preview = document.defaultView
  const host = document.getElementById('report-pages')
  const position = {
    left: preview?.scrollX ?? 0, top: preview?.scrollY ?? 0, horizontal: host?.scrollLeft ?? 0,
  }
  // Always paginate at the original A4 scale, regardless of screen magnification.
  document.documentElement.classList.add('report-paginating')
  try {
    layoutProcedureReport(document)
  } finally {
    document.documentElement.classList.remove('report-paginating')
    if (host) host.scrollLeft = position.horizontal
    preview?.scrollTo(position.left, position.top)
  }
}

function layoutProcedureReport(document: Document) {
  const host = document.getElementById('report-pages')
  const footer = document.querySelector('footer')?.cloneNode(true)
  if (!host || !footer) return
  const restoreFocus = preserveEditingFocus(document)
  const blocks = reportBlocks(document)
  host.replaceChildren()
  let page: HTMLDivElement
  const newPage = () => {
    const sheet = document.createElement('article')
    sheet.className = 'report-sheet'
    page = document.createElement('div')
    page.className = 'page-content'
    sheet.append(page, footer.cloneNode(true))
    host.append(sheet)
  }
  newPage()
  const fits = (reserve = 0) => {
    const last = page.lastElementChild
    if (!last) return true
    const usedHeight = last.getBoundingClientRect().bottom - page.getBoundingClientRect().top
    return usedHeight + reserve <= page.clientHeight + .5
  }
  const moveTableToNewPage = (fragment: HTMLElement) => {
    const previous = fragment.previousElementSibling
    const heading = previous?.matches('h2, .dosing-heading') && previous.previousElementSibling
      ? previous : null
    fragment.remove()
    heading?.remove()
    newPage()
    if (heading) page.append(heading)
  }
  const placeTable = (block: HTMLElement) => {
    const rows = [...block.querySelectorAll('tbody > tr')]
    // Fixed column widths let us measure all rows together before moving any.
    const heights = rows.map(row => row.getBoundingClientRect().height)
    const headerHeight = block.querySelector('tbody')!.getBoundingClientRect().top
      - block.getBoundingClientRect().top
    const skeleton = block.cloneNode(false) as HTMLElement
    const table = block.querySelector('table')!
    const tableSkeleton = table.cloneNode(false) as HTMLElement
    tableSkeleton.append(...[...table.children].map(child => child.cloneNode(child.tagName !== 'TBODY')))
    skeleton.append(tableSkeleton)
    block.remove()
    let start = 0
    while (start < rows.length) {
      const fragment = skeleton.cloneNode(true) as HTMLElement
      page.append(fragment)
      const available = page.getBoundingClientRect().top + page.clientHeight
        - fragment.getBoundingClientRect().top - headerHeight
      let end = start
      let used = 0
      while (end < rows.length && used + heights[end] <= available + .5) {
        used += heights[end++]
      }
      if (end === start && page.children.length > 1) {
        moveTableToNewPage(fragment)
        continue
      }
      end = Math.max(start + 1, end)
      fragment.querySelector('tbody')!.append(...rows.slice(start, end))
      // Collapsed borders can differ by a fraction of a pixel at a page break.
      while (end > start + 1 && !fits()) rows[--end].remove()
      start = end
      if (start < rows.length) newPage()
    }
  }
  const placeParagraph = (block: HTMLElement) => {
    let remaining = Array.from(textElement(block).textContent || '')
    const template = block.cloneNode(true) as HTMLElement
    textElement(template).replaceChildren()
    do {
      const paragraph = template.cloneNode(true) as HTMLElement
      const content = textElement(paragraph)
      page.append(paragraph)
      let low = 0
      let high = remaining.length
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        content.textContent = remaining.slice(0, middle).join('')
        if (fits()) low = middle
        else high = middle - 1
      }
      if (low === 0 && page.children.length > 1) {
        paragraph.remove()
        newPage()
        continue
      }
      const count = Math.max(1, low)
      content.textContent = remaining.slice(0, count).join('')
      remaining = remaining.slice(count)
      if (remaining.length) newPage()
    } while (remaining.length)
  }
  for (const block of blocks) {
    page!.append(block)
    const reserve = block.matches('h2, .dosing-heading') ? 44 : 0
    if (fits(reserve)) continue
    if (block.dataset.reportTable) {
      placeTable(block)
      continue
    }
    block.remove()
    if (block.dataset.reportText) placeParagraph(block)
    else {
      if (page!.children.length) newPage()
      page!.append(block)
    }
  }
  const sheets = [...host.querySelectorAll('.report-sheet')]
  sheets.forEach((sheet, index) => {
    const number = sheet.querySelector('.page-number')
    if (number) number.textContent = sheets.length > 1 ? `${index + 1} / ${sheets.length}` : ''
  })
  restoreFocus()
}

async function waitForReportFonts(preview: Window) {
  let timer = 0
  try {
    await Promise.race([
      preview.document.fonts.ready,
      new Promise<void>(resolve => { timer = preview.setTimeout(resolve, 1500) }),
    ])
  } finally {
    preview.clearTimeout(timer)
  }
}

function initialDosingState(document: Document): DosingState {
  return {
    basis: '', referenceRow: null,
    rows: [...document.querySelectorAll<HTMLElement>('[data-dosing-row]')].map(row => ({
      molecularWeight: row.dataset.molecularWeight ?? '',
      density: '',
      equivalent: row.dataset.equivalent ?? '',
      planned: '', mmol: '', actual: '',
    })),
  }
}

export function initializeProcedureReport(preview: Window) {
  const document = preview.document
  const host = document.getElementById('report-pages')
  if (!host) return
  const originalContent = host.cloneNode(true) as HTMLElement
  let state = initialDosingState(document)
  let frame = 0
  const displayedFieldValue = (field: HTMLInputElement) => {
    if (field.id === 'basis-mmol') return formatDosingValue(state.basis, 'basis')
    const index = Number(field.closest<HTMLElement>('[data-dosing-row]')?.dataset.dosingRow)
    const kind = field.dataset.field as DosingField
    return formatDosingValue(state.rows[index][kind], kind, state.rows[index].density)
  }
  const validatePositiveInput = (input: HTMLInputElement) => {
    const value = input.value.trim()
    const valid = value === '' || (/^[\d.e+-]+$/iu.test(value) && Number.isFinite(Number(value)) && Number(value) > 0)
    input.setAttribute('aria-invalid', String(!valid))
    const label = input.dataset.field === 'molecularWeight' ? '分子量（g/mol）' : '密度（g/mL）'
    input.title = valid ? `填写${label}；修改时保留物质的量。` : `请输入大于 0 的${label}`
  }
  const syncPrintedValues = (editing?: HTMLInputElement) => {
    document.querySelectorAll<HTMLInputElement>('input').forEach(field => {
      const value = displayedFieldValue(field)
      if (field !== editing) field.value = value
      field.setAttribute('value', value)
      field.parentElement?.setAttribute('data-value', value || (field.dataset.field === 'molecularWeight' ? '待确认' : ''))
      if (field.dataset.field === 'molecularWeight') {
        const row = field.closest<HTMLElement>('[data-dosing-row]')!
        const original = row.dataset.molecularWeight ?? ''
        const current = state.rows[Number(row.dataset.dosingRow)].molecularWeight
        const sameNumber = current.trim() !== '' && original.trim() !== '' && Number(current) === Number(original)
        const edited = current.trim() !== original.trim() && !sameNumber
        field.parentElement?.toggleAttribute('data-manually-edited', edited)
        field.setAttribute('aria-description', edited ? '已手动修改分子量' : '可手动填写分子量')
      }
    })
  }
  const schedulePagination = () => {
    preview.cancelAnimationFrame(frame)
    frame = preview.requestAnimationFrame(() => {
      if (!document.activeElement?.matches('input, [contenteditable]')) paginateProcedureReport(document)
    })
  }
  document.addEventListener('pointerout', event => {
    const cell = (event.target as Element | null)?.closest?.('.report-name-cell')
    const next = event.relatedTarget as Node | null
    // Switching tabs can send a null relatedTarget. Keep the controls dismissed
    // until the pointer actually moves out of this cell within the report.
    if (next?.nodeType && !cell?.contains(next)) cell?.classList.remove('report-actions-hidden')
  })
  document.addEventListener('pointerdown', event => {
    (event.target as Element | null)?.closest?.('.report-name-cell')?.classList.remove('report-actions-hidden')
  })
  document.addEventListener('focusin', event => {
    (event.target as Element | null)?.closest?.('.report-row-actions')
      ?.closest('.report-name-cell')?.classList.remove('report-actions-hidden')
  })
  document.addEventListener('click', event => {
    const action = (event.target as Element | null)?.closest?.<HTMLElement>('[data-search-report-row], [data-delete-report-row]')
    if (!action) return
    action.closest('.report-name-cell')?.classList.add('report-actions-hidden')
    action.blur()
    if (!action.matches('[data-delete-report-row]')) return
    const deletion = removeProcedureReportRow(document, action as HTMLButtonElement, state)
    if (!deletion) return
    state = deletion.state
    syncPrintedValues()
    preview.cancelAnimationFrame(frame)
    paginateProcedureReport(document)
    if (event.detail === 0) deletion.focusTarget?.focus({ preventScroll: true })
    else document.elementFromPoint(event.clientX, event.clientY)?.closest('.report-name-cell')?.classList.add('report-actions-hidden')
  })
  document.addEventListener('input', event => {
    const input = event.target as HTMLInputElement
    if (input.isContentEditable) {
      if (input.matches('.report-name-cell > strong')) input.title = input.textContent || ''
      return
    }
    const row = input.closest<HTMLElement>('[data-dosing-row]')
    if (input.id === 'basis-mmol' || (row && input.dataset.field)) {
      state = updateDosing(state, row ? Number(row.dataset.dosingRow) : null,
        input.id === 'basis-mmol' ? 'basis' : input.dataset.field as DosingField, input.value)
      if (['molecularWeight', 'density'].includes(input.dataset.field ?? '')) validatePositiveInput(input)
      syncPrintedValues(input)
    }
  })
  document.addEventListener('focusout', event => {
    const input = event.target as HTMLInputElement
    if (input.isContentEditable) {
      schedulePagination()
      return
    }
    if (input.id !== 'basis-mmol' && !input.dataset.field) return
    syncPrintedValues()
    schedulePagination()
  })
  document.getElementById('print-report')?.addEventListener('click', async () => {
    if (document.fonts.status === 'loading') await waitForReportFonts(preview)
    if (preview.closed) return
    preview.focus()
    preview.print()
  })
  document.getElementById('close-report')?.addEventListener('click', () => preview.close())
  preview.addEventListener('beforeprint', () => {
    preview.cancelAnimationFrame(frame)
    syncPrintedValues()
    paginateProcedureReport(document)
  })
  // Render immediately so loading fonts cannot leave an overflowing single page.
  paginateProcedureReport(document)
  const resetZoom = initializeProcedureReportZoom(preview)
  document.getElementById('reset-report')?.addEventListener('click', () => {
    preview.cancelAnimationFrame(frame)
    const restored = originalContent.cloneNode(true) as HTMLElement
    host.replaceChildren(...restored.childNodes)
    state = initialDosingState(document)
    document.getSelection()?.removeAllRanges()
    paginateProcedureReport(document)
    resetZoom?.()
    syncPrintedValues()
    host.scrollLeft = 0
    preview.scrollTo(0, 0)
  })
  if (document.fonts.status === 'loading') {
    document.fonts.ready.then(() => {
      if (!preview.closed) schedulePagination()
    })
  }
}
