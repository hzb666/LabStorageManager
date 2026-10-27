import { chemicalNameMapAPI, type ChemicalNameMapItem } from '@/api/client'

type MasterPayload = Parameters<typeof chemicalNameMapAPI.create>[0]

/** 保存主数据后继续入架；后续步骤失败时，不重复创建已经成功的主数据。 */
export function createChemicalNameMapWriter() {
  const saved = new Map<string, { payload: string; item: ChemicalNameMapItem }>()
  const keyFor = (item: ChemicalNameMapItem | null, draftKey: string) => item ? `edit:${item.id}` : `create:${draftKey}`
  return {
    hasSaved(item: ChemicalNameMapItem | null, draftKey: string) { return saved.has(keyFor(item, draftKey)) },
    async save(item: ChemicalNameMapItem | null, payload: MasterPayload, draftKey: string, mutationScope?: string) {
      const key = keyFor(item, draftKey)
      const previous = saved.get(key)
      const fingerprint = JSON.stringify(payload)
      const target = previous?.item ?? item
      if (target && target.cas_number !== payload.cas_number) {
        throw new Error('CAS 主数据已保存，请先完成或取消当前入架，再录入其他 CAS')
      }
      if (previous?.payload === fingerprint) return
      const response = target
        ? await chemicalNameMapAPI.update(target.id, payload, { mutationScope })
        : await chemicalNameMapAPI.create(payload, { mutationScope })
      saved.set(key, { payload: fingerprint, item: response.data })
    },
    clear(item: ChemicalNameMapItem | null, draftKey: string) { saved.delete(keyFor(item, draftKey)) },
  }
}
