import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import type { UseFormReturn } from 'react-hook-form'
import { CheckCircle, Loader2, Trash2, List, X, ScanSearch } from 'lucide-react'

import {
    authAPI,
    chemicalAPI,
    consumableOrderAPI,
    reagentOrderAPI,
    type ReagentOrderReason,
} from '@/api/client'
import { BaseForm } from '@/components/BaseForm'
import { ReagentCasDuplicateWarning } from '@/components/ReagentCasDuplicateWarning'
import { useReagentCasDuplicateCheck } from '@/hooks/useReagentCasDuplicateCheck'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Label } from '@/components/ui/Label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup'
import {
    ConsumableOrderSchema,
    ReagentOrderSchema,
    applyValidationErrors,
    createValibotResolver,
    extractApiErrorDetail,
    getApiErrorMessage,
    isSpecialCasValue,
    normalizeApiErrorMessage,
    toValidationErrors,
    validateAndNormalizeCASInput,
    type ConsumableOrderFormData,
    type ConsumableOrderFormInputData,
    type ReagentOrderFormData,
    type ReagentOrderFormInputData,
    type ValidationError,
} from '@/lib/validationSchemas'
import {
    defaultConsumableOrderValues,
    defaultReagentOrderValues,
    enhanceCasLookupField,
    getConsumableOrderFormFields,
    getReagentOrderFormFields,
} from '@/lib/formConfigs'
import { REAGENT_STATUS_MAP } from '@/lib/constants'
import { cn, processNotes } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { LoadingButton } from '@/components/ui/LoadingButton'

const CART_STORAGE_KEY = 'cart_import_batch_latest'
const BATCH_TTL_MS = 2 * 60 * 60 * 1000

type OrderType = 'reagent' | 'consumable'

interface CurrentUser {
    id: number
    username: string
    full_name: string | null
}

interface ImportItem {
    id: number
    name: string
    cas_number: string
    english_name: string
    specification: string
    quantity: number
    price?: number
    brand: string
    alias: string
    unit: string
    product_number: string
    is_hazardous: boolean
    order_type: OrderType
    product_id: string
    detail_url: string
}

interface StoredBatch {
    batch_id: string
    items: Array<Partial<ImportItem>>
    created_at: string
}

type ImportTextField =
    | 'name'
    | 'english_name'
    | 'specification'
    | 'brand'
    | 'alias'
    | 'unit'
    | 'product_number'
    | 'product_id'
    | 'detail_url'

type BatchLoadResult =
    | { type: 'loaded'; items: ImportItem[] }
    | { type: 'redirect'; message: string; clearStorage?: boolean }
    | { type: 'retry' }

function readCartImportBatchStorageRaw(): string | null {
    try {
        return localStorage.getItem(CART_STORAGE_KEY)
    } catch {
        return null
    }
}

function clearCartImportBatchStorage(): void {
    try {
        localStorage.removeItem(CART_STORAGE_KEY)
    } catch {
        // ignore storage errors
    }
}

// 判断插件批次是否已经过期。 把 2 小时有效期规则固定在单点，避免批次加载链路散落重复判断。
function isExpiredBatch(batch: StoredBatch): boolean {
    const createdAt = batch?.created_at ? Date.parse(batch.created_at) : Number.NaN
    return Number.isNaN(createdAt) || Date.now() - createdAt > BATCH_TTL_MS
}

// 从混合文本中提取首个 CAS 号。 兼容插件抓取结果中可能夹带的额外文本，而不改变现有 CAS 推断规则。
function extractFirstCasNumber(input: string): string {
    const match = /\b\d{2,7}-\d{2}-\d\b/.exec(String(input || ''))
    return match ? match[0] : ''
}

// 根据 CAS 号判断默认订单类型。 保持购物车导入中“有 CAS 默认为试剂”的既有行为。
function detectOrderType(casNumber: string): OrderType {
    return extractFirstCasNumber(casNumber) ? 'reagent' : 'consumable'
}

// 归一化试剂规格文本。 沿用当前“只保留首段规格”的导入语义，避免提交时把复合规格原样带入。
function normalizeReagentSpecification(specification: string): string {
    const trimmed = (specification || '').trim()
    if (!trimmed) {
        return ''
    }
    return trimmed.split('/')[0].trim()
}

// 返回试剂订单状态的展示文案。 让导入页里的 CAS 重复提示继续复用订单页的同一套状态映射。
function getReagentOrderStatusLabel(status: string): string {
    return REAGENT_STATUS_MAP[status] || status
}

// 判断抓取名称是否只是占位值。 防止插件返回“未知”时直接写入表单，继续要求用户确认中文名。
function isPlaceholderImportName(name: string): boolean {
    const normalized = (name || '').trim()
    return normalized === '未知'
}

