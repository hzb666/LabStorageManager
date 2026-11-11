import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'
import { build } from 'esbuild'

const directory = fileURLToPath(new URL('..', import.meta.url))
const source = ts.createSourceFile('CommonShelf.tsx', await readFile(new URL('../src/pages/CommonShelf.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = new Set(['normalizeOptionalText', 'normalizeCategoryValue', 'buildChemicalNameMapPayload',
  'buildChemicalNameMapForm', 'runWithSubmitting', 'useChemicalNameMapController'])
const controller = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
  .map(node => node.getText(source)).join('\n')
const defaults = source.statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(item => item.name.getText(source) === 'DEFAULT_CHEMICAL_NAME_MAP_FORM')).getText(source)
const mocks = {
  react: `
    export const hooks={cells:[],cursor:0};
    export function useState(initial){const i=hooks.cursor++;if(!(i in hooks.cells))hooks.cells[i]=typeof initial==='function'?initial():initial;
      return[hooks.cells[i],value=>{hooks.cells[i]=typeof value==='function'?value(hooks.cells[i]):value}]}
    export function useMemo(factory,deps){const i=hooks.cursor++,old=hooks.cells[i];
      if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))hooks.cells[i]={value:factory(),deps};return hooks.cells[i].value}
    export const useCallback=(fn,deps)=>useMemo(()=>fn,deps);
    export const useRef=value=>useMemo(()=>({current:value}),[]);`,
  'react-router-dom': `export const useLocation=()=>({key:'same-page'})`,
  '@tanstack/react-query': `export const isCancelledError=()=>false`,
  axios: `export default {isCancel:()=>false}`,
  'test-runtime': `export const runtime={}`,
  '@/api/client': `import{runtime}from'test-runtime';
    export const chemicalNameMapAPI={
      create:async(payload,options)=>{runtime.calls.push(['create',payload,options]);if(runtime.failCreate)throw Error('create failed');return{data:{id:42,...payload}}},
      update:async(id,payload,options)=>{runtime.calls.push(['update',id,payload,options]);return{data:{id,...payload}}}};
    export const commonShelfAPI={manualAdd:async(payload,options)=>{runtime.shelfCalls.push([payload,options]);if(runtime.failShelf)throw Error('shelf failed')}};`,
  '@/lib/toast': `import{runtime}from'test-runtime';export const toast={
    success:m=>runtime.notices.push(['success',m]),error:m=>runtime.notices.push(['error',m]),warning:m=>runtime.notices.push(['warning',m])};`,
}
const { outputFiles } = await build({
  absWorkingDir: directory, tsconfig: 'tsconfig.app.json', bundle: true, write: false, platform: 'node', format: 'esm',
  stdin: { resolveDir: directory, loader: 'ts', contents: `
    import{useState,useMemo,useCallback}from'react';import{hooks}from'react';import{runtime}from'test-runtime';
    import{useFormDraft}from'@/hooks/useFormDraft';import{useSubmissionState}from'@/hooks/useSubmissionState';
    import{refreshAfterMutation}from'@/lib/mutationRefresh';import{createChemicalNameMapWriter}from'@/lib/chemicalNameMapSubmit';
    import{chemicalNameMapAPI,commonShelfAPI}from'@/api/client';import{toast}from'@/lib/toast';
    const useForm=()=>runtime.form, createValibotResolver=()=>undefined, ChemicalNameMapSchema={};
    const useChemicalQuickOrderAction=()=>()=>{},useChemicalNameMapColumns=()=>[];
    const extractApiErrorDetail=e=>e.message,applyFormValidationDetail=()=>false,createFormFieldErrorSetter=()=>()=>{};
    const normalizeApiErrorMessage=(e,fallback)=>e||fallback,getApiErrorMessage=(e,fallback)=>e.message||fallback;
    ${defaults}\n${controller}
    export function createHarness(){hooks.cells=[];hooks.cursor=0;
      Object.assign(runtime,{values:structuredClone(DEFAULT_CHEMICAL_NAME_MAP_FORM),calls:[],shelfCalls:[],notices:[],failCreate:false,failShelf:false,
        refreshMaster:async()=>{},refreshShelf:async()=>{}});
      runtime.form={getValues:()=>runtime.values,reset:value=>{runtime.values=structuredClone(value)},
        setError:()=>{},handleSubmit:callback=>async()=>callback(structuredClone(runtime.values))};
      let current;
      const render=()=>{hooks.cursor=0;current=useChemicalNameMapController({canWrite:true,openQuickOrderDialog(){},openManualAddDialog(){},
        refreshChemicalNameMap:()=>runtime.refreshMaster(),refreshCommonShelf:()=>runtime.refreshShelf(),resetCommonShelfDialog(){}});return current};
      return{runtime,render,get current(){return current},setValues:value=>Object.assign(runtime.values,value)};
    }
  ` },
  plugins: [{ name: 'controller-boundary', setup(builder) {
    for (const name of Object.keys(mocks)) {
      builder.onResolve({ filter: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }, () => ({ path: name, namespace: 'mock' }))
    }
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], resolveDir: directory }))
  } }],
})
const { createHarness } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)

