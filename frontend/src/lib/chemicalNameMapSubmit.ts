import { chemicalNameMapAPI, type ChemicalNameMapItem } from '@/api/client'

type MasterPayload = Parameters<typeof chemicalNameMapAPI.create>[0]

/** 保存主数据后继续入架；后续步骤失败时，不重复创建已经成功的主数据。 */
export function createChemicalNameMapWriter() {
  const saved = new Map<string, { payload: string; item: ChemicalNameMapItem }>()
  const keyFor = (item: ChemicalNameMapItem | null, draftKey: string) => item ? `edit:${item.id}` : `create:${draftKey}`
  return {
    async save(item: ChemicalNameMapItem | null, payload: MasterPayload, draftKey: string) {
      const key = keyFor(item, draftKey)
      const previous = saved.get(key)
      const fingerprint = JSON.stringify(payload)
      if (previous?.payload === fingerprint) return
      const target = previous?.item ?? item
      const response = target ? await chemicalNameMapAPI.update(target.id, payload) : await chemicalNameMapAPI.create(payload)
      saved.set(key, { payload: fingerprint, item: response.data })
    },
    clear(item: ChemicalNameMapItem | null, draftKey: string) { saved.delete(keyFor(item, draftKey)) },
  }
}