// 判断是否跳过中文名回查。 保留当前“已有可靠中文名时不重复覆盖”的导入行为。
function shouldSkipChineseLookupByName(name: string): boolean {
    const normalizedName = (name || '').trim()
    return Boolean(normalizedName && !isPlaceholderImportName(normalizedName))
}

// 读取并裁剪导入条目的字符串字段。 把所有文本清洗规则统一到一个入口，避免 `toImportItem` 堆积大量空值判断。
function readImportText(item: Partial<ImportItem>, field: ImportTextField): string {
    const value = item[field]
    return typeof value === 'string' ? value.trim() : ''
}

// 归一化导入条目的名称。 延续“占位名称不直接写入表单”的既有交互。
function normalizeImportName(item: Partial<ImportItem>): string {
    const rawName = readImportText(item, 'name')
    return isPlaceholderImportName(rawName) ? '' : rawName
}

// 归一化导入条目的数量。 把非法数量回退到 1 的历史行为单独固定下来。
function normalizeImportQuantity(quantity: Partial<ImportItem>['quantity']): number {
    if (typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0) {
        return quantity
    }
    const parsedQuantity = Number(quantity)
    return Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1
}

// 归一化导入条目的价格。 显式区分“有效数值价格”和“应交由表单处理的空值”。
function normalizeImportPrice(price: Partial<ImportItem>['price']): number | undefined {
    return typeof price === 'number' && Number.isFinite(price) ? price : undefined
}

// 将插件抓取条目标准化为页面内部模型。 把导入项清洗逻辑集中在单点，降低批次加载链路的复杂度。
function toImportItem(item: Partial<ImportItem>, index: number): ImportItem {
    const casNumber = extractFirstCasNumber(item.cas_number || '')

    return {
        id: index,
        name: normalizeImportName(item),
        cas_number: casNumber,
        english_name: readImportText(item, 'english_name'),
        specification: readImportText(item, 'specification'),
        quantity: normalizeImportQuantity(item.quantity),
        price: normalizeImportPrice(item.price),
        brand: readImportText(item, 'brand'),
        alias: readImportText(item, 'alias'),
        unit: readImportText(item, 'unit'),
        product_number: readImportText(item, 'product_number'),
        is_hazardous: Boolean(item.is_hazardous),
        order_type: item.order_type ?? detectOrderType(casNumber),
        product_id: readImportText(item, 'product_id'),
        detail_url: readImportText(item, 'detail_url'),
    }
}

// 从本地存储读取购物车导入批次。 把批次参数校验、过期校验和 JSON 解析从 hook 中拆出，降低加载流程复杂度。
function readCartImportBatchFromStorage(batchId: string, importFlag: boolean): BatchLoadResult {
    if (!importFlag || !batchId) {
        return { type: 'redirect', message: '缺少导入参数，请从浏览器插件重新发起导入' }
    }

    const raw = readCartImportBatchStorageRaw()
    if (!raw) {
        return { type: 'retry' }
    }

    try {
        const batch = JSON.parse(raw) as StoredBatch
        if (batch.batch_id !== batchId) {
            return { type: 'redirect', message: '批次ID不匹配，请重新发起导入' }
        }

        if (isExpiredBatch(batch)) {
            return {
                type: 'redirect',
                message: '导入批次已过期（2小时），请在插件中重新发起导入',
                clearStorage: true,
            }
        }

        const parsedItems = (batch.items || [])
            .map((item, index) => toImportItem(item, index))
            .filter((item) => item.name.trim())

        if (parsedItems.length === 0) {
            return { type: 'redirect', message: '当前批次没有可导入商品，请在插件中重新抓取' }
        }

        return { type: 'loaded', items: parsedItems }
    } catch {
        return {
            type: 'redirect',
            message: '批次数据解析失败，请重新发起导入',
            clearStorage: true,
        }
    }
}

// 生成试剂导入项的表单默认值。 让切换当前项与切换表单类型都复用同一套回填规则。
function createCartImportReagentFormValues(item: ImportItem): ReagentOrderFormInputData {
    return {
        ...defaultReagentOrderValues,
        name: item.name,
        cas_number: item.cas_number,
        english_name: item.english_name,
        alias: item.alias,
        brand: item.brand,
        specification: normalizeReagentSpecification(item.specification),
        quantity: item.quantity,
        price: item.price ?? '',
        is_hazardous: item.is_hazardous,
    }
}

// 生成耗材导入项的表单默认值。 把插件抓取字段与耗材表单字段的映射集中在一处，避免在 hook 内重复展开对象。
function createCartImportConsumableFormValues(item: ImportItem): ConsumableOrderFormInputData {
    return {
        ...defaultConsumableOrderValues,
        name: item.name,
        english_name: item.english_name,
        specification: item.specification,
        quantity: item.quantity,
        unit: item.unit,
        product_number: item.product_number,
        price: item.price,
    }
}

