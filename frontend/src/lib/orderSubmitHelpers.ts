export type DialogSubmitState = 'edit' | 'add' | null

// 按弹窗模式统一执行“新增/编辑”请求分支，保持页面提交编排简洁。
export async function submitByDialogState<TItem, TFormData>(params: {
  dialogState: DialogSubmitState
  editingItem: TItem | null
  formData: TFormData
  onCreate: (formData: TFormData) => Promise<unknown>
  onUpdate: (editingItem: TItem, formData: TFormData) => Promise<unknown>
}): Promise<void> {
  const { dialogState, editingItem, formData, onCreate, onUpdate } = params

  if (dialogState === 'edit' && editingItem) {
    await onUpdate(editingItem, formData)
    return
  }

  if (dialogState === 'add') {
    await onCreate(formData)
  }
}

// 返回弹窗模式对应的成功提示，避免各页面重复维护同一分支逻辑。
export function getDialogSubmitSuccessMessage(
  dialogState: DialogSubmitState,
  messages: { edit: string; add: string },
): string | null {
  if (dialogState === 'edit') {
    return messages.edit
  }
  if (dialogState === 'add') {
    return messages.add
  }
  return null
}
