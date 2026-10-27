import { useMemo } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'
import { useLocation } from 'react-router-dom'

/** 只保存在当前页面内存中，页面卸载或刷新后自然清空。 */
export function createDraftStore<T>(scope = 'page') {
  const drafts = new Map<string, T>()
  return {
    scope,
    save(value: T, key = 'new') { drafts.set(key, structuredClone(value)) },
    load(key = 'new') {
      const value = drafts.get(key)
      return value === undefined ? undefined : structuredClone(value)
    },
    clear(key = 'new') { drafts.delete(key) },
  }
}

export function usePageDraftStore<T>() {
  const { key } = useLocation()
  return useMemo(() => createDraftStore<T>(key), [key])
}

export function useFormDraft<T extends FieldValues>(form: Pick<UseFormReturn<T>, 'getValues' | 'reset'>) {
  const store = usePageDraftStore<T>()
  const { getValues, reset } = form
  return useMemo(() => ({
    save(key?: string) { store.save(getValues(), key) },
    restore(defaults: Parameters<typeof reset>[0], key?: string) { reset(store.load(key) ?? defaults) },
    clear: store.clear,
  }), [getValues, reset, store])
}