// 在导入项缺少英文名时尝试自动回填。 保留当前“只自动补英文名、不打断用户编辑”的静默增强行为。
function autofillCartImportEnglishName(
    item: ImportItem,
    reagentForm: UseFormReturn<ReagentOrderFormInputData, unknown, ReagentOrderFormData>,
) {
    if (!item.cas_number || item.english_name) {
        return
    }

    chemicalAPI.getInfo(item.cas_number, {
        skipChinese: shouldSkipChineseLookupByName(item.name),
    })
        .then((response) => {
            const info = response.data
            if (info.english_name) {
                reagentForm.setValue('english_name', info.english_name, { shouldValidate: false })
            }
        })
        .catch(() => { /* silent - user can manually lookup */ })
}

// 生成购物车导入场景下的试剂表单字段。 把 CAS 警告与识别按钮的挂载逻辑从 hook 内拆开，减少表单控制器的渲染分支。
function createCartImportReagentFormFields(params: {
    checkCASWarning: (casNumber: string, options?: { force?: boolean }) => Promise<void>
    handleCasLookup: () => Promise<void>
    isCasLookupLoading: boolean
}) {
    const { checkCASWarning, handleCasLookup, isCasLookupLoading } = params
    return enhanceCasLookupField(getReagentOrderFormFields(), {
        onCasBlur: checkCASWarning,
        prefixButton: {
            onClick: handleCasLookup,
            loading: isCasLookupLoading,
            title: '识别 CAS 号',
            icon: ScanSearch,
        },
    })
}

// 将购物车导入时的字段校验错误写回当前表单。 让提交流程只保留一次错误分流，而不重复遍历试剂/耗材两套表单。
function applyCartImportValidationErrors(params: {
    orderType: OrderType
    validationErrors: ValidationError[]
    reagentForm: UseFormReturn<ReagentOrderFormInputData, unknown, ReagentOrderFormData>
    consumableForm: UseFormReturn<ConsumableOrderFormInputData, unknown, ConsumableOrderFormData>
}): boolean {
    const { orderType, validationErrors, reagentForm, consumableForm } = params
    return applyValidationErrors(validationErrors, (fieldName, message) => {
        if (orderType === 'reagent') {
            reagentForm.setError(fieldName as keyof ReagentOrderFormData, { message })
            return
        }

        consumableForm.setError(fieldName as keyof ConsumableOrderFormData, { message })
    })
}

// 提交当前试剂导入项。 把 `handleSubmit` 的执行细节从当前项提交器中拆出，降低主提交流程的语句数。
async function submitCartImportReagentForm(
    reagentForm: UseFormReturn<ReagentOrderFormInputData, unknown, ReagentOrderFormData>,
): Promise<boolean> {
    let submitSucceeded = false
    const submitReagent = reagentForm.handleSubmit(
        async (formData) => {
            await reagentOrderAPI.create({
                name: formData.name,
                cas_number: formData.cas_number.trim(),
                english_name: formData.english_name || undefined,
                alias: formData.alias || undefined,
                category: formData.category || undefined,
                brand: formData.brand || undefined,
                specification: normalizeReagentSpecification(formData.specification),
                quantity: formData.quantity,
                price: formData.price,
                order_reason: formData.order_reason as ReagentOrderReason,
                is_hazardous: formData.is_hazardous,
                notes: processNotes(formData.notes),
            })
            submitSucceeded = true
        },
        () => { /* form errors shown inline */ },
    )

    await submitReagent()
    return submitSucceeded
}

// 提交当前耗材导入项。 把耗材表单的提交实现从主提交流程中拆出，保持两种订单类型的分支对称。
async function submitCartImportConsumableForm(
    consumableForm: UseFormReturn<ConsumableOrderFormInputData, unknown, ConsumableOrderFormData>,
): Promise<boolean> {
    let submitSucceeded = false
    const submitConsumable = consumableForm.handleSubmit(
        async (formData) => {
            await consumableOrderAPI.create({
                name: formData.name,
                english_name: formData.english_name || undefined,
                product_number: formData.product_number || undefined,
                specification: formData.specification,
                unit: formData.unit || undefined,
                quantity: formData.quantity,
                price: formData.price,
                communication: formData.communication || undefined,
                notes: processNotes(formData.notes),
            })
            submitSucceeded = true
        },
        () => { /* form errors shown inline */ },
    )

    await submitConsumable()
    return submitSucceeded
}

// 查找下一个尚未提交的导入项索引。 把提交成功后的导航规则收口，避免在提交器里混杂集合遍历细节。
function findNextPendingImportIndex(items: ImportItem[], submittedIds: Set<number>): number {
    return items.findIndex((item) => !submittedIds.has(item.id))
}

