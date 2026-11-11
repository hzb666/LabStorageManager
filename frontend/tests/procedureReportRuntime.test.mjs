import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { chrome, openBrowser } from './helpers/browser.mjs'

const directory = fileURLToPath(new URL('..', import.meta.url))
test('report editing preserves native IME, pending calculations, pagination and reset', {
  skip: chrome ? false : 'Chrome/Chromium is required; set CHROME_PATH to enable browser regressions',
  timeout: 30000,
}, async t => {
  const browser = await openBrowser()
  t.after(browser.close)
  const { send } = browser
  const [report, runtime] = await Promise.all(['procedureReport', 'procedureReportRuntime'].map(name =>
    build({ absWorkingDir: directory, entryPoints: [`src/lib/${name}.ts`], bundle: true,
      write: false, format: name === 'procedureReport' ? 'esm' : 'iife',
      globalName: name === 'procedureReport' ? undefined : 'ReportRuntime' })))
  const { buildProcedureReportHtml } = await import(`data:text/javascript;base64,${Buffer.from(report.outputFiles[0].text).toString('base64')}`)
  const result = { formatted_text: '加入乙醇后搅拌。\n\n取样并记录反应现象。', analysis_items: [
    { name: '乙醇', status: 'resolved', cas_number: '64-17-5', equivalent: 2 },
    { name: '丙酮', status: 'resolved', cas_number: '67-64-1', equivalent: 1 },
  ] }
  const data = { generated_at: '2026-10-30T00:00:00Z', inventory_groups: [], compounds: [
    { cas_number: '64-17-5', molecular_weight: 46.069 },
    { cas_number: '67-64-1', molecular_weight: 58.08 },
  ] }
  const html = buildProcedureReportHtml({ result, report: data, author: '实验员' },
    await readFile(join(directory, 'src/lib/procedureReport.css'), 'utf8'))
  const path = join(browser.temporary, 'report.html')
  await writeFile(path, html.replace('</body>', `<script>${runtime.outputFiles[0].text};ReportRuntime.initializeProcedureReport(window);window.reportReady=true;</script></body>`))
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
    return response.result.value
  }
  await send('Page.navigate', { url: pathToFileURL(path).href }, sessionId)
  await evaluate('new Promise(resolve=>{const check=()=>window.reportReady?resolve():setTimeout(check,20);check()})')
  const tick = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const reset = async () => { await evaluate('document.getElementById("reset-report").click()'); await tick() }

  await t.test('manual weights recalculate amounts and retain their marker through printing, then reset', async () => {
    const weight = '[data-dosing-row="0"] [data-field="molecularWeight"]'
    const enter = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(weight)}).value`), '46.07')
    assert.equal(await evaluate(`document.querySelectorAll('[data-manually-edited]').length`), 0)
    await enter('[data-dosing-row="0"] [data-field="mmol"]', '2')
    await enter(weight, '100.12345')
    await tick()
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(weight)}).value`), '100.12345')
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(weight)}).parentElement.hasAttribute('data-manually-edited')`), true)
    assert.equal(await evaluate(`document.querySelector('[data-dosing-row="0"] [data-field="planned"]').value`), '200.25 mg')
    assert.equal(await evaluate(`document.getElementById('basis-mmol').value`), '1.00')
    await evaluate('document.getElementById("print-report").focus();dispatchEvent(new Event("beforeprint"));dispatchEvent(new Event("beforeprint"))')
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(weight)}).value`), '100.12')
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(weight)}).parentElement.dataset.value`), '100.12')
    await send('Emulation.setEmulatedMedia', { media: 'print' }, sessionId)
    assert.equal(await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(weight)}).parentElement,'::before').backgroundColor`), 'rgb(37, 99, 235)')
    await send('Emulation.setEmulatedMedia', { media: '' }, sessionId)
    await enter(weight, '46.069')
    assert.equal(await evaluate(`document.querySelectorAll('[data-manually-edited]').length`), 0)
    await enter(weight, '100')
    await reset()
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(weight)}).value`), '46.07')
    assert.equal(await evaluate(`document.querySelectorAll('[data-manually-edited]').length`), 0)
    assert.equal(await evaluate(`document.querySelector('[data-dosing-row="0"] [data-field="planned"]').value`), '')
  })
  await t.test('invalid weights remain editable, show validation and stop quantity conversion', async () => {
    await evaluate(`(()=>{const amount=document.querySelector('[data-dosing-row="0"] [data-field="mmol"]');amount.value='2';amount.dispatchEvent(new Event('input',{bubbles:true}));const e=document.querySelector('[data-field="molecularWeight"]');e.value='-1';e.dispatchEvent(new Event('input',{bubbles:true}));e.focus()})()`)
    await evaluate('document.getElementById("print-report").focus()')
    await tick()
    assert.deepEqual(await evaluate(`(()=>{const e=document.querySelector('[data-field="molecularWeight"]');return {value:e.value,invalid:e.getAttribute('aria-invalid'),planned:document.querySelector('[data-field="planned"]').value}})()`), { value: '-1', invalid: 'true', planned: '' })
    await reset()
  })

  await t.test('Chinese composition commits once in every editable text field', async () => {
    for (const selector of ['h1', '[aria-label="实验名称"]', '.dosing strong', '.procedure-text', '[aria-label="参考文献"]']) {
      await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.textContent='';e.focus()})()`)
      for (const text of ['wu', 'wushui']) {
        await send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length }, sessionId)
        await tick()
      }
      await send('Input.insertText', { text: '无水' }, sessionId)
      await tick()
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`), '无水', selector)
      await reset()
    }
  })
  await t.test('a queued layout cannot reset a newly focused procedure caret', async () => {
    await evaluate(`(()=>{document.querySelector('[aria-label="实验名称"]').focus();const e=document.querySelector('.procedure-text');e.focus();const r=document.createRange();r.setStart(e.firstChild,5);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r)})()`)
    await tick()
    assert.equal(await evaluate('getSelection().anchorOffset'), 5)
    await reset()
  })
  await t.test('a queued text layout cannot format a quantity while it is still being typed', async () => {
    await evaluate(`(()=>{document.querySelector('[aria-label="实验名称"]').focus();const e=document.querySelector('[data-dosing-row="0"] [data-field="planned"]');e.focus();e.value='8';e.dispatchEvent(new Event('input',{bubbles:true}));e.setSelectionRange(1,1)})()`)
    await tick()
    assert.deepEqual(await evaluate(`(()=>{const e=document.activeElement;return{value:e.value,caret:e.selectionStart}})()`), { value: '8', caret: 1 })
    await reset()
  })
  await t.test('typing a unit keeps the prefilled equivalent and recalculates from the correct basis', async () => {
    await evaluate(`document.querySelector('[data-dosing-row="0"] [data-field="planned"]').focus()`)
    for (const text of '80 mg') {
      await send('Input.insertText', { text }, sessionId)
      assert.equal(await evaluate(`document.querySelector('[data-dosing-row="0"] [data-field="equivalent"]').value`), '2.00')
    }
    await evaluate('document.getElementById("print-report").focus();dispatchEvent(new Event("beforeprint"))')
    assert.equal(await evaluate(`document.querySelector('[data-dosing-row="0"] [data-field="planned"]').value`), '80.00 mg')
    const otherMmol = await evaluate(`document.querySelector('[data-dosing-row="1"] [data-field="mmol"]').value`)
    assert.equal(otherMmol, (40 / 46.069).toFixed(2))
    await reset()
  })
  await t.test('long edited procedures paginate on blur and remain intact through printing and reset', async () => {
    const text = '加入试剂，搅拌并记录观察结果。\n\n下一段保留 <tag> 和 & 字符。\n'.repeat(70)
    await evaluate(`(()=>{const e=document.querySelector('.procedure-text');e.textContent='';e.focus()})()`)
    await send('Input.insertText', { text }, sessionId)
    await tick()
    assert.equal(await evaluate('document.querySelectorAll(".report-sheet").length'), 1)
    await evaluate('document.getElementById("print-report").focus()')
    await tick()
    assert.ok(await evaluate('document.querySelectorAll(".report-sheet").length>1'))
    await evaluate('dispatchEvent(new Event("beforeprint"));dispatchEvent(new Event("beforeprint"))')
    assert.equal(await evaluate('[...document.querySelectorAll(".procedure-text")].map(e=>e.textContent).join("")'), text)
    await reset()
    assert.equal(await evaluate('document.querySelector(".procedure-text").textContent'), result.formatted_text)
    assert.equal(await evaluate('document.getElementById("basis-mmol").value'), '')
  })
  await t.test('references use the same text pagination and never merge into the procedure', async () => {
    const reference = Array.from({ length: 80 }, (_, i) => `Reference ${i + 1}: A. Author. Experimental article, 2026.`).join('\n')
    await evaluate(`document.querySelector('[aria-label="参考文献"]').focus()`)
    await send('Input.insertText', { text: reference }, sessionId)
    await evaluate('document.getElementById("print-report").focus()')
    await tick()
    for (let n = 0; n < 3; n++) {
      await evaluate('dispatchEvent(new Event("beforeprint"))')
      assert.equal(await evaluate(`[...document.querySelectorAll('[aria-label="参考文献"]')].map(e=>e.textContent).join('')`), reference)
      assert.equal(await evaluate(`[...document.querySelectorAll('.procedure-text')].map(e=>e.textContent).join('')`), result.formatted_text)
      assert.equal(await evaluate(`[...document.querySelectorAll('.page-content')].some(p=>p.lastElementChild.getBoundingClientRect().bottom>p.getBoundingClientRect().bottom+1)`), false)
    }
    assert.ok(await evaluate(`document.querySelectorAll('.report-reference').length>1`))
    await reset()
    assert.equal(await evaluate(`document.querySelector('[aria-label="参考文献"]').textContent`), '')
    assert.equal(await evaluate(`document.querySelectorAll('.report-reference').length`), 1)
  })
})
