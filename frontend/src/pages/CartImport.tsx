import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
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

function isExpiredBatch(batch: StoredBatch): boolean {
    const createdAt = batch?.created_at ? Date.parse(batch.created_at) : Number.NaN
    return Number.isNaN(createdAt) || Date.now() - createdAt > BATCH_TTL_MS
}

function extractFirstCasNumber(input: string): string {
    const match = /\b\d{2,7}-\d{2}-\d\b/.exec(String(input || ''))
    return match ? match[0] : ''
}

function detectOrderType(casNumber: string): OrderType {
    return extractFirstCasNumber(casNumber) ? 'reagent' : 'consumable'
}

function normalizeReagentSpecification(specification: string): string {
    const trimmed = (specification || '').trim()
    if (!trimmed) {
        return ''
    }
    return trimmed.split('/')[0].trim()
}

function getReagentOrderStatusLabel(status: string): string {
    return REAGENT_STATUS_MAP[status] || status
}

function isPlaceholderImportName(name: string): boolean {
    const normalized = (name || '').trim()
    return normalized === '未知'
}

function shouldSkipChineseLookupByName(name: string): boolean {
    const normalizedName = (name || '').trim()
    return Boolean(normalizedName && !isPlaceholderImportName(normalizedName))
}

function toImportItem(item: Partial<ImportItem>, index: number): ImportItem {
    const rawName = item.name?.trim() || ''
    // 占位名称不写入表单，强制用户确认中文名
    const name = isPlaceholderImportName(rawName) ? '' : rawName

    return {
        id: index,
        name,
        cas_number: extractFirstCasNumber(item.cas_number || ''),
        english_name: item.english_name?.trim() || '',
        specification: item.specification?.trim() || '',
        quantity: Number.isFinite(item.quantity) && Number(item.quantity) > 0 ? Number(item.quantity) : 1,
        price: typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : undefined,
        brand: item.brand?.trim() || '',
        alias: item.alias?.trim() || '',
        unit: item.unit?.trim() || '',
        product_number: item.product_number?.trim() || '',
        is_hazardous: Boolean(item.is_hazardous),
        order_type: item.order_type ?? detectOrderType(item.cas_number || ''),
        product_id: item.product_id?.trim() || '',
        detail_url: item.detail_url?.trim() || '',
    }
}