// 安排购物车导入完成后的回跳。 保持现有 2 秒提示后跳转的交互，但把导航副作用从删除/提交流程中抽离。
function scheduleCartImportReturn(navigate: (path: string) => void | Promise<void>) {
    globalThis.setTimeout(() => navigate('/reagents'), 2000)
}

// 管理批次读取、当前用户与当前选中项。 把 URL 参数解析和批次重试加载从页面主组件中拆出，避免页面函数继续承担初始化流程。
function useCartImportBatchController() {
    const navigate = useNavigate()
    const location = useLocation()
    const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search])
    const batchId = searchParams.get('batch_id') || ''
    const importFlag = searchParams.get('import') === 'true'
    const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
    const [items, setItems] = useState<ImportItem[]>([])
    const [currentIndex, setCurrentIndex] = useState(0)
    const [submittedIds, setSubmittedIds] = useState<Set<number>>(new Set())
    const [loading, setLoading] = useState(true)
    const [mobileListOpen, setMobileListOpen] = useState(false)
    const currentItem = items[currentIndex] ?? null

    const loadBatchFromStorage = useCallback(() => {
        const result = readCartImportBatchFromStorage(batchId, importFlag)
        if (result.type === 'loaded') {
            setItems(result.items)
            setCurrentIndex(0)
            setLoading(false)
            return true
        }

        if (result.type === 'redirect') {
            if (result.clearStorage) {
                clearCartImportBatchStorage()
            }
            toast.error(result.message)
            navigate('/reagents')
            return true
        }

        return false
    }, [batchId, importFlag, navigate])

    useEffect(() => {
        authAPI.getProfile()
            .then((response) => setCurrentUser(response.data))
            .catch((error) => {
                toast.error(getApiErrorMessage(error, '获取当前用户失败'))
            })
    }, [])

    useEffect(() => {
        let retryTimer: ReturnType<typeof globalThis.setInterval> | undefined
        const initialLoadTimer = globalThis.setTimeout(() => {
            if (loadBatchFromStorage()) {
                return
            }

            let retryCount = 0
            retryTimer = globalThis.setInterval(() => {
                retryCount += 1
                const loaded = loadBatchFromStorage()
                if (loaded || retryCount >= 10) {
                    globalThis.clearInterval(retryTimer)
                    if (!loaded) {
                        toast.error('未找到批次数据，请重试')
                        navigate('/reagents')
                    }
                }
            }, 300)
        }, 0)

        const handleBatchMessage = (event: MessageEvent) => {
            if (event.origin !== globalThis.location.origin) {
                return
            }
            const data = event.data as { source?: string; type?: string }
            if (data?.source === 'lab-storage-extension' && data.type === 'IMPORT_BATCH_READY') {
                loadBatchFromStorage()
            }
        }

        globalThis.addEventListener('message', handleBatchMessage)
        return () => {
            globalThis.clearTimeout(initialLoadTimer)
            if (retryTimer) {
                globalThis.clearInterval(retryTimer)
            }
            globalThis.removeEventListener('message', handleBatchMessage)
        }
    }, [loadBatchFromStorage, navigate])

    return {
        currentUser,
        items,
        currentIndex,
        submittedIds,
        currentItem,
        loading,
        mobileListOpen,
        setItems,
        setCurrentIndex,
        setSubmittedIds,
        setMobileListOpen,
        navigate,
    }
}