function openCreate(harness) { harness.current.openCreateDialog(); return harness.render() }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function until(predicate) { for (let i = 0; i < 40 && !predicate(); i++) await Promise.resolve(); assert.ok(predicate()) }

test('a successful CAS creation clears immediately and a slow refresh cannot clear the next draft', async () => {
  const h = createHarness()
  h.render(); openCreate(h)
  h.setValues({ cas_number: '64-17-5', name: '乙醇' })
  const staleClose = h.current.editorDialog.onOpenChange
  const refresh = deferred()
  let refreshing = false
  h.runtime.refreshMaster = () => { refreshing = true; return refresh.promise }
  const submit = h.current.editorDialog.onSubmit()
  await until(() => refreshing)
  h.render()
  assert.equal(h.current.editorDialog.open, false)
  assert.equal(h.runtime.values.cas_number, '')
  staleClose(false)
  h.render(); openCreate(h)
  assert.equal(h.runtime.values.cas_number, '')
  h.setValues({ cas_number: '67-64-1', name: '丙酮' })
  refresh.resolve(); await submit; h.render()
  assert.equal(h.runtime.values.cas_number, '67-64-1')
  h.runtime.refreshMaster = async () => {}
  await h.current.editorDialog.onSubmit(); h.render()
  assert.deepEqual(h.runtime.calls.map(call => call[0]), ['create', 'create'])
  assert.notEqual(h.runtime.calls[0][2].mutationScope, h.runtime.calls[1][2].mutationScope)
  openCreate(h)
  assert.equal(h.runtime.values.cas_number, '')
})

test('an unfinished CAS draft survives dismissal and a failed save, then clears after success', async () => {
  const h = createHarness()
  h.render(); openCreate(h)
  h.setValues({ cas_number: '64-17-5', name: '乙醇' })
  h.current.editorDialog.onOpenChange(false); h.render(); openCreate(h)
  assert.equal(h.runtime.values.name, '乙醇')
  h.runtime.failCreate = true
  await h.current.editorDialog.onSubmit(); h.render()
  assert.equal(h.current.editorDialog.open, true)
  assert.equal(h.runtime.values.cas_number, '64-17-5')
  h.runtime.failCreate = false
  await h.current.editorDialog.onSubmit(); h.render(); openCreate(h)
  assert.equal(h.runtime.values.cas_number, '')
})

test('a failed shelf step keeps its saved CAS and retries without creating it again', async () => {
  const h = createHarness()
  h.render()
  h.current.promptCreateForMissingCas({ cas_number: '64-17-5', name_snapshot: '乙醇', count: 1 })
  h.render()
  h.runtime.failShelf = true
  await h.current.editorDialog.onSubmit(); h.render()
  assert.equal(h.current.editorDialog.open, true)
  assert.equal(h.current.editorDialog.casLocked, true)
  assert.equal(h.runtime.values.cas_number, '64-17-5')
  h.runtime.failShelf = false
  await h.current.editorDialog.onSubmit(); h.render()
  assert.equal(h.current.editorDialog.open, false)
  assert.equal(h.runtime.values.cas_number, '')
  assert.equal(h.runtime.calls.length, 1)
  assert.equal(h.runtime.shelfCalls.length, 2)
})
