import { removeDosingRow, type DosingState } from './procedureReportCalculations'

export function removeProcedureReportRow(document: Document, button: HTMLButtonElement, state: DosingState) {
  const row = button.closest<HTMLTableRowElement>('tbody > tr')
  const group = row?.closest<HTMLElement>('[data-report-table]')
  const kind = group?.dataset.reportTable
  if (!row || !group || !['inventory', 'dosing'].includes(kind || '')) return null

  const selector = `[data-report-table="${kind}"] tbody > tr`
  const rows = [...document.querySelectorAll<HTMLTableRowElement>(selector)]
  const index = rows.indexOf(row)
  const neighbor = rows[index + 1] || rows[index - 1]
  let nextState = state
  if (kind === 'dosing') {
    nextState = removeDosingRow(state, Number(row.dataset.dosingRow))
    if (nextState === state) return null
  }

  const body = row.parentElement!
  row.remove()
  if (kind === 'dosing') {
    document.querySelectorAll<HTMLElement>('[data-dosing-row]').forEach((remaining, rowIndex) => {
      remaining.dataset.dosingRow = String(rowIndex)
    })
  }
  if (!document.querySelector(selector)) {
    const emptyRow = document.createElement('tr')
    const cell = document.createElement('td')
    cell.colSpan = group.querySelectorAll('thead th').length
    cell.className = 'empty'
    cell.textContent = '暂无记录'
    emptyRow.append(cell)
    body.append(emptyRow)
  }
  const focusTarget = neighbor?.querySelector<HTMLButtonElement>('[data-delete-report-row]')
    || document.getElementById('print-report')
  return { state: nextState, focusTarget }
}