// 管理购物车导入的两套表单、CAS 联动与类型切换。 把“当前项如何回填为表单”和“试剂 CAS 交互”从页面中拆成独立控制器。
function useCartImportFormController(currentItem: ImportItem | null) {
    const [orderType, setOrderType] = useState<OrderType>('reagent')
    const [isCasLookupLoading, setIsCasLookupLoading] = useState(false)
    const {
        casWarning,
        casLoading,
        checkCASWarning,
        clearCASWarning,
        handleCasValueChange,
    } = useReagentCasDuplicateCheck()
    const reagentForm = useForm<ReagentOrderFormInputData, unknown, ReagentOrderFormData>({
        resolver: createValibotResolver(ReagentOrderSchema),
        defaultValues: defaultReagentOrderValues,
        shouldFocusError: false,
    })
    const consumableForm = useForm<ConsumableOrderFormInputData, unknown, ConsumableOrderFormData>({
        resolver: createValibotResolver(ConsumableOrderSchema),
        defaultValues: defaultConsumableOrderValues,
        shouldFocusError: false,
    })

    const fillFormByItem = useCallback((item: ImportItem, forcedType?: OrderType) => {
        const currentType = forcedType || item.order_type || detectOrderType(item.cas_number)
        setOrderType(currentType)

        if (currentType === 'reagent') {
            reagentForm.reset(createCartImportReagentFormValues(item))
            autofillCartImportEnglishName(item, reagentForm)
            return
        }

        consumableForm.reset(createCartImportConsumableFormValues(item))
    }, [consumableForm, reagentForm])

    useEffect(() => {
        if (currentItem) {
            fillFormByItem(currentItem)
        }
    }, [currentItem, fillFormByItem])

    useEffect(() => {
        const subscription = reagentForm.watch((value, field) => {
            if (field.name === 'cas_number') {
                const currentValue = (value.cas_number || '').trim().toUpperCase()
                reagentForm.clearErrors('cas_number')
                handleCasValueChange(currentValue)
            }
        })
        return () => subscription.unsubscribe()
    }, [reagentForm, handleCasValueChange])

    useEffect(() => {
        if (orderType !== 'reagent') {
            return
        }

        const currentCas = reagentForm.getValues('cas_number')
        if (currentCas) {
            checkCASWarning(currentCas)
        }
    }, [orderType, currentItem?.id, reagentForm, checkCASWarning])

    const handleCasLookup = useCallback(async () => {
        const isValidCas = await reagentForm.trigger('cas_number')
        if (!isValidCas) {
            return
        }

        const casValue = reagentForm.getValues('cas_number')
        const casValidation = validateAndNormalizeCASInput(casValue || '')
        if ('error' in casValidation) {
            return
        }

        reagentForm.clearErrors('cas_number')
        reagentForm.setValue('cas_number', casValidation.normalized, {
            shouldDirty: true,
            shouldValidate: false,
        })

        if (isSpecialCasValue(casValidation.normalized)) {
            reagentForm.setError('cas_number', { message: '生物试剂不支持 CAS 识别查询' })
            clearCASWarning()
            return
        }

        setIsCasLookupLoading(true)
        try {
            const response = await chemicalAPI.getInfo(casValidation.normalized)
            const info = response.data
            if (info.english_name) {
                reagentForm.setValue('english_name', info.english_name, { shouldValidate: true })
                toast.success('CAS 英文名已自动填入')
            } else {
                toast.warning('未查询到英文名')
            }
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'CAS 号识别失败'))
        } finally {
            setIsCasLookupLoading(false)
        }

        await checkCASWarning(casValidation.normalized, { force: true })
    }, [reagentForm, checkCASWarning, clearCASWarning])

    const handleTypeSwitch = useCallback((value: OrderType) => {
        if (!currentItem) {
            setOrderType(value)
            return
        }

        fillFormByItem(currentItem, value)
        if (value !== 'reagent') {
            clearCASWarning()
        }
    }, [clearCASWarning, currentItem, fillFormByItem])

    const reagentFormFields = useMemo(() => {
        return createCartImportReagentFormFields({
            checkCASWarning,
            handleCasLookup,
            isCasLookupLoading,
        })
    }, [checkCASWarning, handleCasLookup, isCasLookupLoading])

    return {
        orderType,
        reagentForm,
        consumableForm,
        reagentFormFields,
        casWarning,
        casLoading,
        handleTypeSwitch,
    }
}