export function CartImportPage() {
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
    const [submitting, setSubmitting] = useState(false)
    const [deleteConfirm, setDeleteConfirm] = useState(false)
    const [mobileListOpen, setMobileListOpen] = useState(false)
    const [isCasLookupLoading, setIsCasLookupLoading] = useState(false)

    const [orderType, setOrderType] = useState<OrderType>('reagent')
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

    const currentItem = items[currentIndex] ?? null

    const fillFormByItem = useCallback((item: ImportItem, forcedType?: OrderType) => {
        const currentType = forcedType || item.order_type || detectOrderType(item.cas_number)
        setOrderType(currentType)

        if (currentType === 'reagent') {
            reagentForm.reset({
                ...defaultReagentOrderValues,
                name: item.name,
                cas_number: item.cas_number,
                english_name: item.english_name,
                alias: item.alias,
                brand: item.brand,
                specification: normalizeReagentSpecification(item.specification),
                quantity: item.quantity,
                price: item.price,
                is_hazardous: item.is_hazardous,
            })

            // Auto-lookup English name if CAS is present but English name is missing
            if (item.cas_number && !item.english_name) {
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
            return
        }

        consumableForm.reset({
            ...defaultConsumableOrderValues,
            name: item.name,
            english_name: item.english_name,
            specification: item.specification,
            quantity: item.quantity,
            unit: item.unit,
            product_number: item.product_number,
            price: item.price,
        })
    }, [consumableForm, reagentForm])

    const loadBatchFromLocalStorage = useCallback((): boolean => {
        if (!importFlag || !batchId) {
            toast.error('缺少导入参数，请从浏览器插件重新发起导入')
            navigate('/reagents')
            return true
        }

        const raw = localStorage.getItem(CART_STORAGE_KEY)
        if (!raw) {
            return false
        }

        try {
            const batch = JSON.parse(raw) as StoredBatch
            if (batch.batch_id !== batchId) {
                toast.error('批次ID不匹配，请重新发起导入')
                navigate('/reagents')
                return true
            }

            if (isExpiredBatch(batch)) {
                localStorage.removeItem(CART_STORAGE_KEY)
                toast.error('导入批次已过期（2小时），请在插件中重新发起导入')
                navigate('/reagents')
                return true
            }

            const parsedItems = (batch.items || [])
                .map((item, index) => toImportItem(item, index))
                .filter((item) => item.name.trim())

            if (parsedItems.length === 0) {
                toast.error('当前批次没有可导入商品，请在插件中重新抓取')
                navigate('/reagents')
                return true
            }

            setItems(parsedItems)
            setCurrentIndex(0)
            setLoading(false)
            return true
        } catch {
            localStorage.removeItem(CART_STORAGE_KEY)
            toast.error('批次数据解析失败，请重新发起导入')
            navigate('/reagents')
            return true
        }
    }, [batchId, importFlag, navigate])

    useEffect(() => {
        authAPI.getProfile()
            .then((response) => setCurrentUser(response.data))
            .catch((error) => {
                toast.error(getApiErrorMessage(error, '获取当前用户失败'))
            })
    }, [])

    useEffect(() => {
        if (loadBatchFromLocalStorage()) {
            return
        }

        let retryCount = 0
        const retryTimer = globalThis.setInterval(() => {
            retryCount += 1
            const loaded = loadBatchFromLocalStorage()
            if (loaded || retryCount >= 10) {
                globalThis.clearInterval(retryTimer)
                if (!loaded) {
                    toast.error('未找到批次数据，请重试')
                    navigate('/reagents')
                }
            }
        }, 300)

        const handleBatchMessage = (event: MessageEvent) => {
            if (event.origin !== globalThis.location.origin) {
                return
            }
            const data = event.data as { source?: string; type?: string }
            if (data?.source === 'lab-storage-extension' && data.type === 'IMPORT_BATCH_READY') {
                loadBatchFromLocalStorage()
            }
        }

        globalThis.addEventListener('message', handleBatchMessage)
        return () => {
            globalThis.clearInterval(retryTimer)
            globalThis.removeEventListener('message', handleBatchMessage)
        }
    }, [batchId, loadBatchFromLocalStorage, navigate])

    useEffect(() => {
        if (currentItem) {
            fillFormByItem(currentItem)
            setDeleteConfirm(false)
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

    const handleTypeSwitch = (value: OrderType) => {
        if (!currentItem) {
            setOrderType(value)
            return
        }
        fillFormByItem(currentItem, value)
        if (value !== 'reagent') {
            clearCASWarning()
        }
    }

    const navigateToCasSearch = useCallback((path: string, field: string) => {
        if (!casWarning?.cas_number) {
            return
        }

        const query = new URLSearchParams({
            search: casWarning.cas_number,
            field,
        })
        navigate(`${path}?${query.toString()}`)
    }, [casWarning?.cas_number, navigate])

    const reagentFormFields = useMemo(() => {
        return getReagentOrderFormFields().map((field) =>
            field.name === 'cas_number'
                ? {
                    ...field,
                    onBlur: (value: unknown) => {
                        if (typeof value === 'string') {
                            checkCASWarning(value)
                        }
                    },
                    prefixButton: {
                        onClick: handleCasLookup,
                        loading: isCasLookupLoading,
                        title: '识别 CAS 号',
                        icon: ScanSearch,
                    },
                }
                : field
        )
    }, [checkCASWarning, handleCasLookup, isCasLookupLoading])

    const handleDeleteCurrent = () => {
        if (!currentItem) return
        if (!deleteConfirm) {
            setDeleteConfirm(true)
            return
        }
        setDeleteConfirm(false)
        const nextItems = items.filter((_, i) => i !== currentIndex)
        setItems(nextItems)
        if (nextItems.length === 0) {
            toast.success('已删除全部条目，即将返回试剂页')
            localStorage.removeItem(CART_STORAGE_KEY)
            globalThis.setTimeout(() => navigate('/reagents'), 2000)
            return
        }
        const nextIndex = Math.min(currentIndex, nextItems.length - 1)
        setCurrentIndex(nextIndex)
        toast.success(`已删除: ${currentItem.name}`)
    }

    const handleSubmitCurrent = async () => {
        if (!currentItem) {
            return
        }

        setDeleteConfirm(false)
        setSubmitting(true)
        let submitSucceeded = false

        try {
            if (orderType === 'reagent') {
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
                    () => { /* form errors shown inline */ }
                )

                await submitReagent()
            } else {
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
                    () => { /* form errors shown inline */ }
                )

                await submitConsumable()
            }

            if (!submitSucceeded) {
                return
            }

            const nextSubmitted = new Set(submittedIds)
            nextSubmitted.add(currentItem.id)
            setSubmittedIds(nextSubmitted)
            toast.success(`已提交: ${currentItem.name}`)

            const nextPendingIndex = items.findIndex((item) => !nextSubmitted.has(item.id))
            if (nextPendingIndex >= 0) {
                setCurrentIndex(nextPendingIndex)
            }

            if (nextSubmitted.size >= items.length) {
                toast.success('全部导入完成，即将返回试剂页')
                localStorage.removeItem(CART_STORAGE_KEY)
                globalThis.setTimeout(() => {
                    navigate('/reagents')
                }, 2000)
            }
        } catch (error) {
            const detail = extractApiErrorDetail(error)
            const validationErrors = toValidationErrors(detail)

            if (validationErrors.length > 0) {
                if (orderType === 'reagent') {
                    validationErrors.forEach((item: ValidationError) => {
                        if (item.loc?.[1]) {
                            reagentForm.setError(item.loc[1] as keyof ReagentOrderFormData, {
                                message: item.msg || '输入不合法',
                            })
                        }
                    })
                } else {
                    validationErrors.forEach((item: ValidationError) => {
                        if (item.loc?.[1]) {
                            consumableForm.setError(item.loc[1] as keyof ConsumableOrderFormData, {
                                message: item.msg || '输入不合法',
                            })
                        }
                    })
                }
                return
            }

            toast.error(normalizeApiErrorMessage(detail, '提交失败'))
        } finally {
            setSubmitting(false)
        }
    }

    if (loading) {
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

    const renderItemList = () => (
        items.map((item, index) => {
            const isCurrent = index === currentIndex
            const isSubmitted = submittedIds.has(item.id)
            return (
                <Card
                    key={item.id}
                    role='button'
                    tabIndex={0}
                    onClick={() => {
                        setCurrentIndex(index)
                        setMobileListOpen(false)
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            setCurrentIndex(index)
                            setMobileListOpen(false)
                        }
                    }}
                    className={cn(
                        'cursor-pointer transition-all hover:bg-accent text-card-foreground py-4',
                        isCurrent ? 'border bg-accent/50 dark:border-primary' : '',
                        isSubmitted ? 'opacity-50' : ''
                    )}
                >
                    <CardHeader className='flex flex-row items-start justify-between gap-2 px-4 py pb-2'>
                        <CardTitle className={cn('font-normal leading-tight line-clamp-2', isCurrent ? 'text-primary' : '')}>
                            {item.name}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className='px-4 flex flex-row items-center justify-between text-muted-foreground'>
                        {item.order_type === 'reagent'
                            ? <>CAS: {item.cas_number || '无CAS'}</>
                            : <>规格: {item.specification || '未提供'}</>}
                        {isSubmitted ? (
                            <CheckCircle className='w-4 h-4 text-green-500 shrink-0 mt-0.5' />
                        ) : (
                            <span className={cn(
                                'shrink-0 text-sm rounded-sm border px-1.5 py-0.5',
                                item.order_type === 'consumable'
                                    ? 'bg-blue-50/50 text-blue-700 border-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800'
                                    : 'bg-indigo-50/50 text-indigo-700 border-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800'
                            )}>
                                {item.order_type === 'consumable' ? '耗材' : '试剂'}
                            </span>
                        )}
                    </CardContent>
                </Card>
            )
        })
    )

    return (
        <div className="flex min-h-svh w-full items-center justify-center px-4">
            <div className="absolute inset-0 -z-10 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] bg-size-[16px_16px] mask-[radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)] dark:bg-[radial-gradient(#1f2937_1px,transparent_1px)] dark:mask-[radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]" />
            <Card className='w-full md:w-auto md:min-w-md overflow-hidden'>
                <div className='max-h-[90vh] overflow-y-auto'>
                    <CardHeader className='pb-4 border-b border-muted'>
                        <CardTitle className='text-2xl'>购物车导入 <span className='text-base font-normal ml-4'>当前用户: </span><span className='text-base font-normal'>{currentUser?.full_name || currentUser?.username || '未知用户'}</span></CardTitle>
                    </CardHeader>
                    <CardContent className='p-0 relative flex'>

                        {/* Mobile Overlay List */}
                        <div
                            className={cn(
                                "fixed inset-0 z-50 bg-background/80 backdrop-blur-sm lg:hidden transition-opacity duration-200",
                                mobileListOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                            )}
                            onClick={() => setMobileListOpen(false)}
                        >
                            <aside
                                className={cn(
                                    "fixed inset-y-0 left-0 w-80 bg-card transition-transform duration-200 flex flex-col pointer-events-auto",
                                    mobileListOpen ? "translate-x-0" : "-translate-x-full"
                                )}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="flex items-center justify-between p-5 shrink-0">
                                    <h3 className='font-bold text-lg'>待导入列表</h3>
                                    <Button variant="ghost" size="icon" onClick={() => setMobileListOpen(false)}>
                                        <X className="w-5 h-5 opacity-60" />
                                    </Button>
                                </div>
                                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                                    {renderItemList()}
                                </div>
                            </aside>
                        </div>

                        {/* Desktop Sidebar List */}
                        <div className='hidden lg:flex flex-col w-75 shrink-0 p-4 md:p-6'>
                            <div className='flex items-center justify-between mb-4'>
                                <h3 className='font-bold text-lg'>待导入</h3>
                                <span className='text-sm text-muted-foreground'>
                                    已提交 {submittedIds.size}/{items.length}
                                </span>
                            </div>

                            <div className='flex-1 overflow-y-auto space-y-1.5 pr-2 -mr-2 pb-2'>
                                {renderItemList()}
                            </div>
                        </div>

                        {/* Right Area: Form */}
                        <div className='flex-1 p-4 md:pl-6 md:pr-8 md:pt-6 md:pb-2 flex flex-col min-w-0'>
                            <div className='flex items-center justify-between mb-6 flex-wrap'>
                                <div>
                                    <h3 className='font-bold text-lg flex items-center min-w-0'>
                                        <Button
                                            variant="modern"
                                            size="icon"
                                            className="lg:hidden mr-3 shrink-0"
                                            onClick={() => setMobileListOpen(true)}
                                        >
                                            <List className="w-4 h-4" />
                                        </Button>
                                        <span className="shrink-0">完善订单</span>
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
                                        className="flex items-center gap-4"
                                    >
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="reagent" id="r-reagent" />
                                            <Label htmlFor="r-reagent" className="cursor-pointer text-base">试剂</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="consumable" id="r-consumable" />
                                            <Label htmlFor="r-consumable" className="cursor-pointer text-base">耗材</Label>
                                        </div>
                                    </RadioGroup>
                                </div>
                            </div>

                            <div className='flex-1 pb-4'>
                                <div>
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
                    </CardContent>
                </div>
            </Card>
        </div>
    )
}
