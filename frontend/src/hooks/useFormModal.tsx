import { useCallback, useState } from 'react'

/**
 * 验证规则类型
 * 每个规则包含字段名和对应的验证函数
 */
export type ValidationRule<T> = {
  field: keyof T
  validator: (value: unknown, formData?: T) => { isValid: boolean; error?: string }
}

/**
 * useFormModal 配置选项
 */
export interface UseFormModalOptions<T> {
  /** 初始表单数据 */
  initialData: T
  /** 验证规则数组 */
  validationRules?: ValidationRule<T>[]
  /** 表单提交回调 */
  onSubmit?: (data: T) => Promise<void>
}

/**
 * useFormModal 返回值
 */
export interface UseFormModalReturn<T> {
  /** 表单数据 */
  formData: T
  /** 表单错误信息 */
  formErrors: Partial<Record<keyof T, string>>
  /** 是否正在提交 */
  submitting: boolean
  /** 设置表单数据 */
  setFormData: React.Dispatch<React.SetStateAction<T>>
  /** 字段变更处理函数 */
  handleChange: (field: keyof T, value: string | number | boolean) => void
  /** 验证表单 */
  validateForm: () => boolean
  /** 重置表单 */
  resetForm: () => void
  /** 提交表单 */
  handleSubmit: (e?: React.FormEvent) => Promise<void>
  /** 清除单个字段错误 */
  clearFieldError: (field: keyof T) => void
}

/**
 * 通用表单Modal Hook
 * 封装表单状态管理、验证和提交流逻辑
 * 
 * @example
 * ```tsx
 * const {
 *   formData,
 *   formErrors,
 *   submitting,
 *   handleChange,
 *   validateForm,
 *   resetForm,
 *   handleSubmit
 * } = useFormModal({
 *   initialData: { name: '', quantity: 0 },
 *   validationRules: [
 *     { field: 'name', validator: (v) => validateRequired(v, '名称') },
 *     { field: 'quantity', validator: (v) => validatePositiveNumber(v, '数量') }
 *   ],
 *   onSubmit: async (data) => {
 *     await api.save(data)
 *   }
 * })
 * ```
 */
export function useFormModal<T>({
  initialData,
  validationRules = [],
  onSubmit
}: UseFormModalOptions<T>): UseFormModalReturn<T> {
  const [formData, setFormData] = useState<T>(initialData)
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof T, string>>>({})
  const [submitting, setSubmitting] = useState(false)

  /**
   * 重置表单
   */
  const resetForm = useCallback(() => {
    setFormData(initialData)
    setFormErrors({})
  }, [initialData])

  /**
   * 清除单个字段错误
   */
  const clearFieldError = useCallback((field: keyof T) => {
    setFormErrors(prev => {
      const newErrors = { ...prev }
      delete newErrors[field]
      return newErrors
    })
  }, [])

  /**
   * 字段变更处理
   */
  const handleChange = useCallback((field: keyof T, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    // 清除该字段的错误提示
    clearFieldError(field)
  }, [clearFieldError])

  /**
   * 验证表单
   * @returns 验证是否通过
   */
  const validateForm = useCallback((): boolean => {
    const errors: Partial<Record<keyof T, string>> = {}

    for (const rule of validationRules) {
      const value = formData[rule.field]
      const result = rule.validator(value, formData)
      
      if (!result.isValid) {
        errors[rule.field] = result.error || '验证失败'
      }
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }, [formData, validationRules])

  /**
   * 提交表单
   */
  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault()
    }

    if (!validateForm()) {
      return
    }

    if (!onSubmit) {
      console.warn('useFormModal: onSubmit callback not provided')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit(formData)
    } finally {
      setSubmitting(false)
    }
  }, [formData, validateForm, onSubmit])

  return {
    formData,
    formErrors,
    submitting,
    setFormData,
    handleChange,
    validateForm,
    resetForm,
    handleSubmit,
    clearFieldError
  }
}