// 管理当前导入项的删除、提交与跳转动作。 把“当前项生命周期”从批次和表单控制器中拆开，降低单个函数的语句数与分支数。
function useCartImportActions(params: {
    items: ImportItem[]
    setItems: Dispatch<SetStateAction<ImportItem[]>>
    currentIndex: number
    setCurrentIndex: Dispatch<SetStateAction<number>>
    submittedIds: Set<number>
    setSubmittedIds: Dispatch<SetStateAction<Set<number>>>
    currentItem: ImportItem | null
    navigate: (path: string) => void | Promise<void>
    orderType: OrderType
    casWarningCasNumber?: string
    reagentForm: UseFormReturn<ReagentOrderFormInputData, unknown, ReagentOrderFormData>
    consumableForm: UseFormReturn<ConsumableOrderFormInputData, unknown, ConsumableOrderFormData>
}) {
    const {
        items,
        setItems,
        currentIndex,
        setCurrentIndex,
        submittedIds,
        setSubmittedIds,
        currentItem,
        navigate,
        orderType,
        casWarningCasNumber,
        reagentForm,
        consumableForm,
    } = params
    const [deleteConfirm, setDeleteConfirm] = useState(false)
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        if (currentItem) {
            setDeleteConfirm(false)
        }
    }, [currentItem])

    const handleDeleteCurrent = useCallback(() => {
        if (!currentItem) {
            return
        }

        if (!deleteConfirm) {
            setDeleteConfirm(true)
            return
        }

        setDeleteConfirm(false)
        const nextItems = items.filter((_, index) => index !== currentIndex)
        setItems(nextItems)
        if (nextItems.length === 0) {
            toast.success('已删除全部条目，即将返回试剂页')
            clearCartImportBatchStorage()
            scheduleCartImportReturn(navigate)
            return
        }

        setCurrentIndex(Math.min(currentIndex, nextItems.length - 1))
        toast.success(`已删除: ${currentItem.name}`)
    }, [currentIndex, currentItem, deleteConfirm, items, navigate, setCurrentIndex, setItems])

    const handleSubmitCurrent = useCallback(async () => {
        if (!currentItem) {
            return
        }

        setDeleteConfirm(false)
        setSubmitting(true)
        try {
            const submitSucceeded = orderType === 'reagent'
                ? await submitCartImportReagentForm(reagentForm)
                : await submitCartImportConsumableForm(consumableForm)

            if (!submitSucceeded) {
                return
            }

            const nextSubmitted = new Set(submittedIds)
            nextSubmitted.add(currentItem.id)
            setSubmittedIds(nextSubmitted)
            toast.success(`已提交: ${currentItem.name}`)

            const nextPendingIndex = findNextPendingImportIndex(items, nextSubmitted)
            if (nextPendingIndex >= 0) {
                setCurrentIndex(nextPendingIndex)
            }

            if (nextSubmitted.size >= items.length) {
                toast.success('全部导入完成，即将返回试剂页')
                clearCartImportBatchStorage()
                scheduleCartImportReturn(navigate)
            }
        } catch (error) {
            const detail = extractApiErrorDetail(error)
            const validationErrors = toValidationErrors(detail)
            if (applyCartImportValidationErrors({ orderType, validationErrors, reagentForm, consumableForm })) {
                return
            }
            toast.error(normalizeApiErrorMessage(detail, '提交失败'))
        } finally {
            setSubmitting(false)
        }
    }, [consumableForm, currentItem, items, navigate, orderType, reagentForm, setCurrentIndex, setSubmittedIds, submittedIds])

    const navigateToCasSearch = useCallback((path: string, field: string) => {
        if (!casWarningCasNumber) {
            return
        }

        const query = new URLSearchParams({
            search: casWarningCasNumber,
            field,
        })
        navigate(`${path}?${query.toString()}`)
    }, [casWarningCasNumber, navigate])

    return {
        deleteConfirm,
        submitting,
        handleDeleteCurrent,
        handleSubmitCurrent,
        navigateToCasSearch,
    }
}

// 渲染购物车导入项列表。 让桌面侧栏和移动抽屉复用同一套条目卡片渲染逻辑。
function CartImportItemList(props: Readonly<{
    items: ImportItem[]
    currentIndex: number
    submittedIds: Set<number>
    onSelect: (index: number) => void
}>) {
    const { items, currentIndex, submittedIds, onSelect } = props

    return (
        <>
            {items.map((item, index) => {
                const isCurrent = index === currentIndex
                const isSubmitted = submittedIds.has(item.id)
                const itemMeta = item.order_type === 'reagent'
                    ? `CAS: ${item.cas_number || '无CAS'}`
                    : `规格: ${item.specification || '未提供'}`
                const itemTypeClassName = item.order_type === 'consumable'
                    ? 'bg-blue-50/50 text-blue-700 border-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800'
                    : 'bg-indigo-50/50 text-indigo-700 border-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800'

                return (
                    <Card
                        key={item.id}
                        role='button'
                        tabIndex={0}
                        onClick={() => onSelect(index)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                onSelect(index)
                            }
                        }}
                        className={cn(
                            'cursor-pointer transition-all hover:bg-accent text-card-foreground py-4',
                            isCurrent ? 'border bg-accent/50 dark:border-primary' : '',
                            isSubmitted ? 'opacity-50' : '',
                        )}
                    >
                        <CardHeader className='flex flex-row items-start justify-between gap-2 px-4 py pb-2'>
                            <CardTitle className={cn('font-normal leading-tight line-clamp-2', isCurrent ? 'text-primary' : '')}>
                                {item.name}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className='px-4 flex flex-row items-center justify-between text-muted-foreground'>
                            {itemMeta}
                            {isSubmitted ? (
                                <CheckCircle className='w-4 h-4 text-green-500 shrink-0 mt-0.5' />
                            ) : (
                                <span className={cn('shrink-0 text-sm rounded-sm border px-1.5 py-0.5', itemTypeClassName)}>
                                    {item.order_type === 'consumable' ? '耗材' : '试剂'}
                                </span>
                            )}
                        </CardContent>
                    </Card>
                )
            })}
        </>
    )
}

