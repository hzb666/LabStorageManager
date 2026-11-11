import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { chrome, openBrowser } from './helpers/browser.mjs'

test('table text selection leaves expansion unchanged and subsequent text clicks still toggle', {
  skip: chrome ? false : 'Chrome/Chromium is required; set CHROME_PATH to enable browser regressions',
  timeout: 30000,
}, async t => {
  const browser = await openBrowser()
  t.after(browser.close)
  const { outputFiles } = await build({
    absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'iife',
    tsconfig: 'tsconfig.app.json',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
    stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'tsx', contents: `
      import React, { useRef, useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
      import { DataTableBody } from './src/components/ui/DataTableBody'
      import { useDataTableScroll } from './src/hooks/useDataTableScroll'
      const data = [{ id: '1', name: 'N-Methylmorpholine 化学试剂 64-17-5' }]
      const columns = [{ accessorKey: 'name', cell: info => <span id="reagent-name">{info.getValue()}</span> },
        { id: 'action', cell: () => <button id="row-action" onClick={e => { e.stopPropagation(); window.actionCount++ }}>编辑</button> }]
      window.actionCount = 0
      function Fixture() {
        const [expanded, setExpanded] = useState({})
        const [virtual, setVirtual] = useState(false)
        const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel(),
          getRowCanExpand: () => true, state: { expanded }, onExpandedChange: setExpanded })
        const bodyScrollRef = useRef(null)
        const { handleRowClick } = useDataTableScroll({ bodyScrollRef })
        const rowVirtualizer = { getTotalSize: () => 100, getVirtualItems: () => [{ index: 0, key: '1', start: 0 }], measureElement: () => {} }
        return <><p id="outside">Outside selection should not block row clicks.</p>
          <button id="virtual-mode" onClick={() => { setVirtual(v => !v); setExpanded({}) }}>切换虚拟列表</button>
          <div ref={bodyScrollRef}><DataTableBody rows={table.getRowModel().rows} rowVirtualizer={rowVirtualizer}
            shouldUseVirtualization={virtual} minTableWidth={600} handleRowClick={handleRowClick}
            renderExpandedRow={() => <div id="expanded">Expanded details</div>} disableExpandedRowAnimation /></div></>
      }
      createRoot(document.getElementById('root')).render(<Fixture />)
    ` },
  })
  const path = join(browser.temporary, 'table.html')
  await writeFile(path, `<!doctype html><meta charset="utf-8"><style>body{font:16px Arial} .flex{display:flex}.p-3{padding:12px} #root{width:800px} #row-action{margin-left:20px}</style><div id="root"></div><script>${outputFiles[0].text}</script>`)
  const { send } = browser
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
    return response.result.value
  }
  await send('Page.navigate', { url: pathToFileURL(path).href }, sessionId)
  await send('Page.bringToFront', {}, sessionId)
  await evaluate('new Promise(resolve=>{const check=()=>document.getElementById("reagent-name")?resolve():setTimeout(check,20);check()})')
  const tick = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const expanded = () => evaluate('!!document.getElementById("expanded")')
  const bounds = selector => evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`)
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId)
    await tick()
  }
  for (const virtual of [false, true]) {
    await t.test(virtual ? 'virtual rows' : 'ordinary rows', async () => {
      if (virtual) { await evaluate('document.getElementById("virtual-mode").click()'); await tick() }
      const r = await bounds('#reagent-name')
      const x = r.x + 2, y = r.y + r.height / 2
      await click(x, y)
      assert.equal(await expanded(), true, 'a text click expands')
      const drag = async reverse => {
        const start = reverse ? r.x + 160 : x
        const end = reverse ? x : r.x + 160
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start, y }, sessionId)
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start, y, button: 'left', buttons: 1, clickCount: 1 }, sessionId)
        for (let step = 1; step <= 5; step++) {
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start + (end - start) * step / 5, y, button: 'left', buttons: 1 }, sessionId)
        }
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end, y, button: 'left', clickCount: 1 }, sessionId)
        await tick()
        assert.ok(await evaluate('getSelection().toString().length>0'), 'native text selection is preserved')
      }
      await drag(false)
      assert.equal(await expanded(), true, 'dragging does not collapse an expanded row')
      await click(x + 40, y)
      assert.equal(await expanded(), false, 'the next text click collapses without delay')
      await drag(true)
      assert.equal(await expanded(), false, 'backwards selection does not expand a collapsed row')
      await evaluate(`(()=>{const r=document.createRange();r.selectNodeContents(document.getElementById('outside'));getSelection().removeAllRanges();getSelection().addRange(r)})()`)
      await click(r.x + r.width + 10, y)
      assert.equal(await expanded(), true, 'an old selection elsewhere does not block a blank-area click')
      const action = await bounds('#row-action')
      const before = await evaluate('window.actionCount')
      await click(action.x + action.width / 2, action.y + action.height / 2)
      assert.equal(await evaluate('window.actionCount'), before + 1, 'row actions still work')
      assert.equal(await expanded(), true, 'row actions do not change expansion')
    })
  }
})
