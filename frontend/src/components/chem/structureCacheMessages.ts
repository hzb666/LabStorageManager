import type { CompoundStructureCache } from '@/api/structureSearchApi'

export type StructureResolveToastVariant = 'success' | 'warning' | 'error'

export interface StructureResolveToastMessage {
  variant: StructureResolveToastVariant
  message: string
}

export function getStructureResolveToastMessage(
  cache: CompoundStructureCache,
): StructureResolveToastMessage {
  if (cache.status === 'resolved') {
    return { variant: 'success', message: '结构解析成功' }
  }
  if (cache.status === 'ambiguous') {
    const count = cache.candidate_count > 0 ? cache.candidate_count : '多个'
    return { variant: 'warning', message: `找到 ${count} 个候选结构，请确认` }
  }
  if (cache.status === 'not_found') {
    return { variant: 'warning', message: '公共源未找到结构信息' }
  }
  if (cache.status === 'invalid_cas') {
    return { variant: 'error', message: 'CAS 无效，无法解析结构' }
  }
  if (cache.status === 'unsupported') {
    return { variant: 'warning', message: '该结构暂不支持自动解析' }
  }
  if (cache.status === 'error') {
    return {
      variant: 'error',
      message: cache.error_message ? `结构解析失败：${cache.error_message}` : '结构解析失败',
    }
  }
  return { variant: 'warning', message: '结构仍在等待解析' }
}