// 渲染移动端导入项侧边抽屉。 把移动端抽屉逻辑从主体内容中拆开，避免布局函数继续膨胀。
function CartImportMobileSidebar(props: Readonly<{
    mobileListOpen: boolean
    items: ImportItem[]
    currentIndex: number
    submittedIds: Set<number>
    onClose: () => void
    onSelect: (index: number) => void
}>) {
    const { mobileListOpen, items, currentIndex, submittedIds, onClose, onSelect } = props

    return (
        <div
            className={cn(
                'fixed inset-0 z-50 bg-background/80 backdrop-blur-sm lg:hidden transition-opacity duration-200',
                mobileListOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
            )}
            onClick={onClose}
        >
            <aside
                className={cn(
                    'fixed inset-y-0 left-0 w-80 bg-card transition-transform duration-200 flex flex-col pointer-events-auto',
                    mobileListOpen ? 'translate-x-0' : '-translate-x-full',
                )}
                onClick={(event) => event.stopPropagation()}
            >
                <div className='flex items-center justify-between p-5 shrink-0'>
                    <h3 className='font-bold text-lg'>待导入列表</h3>
                    <Button variant='ghost' size='icon' onClick={onClose}>
                        <X className='w-5 h-5 opacity-60' />
                    </Button>
                </div>
                <div className='flex-1 overflow-y-auto p-4 space-y-2'>
                    <CartImportItemList
                        items={items}
                        currentIndex={currentIndex}
                        submittedIds={submittedIds}
                        onSelect={onSelect}
                    />
                </div>
            </aside>
        </div>
    )
}

// 渲染桌面端导入项侧栏。 把桌面列表与主体表单分开，降低主内容组件的布局复杂度。
function CartImportDesktopSidebar(props: Readonly<{
    items: ImportItem[]
    currentIndex: number
    submittedIds: Set<number>
    onSelect: (index: number) => void
}>) {
    const { items, currentIndex, submittedIds, onSelect } = props

    return (
        <div className='hidden lg:flex flex-col w-75 shrink-0 p-4 md:p-6'>
            <div className='flex items-center justify-between mb-4'>
                <h3 className='font-bold text-lg'>待导入</h3>
                <span className='text-sm text-muted-foreground'>已提交 {submittedIds.size}/{items.length}</span>
            </div>
            <div className='flex-1 overflow-y-auto space-y-1.5 pr-2 -mr-2 pb-2'>
                <CartImportItemList
                    items={items}
                    currentIndex={currentIndex}
                    submittedIds={submittedIds}
                    onSelect={onSelect}
                />
            </div>
        </div>
    )
}

// 渲染购物车导入表单区。 把表单类型切换、CAS 警告和底部动作栏集中到单独视图层，避免主内容组件继续增长。
function CartImportFormPanel(props: Readonly<{
    batch: ReturnType<typeof useCartImportBatchController>
    formState: ReturnType<typeof useCartImportFormController>
    actions: ReturnType<typeof useCartImportActions>
}>) {
    const { batch, formState, actions } = props
    const { currentItem, items, submittedIds, setMobileListOpen } = batch
    const {
        orderType,
        reagentForm,
        consumableForm,
        reagentFormFields,
        casWarning,
        casLoading,
        handleTypeSwitch,
    } = formState
    const { deleteConfirm, submitting, handleDeleteCurrent, handleSubmitCurrent, navigateToCasSearch } = actions

    return (
        <div className='flex-1 p-4 md:pl-6 md:pr-8 md:pt-6 md:pb-2 flex flex-col min-w-0'>
            <div className='flex items-center justify-between mb-6 flex-wrap'>
                <div>
                    <h3 className='font-bold text-lg flex items-center min-w-0'>
                        <Button
                            variant='modern'
                            size='icon'
                            className='lg:hidden mr-3 shrink-0'
                            onClick={() => setMobileListOpen(true)}
                        >
                            <List className='w-4 h-4' />
                        </Button>
                        <span className='shrink-0'>完善订单</span>
                        <span className='text-sm text-muted-foreground pt-1 lg:hidden ml-3 shrink-0 font-normal'>
                            已提交 {submittedIds.size}/{items.length}
                        </span>
                    </h3>
                </div>
                <div className='flex items-center gap-2'>
                    <span className='pr-2 text-muted-foreground'>表单类型</span>
                    <RadioGroup
                        value={orderType}
                        onValueChange={(value) => handleTypeSwitch(value as OrderType)}
                        className='flex items-center gap-4'
                    >
                        <div className='flex items-center space-x-2'>
                            <RadioGroupItem value='reagent' id='r-reagent' />
                            <Label htmlFor='r-reagent' className='cursor-pointer text-base'>试剂</Label>
                        </div>
                        <div className='flex items-center space-x-2'>
                            <RadioGroupItem value='consumable' id='r-consumable' />
                            <Label htmlFor='r-consumable' className='cursor-pointer text-base'>耗材</Label>
                        </div>
                    </RadioGroup>
                </div>
            </div>

            <div className='flex-1 pb-4'>
                {orderType === 'reagent' ? (
                    <>
                        <BaseForm form={reagentForm} fields={reagentFormFields} />
                        <ReagentCasDuplicateWarning
                            casWarning={casWarning}
                            className='mt-3 rounded-md bg-orange-50 p-3 dark:bg-orange-950'
                            onOpenOrders={() => navigateToCasSearch('/reagents', 'cas')}
                            onOpenInventory={() => navigateToCasSearch('/inventory', 'cas_number')}
                            getOrderStatusLabel={getReagentOrderStatusLabel}
                        />
                    </>
                ) : (
                    <BaseForm form={consumableForm} fields={getConsumableOrderFormFields()} />
                )}
            </div>

            <div className='pt-4 mt-auto'>
                <div className='flex flex-wrap items-center justify-between gap-3'>
                    <div className='flex items-center gap-2 order-1'>
                        <Button
                            variant='destructive'
                            size='lg'
                            type='button'
                            onClick={handleDeleteCurrent}
                            disabled={submitting || !currentItem}
                        >
                            <Trash2 className='w-4 h-4 mr-1.5' />
                            {deleteConfirm ? '确认删除' : '删除'}
                        </Button>
                    </div>
                    <div className='flex items-center gap-2 order-2'>
                        {casLoading && orderType === 'reagent' && (
                            <span className='text-sm text-muted-foreground flex items-center'>
                                <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                                检查CAS号中
                            </span>
                        )}
                        <LoadingButton
                            type='button'
                            size='lg'
                            onClick={handleSubmitCurrent}
                            isLoading={submitting}
                            disabled={submitting || !currentItem}
                        >
                            提交当前项
                        </LoadingButton>
                    </div>
                </div>
            </div>
        </div>
    )
}

// 直接组合批次、表单和动作控制器，避免继续保留只负责转发的内容层。
export function CartImportPage() {
    const batchController = useCartImportBatchController()
    const formController = useCartImportFormController(batchController.currentItem)
    const actionController = useCartImportActions({
        items: batchController.items,
        setItems: batchController.setItems,
        currentIndex: batchController.currentIndex,
        setCurrentIndex: batchController.setCurrentIndex,
        submittedIds: batchController.submittedIds,
        setSubmittedIds: batchController.setSubmittedIds,
        currentItem: batchController.currentItem,
        navigate: batchController.navigate,
        orderType: formController.orderType,
        casWarningCasNumber: formController.casWarning?.cas_number,
        reagentForm: formController.reagentForm,
        consumableForm: formController.consumableForm,
    })
    const { currentUser, items, currentIndex, submittedIds, mobileListOpen, setCurrentIndex, setMobileListOpen } = batchController
    const handleSelectItem = useCallback((index: number) => {
        setCurrentIndex(index)
        setMobileListOpen(false)
    }, [setCurrentIndex, setMobileListOpen])

    if (batchController.loading) {
        return (
            <div className='flex min-h-svh w-full items-center justify-center px-4'>
                <Card className='w-full max-w-3xl'>
                    <CardContent className='py-12 flex items-center justify-center gap-3 text-muted-foreground'>
                        <Loader2 className='w-5 h-5 animate-spin' />
                        正在加载导入批次...
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className='flex min-h-svh w-full items-center justify-center px-4'>
            <div className='absolute inset-0 -z-10 [background-image:radial-gradient(circle_at_center,#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] [mask-image:radial-gradient(closest-side_at_50%_50%,#000_70%,transparent_100%)] dark:[background-image:radial-gradient(circle_at_center,#1f2937_1px,transparent_1px)] dark:[mask-image:radial-gradient(closest-side_at_50%_50%,#000_70%,transparent_100%)]' />
            <Card className='w-full md:w-auto md:min-w-md overflow-hidden'>
                <div className='max-h-[90vh] overflow-y-auto'>
                    <CardHeader className='pb-4 border-b border-muted'>
                        <CardTitle className='text-2xl'>
                            购物车导入 <span className='text-base font-normal ml-4'>当前用户: </span>
                            <span className='text-base font-normal'>{currentUser?.full_name || currentUser?.username || '未知用户'}</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className='p-0 relative flex'>
                        <CartImportMobileSidebar
                            mobileListOpen={mobileListOpen}
                            items={items}
                            currentIndex={currentIndex}
                            submittedIds={submittedIds}
                            onClose={() => setMobileListOpen(false)}
                            onSelect={handleSelectItem}
                        />
                        <CartImportDesktopSidebar
                            items={items}
                            currentIndex={currentIndex}
                            submittedIds={submittedIds}
                            onSelect={handleSelectItem}
                        />
                        <CartImportFormPanel batch={batchController} formState={formController} actions={actionController} />
                    </CardContent>
                </div>
            </Card>
        </div>
    )
}
