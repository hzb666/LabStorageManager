import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useForm } from "react-hook-form";
import type { UseFormReturn } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";
import { ScanSearch } from "lucide-react";

import {
  authAPI,
  chemicalAPI,
  consumableOrderAPI,
  reagentOrderAPI,
  type ReagentOrderReason,
} from "@/api/client";
import { useReagentCasDuplicateCheck } from "@/hooks/useReagentCasDuplicateCheck";
import { REAGENT_STATUS_MAP } from "@/lib/constants";
import {
  defaultConsumableOrderValues,
  defaultReagentOrderValues,
  enhanceCasLookupField,
  getReagentOrderFormFields,
} from "@/lib/formConfigs";
import { toast } from "@/lib/toast";
import { processNotes } from "@/lib/utils";
import {
  ConsumableOrderSchema,
  ReagentOrderSchema,
  applyValidationErrors,
  createValibotResolver,
  extractApiErrorDetail,
  getApiErrorMessage,
  isSpecialCasValue,
  normalizeCASInputValue,
  normalizeApiErrorMessage,
  toValidationErrors,
  validateAndNormalizeCASInput,
  type ConsumableOrderFormData,
  type ConsumableOrderFormInputData,
  type ReagentOrderFormData,
  type ReagentOrderFormInputData,
  type ValidationError,
} from "@/lib/validationSchemas";
import {
  type CartImportDraftDefaults,
  clearCartImportBatchStorage,
  createCartImportConsumableFormValues,
  createCartImportReagentFormValues,
  detectOrderType,
  findNextPendingImportIndex,
  getCartImportReagentCasOnSelection,
  normalizeReagentAsyncCas,
  normalizeReagentSpecification,
  readCartImportBatchFromStorage,
  removeSubmittedImportId,
  scheduleCartImportReturn,
  shouldApplyReagentAsyncResult,
  shouldSkipChineseLookupByName,
  type CurrentUser,
  type ImportItem,
  type OrderType,
  type ReagentAsyncRequestSnapshot,
  updateImportItemWithDrafts,
} from "./cartImportModel";

// 默认值留在控制器层，避免 model 反向依赖表单 schema。
const cartImportDraftDefaults = {
  reagent: defaultReagentOrderValues,
  consumable: defaultConsumableOrderValues,
} satisfies CartImportDraftDefaults;

export function getReagentOrderStatusLabel(status: string): string {
  return REAGENT_STATUS_MAP[status] || status;
}

async function autofillCartImportEnglishName(
  item: ImportItem,
): Promise<string | null> {
  if (!item.cas_number || item.english_name) {
    return null;
  }

  try {
    const response = await chemicalAPI.getInfo(item.cas_number, {
      skipChinese: shouldSkipChineseLookupByName(item.name),
    });
    return response.data.english_name || null;
  } catch {
    return null;
  }
}

function createCartImportReagentFormFields(params: {
  checkCASWarning: (
    casNumber: string,
    options?: { force?: boolean },
  ) => Promise<void>;
  handleCasLookup: () => Promise<void>;
  isCasLookupLoading: boolean;
}) {
  const { checkCASWarning, handleCasLookup, isCasLookupLoading } = params;
  return enhanceCasLookupField(getReagentOrderFormFields(), {
    onCasBlur: checkCASWarning,
    prefixButton: {
      onClick: handleCasLookup,
      loading: isCasLookupLoading,
      title: "识别 CAS 号",
      icon: ScanSearch,
    },
  });
}

function applyCartImportValidationErrors(params: {
  orderType: OrderType;
  validationErrors: ValidationError[];
  reagentForm: UseFormReturn<
    ReagentOrderFormInputData,
    unknown,
    ReagentOrderFormData
  >;
  consumableForm: UseFormReturn<
    ConsumableOrderFormInputData,
    unknown,
    ConsumableOrderFormData
  >;
}): boolean {
  const { orderType, validationErrors, reagentForm, consumableForm } = params;
  return applyValidationErrors(validationErrors, (fieldName, message) => {
    if (orderType === "reagent") {
      reagentForm.setError(fieldName as keyof ReagentOrderFormData, {
        message,
      });
      return;
    }

    consumableForm.setError(fieldName as keyof ConsumableOrderFormData, {
      message,
    });
  });
}

function useCartImportReagentAsyncGuard(params: {
  currentItemId: number | null;
  orderType: OrderType;
  reagentForm: UseFormReturn<
    ReagentOrderFormInputData,
    unknown,
    ReagentOrderFormData
  >;
  setIsCasLookupLoading: Dispatch<SetStateAction<boolean>>;
}) {
  const { currentItemId, orderType, reagentForm, setIsCasLookupLoading } = params;
  const reagentAsyncTokenRef = useRef(0);
  const currentItemIdRef = useRef<number | null>(currentItemId);
  const currentOrderTypeRef = useRef<OrderType>(orderType);

  useEffect(() => {
    currentItemIdRef.current = currentItemId;
    currentOrderTypeRef.current = orderType;
  }, [currentItemId, orderType]);

  const invalidateReagentAsyncRequests = useCallback(() => {
    reagentAsyncTokenRef.current += 1;
    setIsCasLookupLoading(false);
  }, [setIsCasLookupLoading]);

  const createReagentAsyncSnapshot = useCallback(
    (casNumber: string): ReagentAsyncRequestSnapshot => ({
      // 递增 token，让旧请求即使晚到也不能覆盖当前条目。
      token: ++reagentAsyncTokenRef.current,
      itemId: currentItemId,
      orderType: "reagent",
      casNumber: normalizeReagentAsyncCas(casNumber),
    }),
    [currentItemId],
  );

  const canApplyReagentAsyncResult = useCallback(
    (snapshot: ReagentAsyncRequestSnapshot) =>
      shouldApplyReagentAsyncResult(snapshot, {
        latestToken: reagentAsyncTokenRef.current,
        currentItemId: currentItemIdRef.current,
        currentOrderType: currentOrderTypeRef.current,
        currentCasNumber: reagentForm.getValues("cas_number"),
      }),
    [reagentForm],
  );

  return {
    invalidateReagentAsyncRequests,
    createReagentAsyncSnapshot,
    canApplyReagentAsyncResult,
  };
}

function prepareCartImportCasLookup(
  reagentForm: UseFormReturn<
    ReagentOrderFormInputData,
    unknown,
    ReagentOrderFormData
  >,
): string | null {
  // 提交远端查询前先把 CAS 规范化回表单，确保后续重复检查和异步 guard 用的是同一份值。
  const casValue = reagentForm.getValues("cas_number");
  const casValidation = validateAndNormalizeCASInput(casValue || "");
  if ("error" in casValidation) {
    return null;
  }

  reagentForm.clearErrors("cas_number");
  reagentForm.setValue("cas_number", casValidation.normalized, {
    shouldDirty: true,
    shouldValidate: false,
  });
  return casValidation.normalized;
}

async function runCartImportCasLookup(params: {
  reagentForm: UseFormReturn<
    ReagentOrderFormInputData,
    unknown,
    ReagentOrderFormData
  >;
  clearCASWarning: () => void;
  createReagentAsyncSnapshot: (casNumber: string) => ReagentAsyncRequestSnapshot;
  canApplyReagentAsyncResult: (
    snapshot: ReagentAsyncRequestSnapshot,
  ) => boolean;
  checkCASWarning: (
    casNumber: string,
    options?: { force?: boolean },
  ) => Promise<void>;
  setIsCasLookupLoading: Dispatch<SetStateAction<boolean>>;
}) {
  const {
    reagentForm,
    clearCASWarning,
    createReagentAsyncSnapshot,
    canApplyReagentAsyncResult,
    checkCASWarning,
    setIsCasLookupLoading,
  } = params;
  const isValidCas = await reagentForm.trigger("cas_number");
  if (!isValidCas) {
    return;
  }

  const normalizedCas = prepareCartImportCasLookup(reagentForm);
  if (!normalizedCas) {
    return;
  }

  if (isSpecialCasValue(normalizedCas)) {
    reagentForm.setError("cas_number", {
      message: "生物试剂不支持 CAS 识别查询",
    });
    clearCASWarning();
    return;
  }

  setIsCasLookupLoading(true);
  const lookupRequest = createReagentAsyncSnapshot(normalizedCas);
  try {
    const response = await chemicalAPI.getInfo(normalizedCas);
    if (!canApplyReagentAsyncResult(lookupRequest)) {
      return;
    }
    const info = response.data;
    if (info.english_name) {
      reagentForm.setValue("english_name", info.english_name, {
        shouldValidate: true,
      });
      toast.success("CAS 英文名已自动填入");
    } else {
      toast.warning("未查询到英文名");
    }
  } catch (error) {
    if (canApplyReagentAsyncResult(lookupRequest)) {
      toast.error(getApiErrorMessage(error, "CAS 号识别失败"));
    }
  } finally {
    if (canApplyReagentAsyncResult(lookupRequest)) {
      setIsCasLookupLoading(false);
    }
  }

  if (canApplyReagentAsyncResult(lookupRequest)) {
    await checkCASWarning(normalizedCas, { force: true });
  }
}

function useCartImportReagentFormState(params: {
  currentItem: ImportItem | null;
  orderType: OrderType;
  reagentForm: UseFormReturn<
    ReagentOrderFormInputData,
    unknown,
    ReagentOrderFormData
  >;
}) {
  const { currentItem, orderType, reagentForm } = params;
  const [isCasLookupLoading, setIsCasLookupLoading] = useState(false);
  const {
    casWarning,
    casLoading,
    checkCASWarning,
    clearCASWarning,
    handleCasValueChange,
  } = useReagentCasDuplicateCheck();
  const {
    invalidateReagentAsyncRequests,
    createReagentAsyncSnapshot,
    canApplyReagentAsyncResult,
  } = useCartImportReagentAsyncGuard({
    currentItemId: currentItem?.id ?? null,
    orderType,
    reagentForm,
    setIsCasLookupLoading,
  });

  const resetReagentFormByItem = useCallback(
    (item: ImportItem) => {
      reagentForm.reset(
        createCartImportReagentFormValues(item, cartImportDraftDefaults),
      );
      // 切卡时先清掉上一项预警，再基于目标条目的快照发起新检查，避免串到旧卡片。
      clearCASWarning();
      const nextCasToCheck = getCartImportReagentCasOnSelection({
        orderType: "reagent",
        itemCasNumber: item.cas_number,
      });
      if (nextCasToCheck) {
        void checkCASWarning(nextCasToCheck, { force: true });
      }

      const autofillRequest = createReagentAsyncSnapshot(item.cas_number);
      autofillCartImportEnglishName(item).then((englishName) => {
        if (!englishName || !canApplyReagentAsyncResult(autofillRequest)) {
          return;
        }
        // 用户已经手改过英文名时，不再用异步补全覆盖。
        if (reagentForm.getFieldState("english_name").isDirty) {
          return;
        }
        reagentForm.setValue("english_name", englishName, {
          shouldValidate: false,
        });
      });
    },
    [
      canApplyReagentAsyncResult,
      checkCASWarning,
      clearCASWarning,
      createReagentAsyncSnapshot,
      reagentForm,
    ],
  );

  useEffect(() => {
    invalidateReagentAsyncRequests();
  }, [currentItem?.id, orderType, invalidateReagentAsyncRequests]);

  useEffect(() => {
    const subscription = reagentForm.watch((value, field) => {
      if (field.name === "cas_number") {
        const currentValue = normalizeCASInputValue(value.cas_number || "");
        invalidateReagentAsyncRequests();
        reagentForm.clearErrors("cas_number");
        handleCasValueChange(currentValue);
      }
    });
    return () => subscription.unsubscribe();
  }, [handleCasValueChange, invalidateReagentAsyncRequests, reagentForm]);

  const handleCasLookup = useCallback(async () => {
    await runCartImportCasLookup({
      reagentForm,
      clearCASWarning,
      createReagentAsyncSnapshot,
      canApplyReagentAsyncResult,
      checkCASWarning,
      setIsCasLookupLoading,
    });
  }, [
    canApplyReagentAsyncResult,
    checkCASWarning,
    clearCASWarning,
    createReagentAsyncSnapshot,
    reagentForm,
  ]);

  const reagentFormFields = useMemo(
    () =>
      createCartImportReagentFormFields({
        checkCASWarning,
        handleCasLookup,
        isCasLookupLoading,
      }),
    [checkCASWarning, handleCasLookup, isCasLookupLoading],
  );

  return {
    casWarning,
    casLoading,
    clearCASWarning,
    reagentFormFields,
    resetReagentFormByItem,
  };
}

async function submitCartImportReagentForm(
  reagentForm: UseFormReturn<
    ReagentOrderFormInputData,
    unknown,
    ReagentOrderFormData
  >,
): Promise<boolean> {
  let submitSucceeded = false;
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
      });
      submitSucceeded = true;
    },
    () => {
      /* 表单错误已内联显示 */
    },
  );

  await submitReagent();
  return submitSucceeded;
}

async function submitCartImportConsumableForm(
  consumableForm: UseFormReturn<
    ConsumableOrderFormInputData,
    unknown,
    ConsumableOrderFormData
  >,
): Promise<boolean> {
  let submitSucceeded = false;
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
      });
      submitSucceeded = true;
    },
    () => {
      /* 表单错误已内联显示 */
    },
  );

  await submitConsumable();
  return submitSucceeded;
}

export function useCartImportBatchController() {
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const batchId = searchParams.get("batch_id") || "";
  const importFlag = searchParams.get("import") === "true";
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submittedIds, setSubmittedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const currentItem = items[currentIndex] ?? null;

  const loadBatchFromStorage = useCallback(() => {
    const result = readCartImportBatchFromStorage(
      batchId,
      importFlag,
      cartImportDraftDefaults,
    );
    if (result.type === "loaded") {
      setItems(result.items);
      setCurrentIndex(0);
      setLoading(false);
      return true;
    }

    if (result.type === "redirect") {
      if (result.clearStorage) {
        clearCartImportBatchStorage();
      }
      toast.error(result.message);
      navigate("/reagents");
      return true;
    }

    return false;
  }, [batchId, importFlag, navigate]);

  useEffect(() => {
    authAPI
      .getProfile()
      .then((response) => setCurrentUser(response.data))
      .catch((error) => {
        toast.error(getApiErrorMessage(error, "获取当前用户失败"));
      });
  }, []);

  useEffect(() => {
    let retryTimer: ReturnType<typeof globalThis.setInterval> | undefined;
    const initialLoadTimer = globalThis.setTimeout(() => {
      if (loadBatchFromStorage()) {
        return;
      }

      let retryCount = 0;
      retryTimer = globalThis.setInterval(() => {
        retryCount += 1;
        const loaded = loadBatchFromStorage();
        if (loaded || retryCount >= 10) {
          globalThis.clearInterval(retryTimer);
          if (!loaded) {
            toast.error("未找到批次数据，请重试");
            navigate("/reagents");
          }
        }
      }, 300);
    }, 0);

    const handleBatchMessage = (event: MessageEvent) => {
      if (event.origin !== globalThis.location.origin) {
        return;
      }
      // 插件有时晚于页面初始化写入批次，收到 ready 消息后再补一次拉取。
      const data = event.data as { source?: string; type?: string };
      if (
        data?.source === "lab-storage-extension" &&
        data.type === "IMPORT_BATCH_READY"
      ) {
        loadBatchFromStorage();
      }
    };

    globalThis.addEventListener("message", handleBatchMessage);
    return () => {
      globalThis.clearTimeout(initialLoadTimer);
      if (retryTimer) {
        globalThis.clearInterval(retryTimer);
      }
      globalThis.removeEventListener("message", handleBatchMessage);
    };
  }, [loadBatchFromStorage, navigate]);

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
  };
}

export function useCartImportFormController(
  currentItem: ImportItem | null,
  currentIndex: number,
  setItems: Dispatch<SetStateAction<ImportItem[]>>,
) {
  const orderType: OrderType = currentItem?.order_type ?? "reagent";
  const reagentForm = useForm<
    ReagentOrderFormInputData,
    unknown,
    ReagentOrderFormData
  >({
    resolver: createValibotResolver(ReagentOrderSchema),
    defaultValues: defaultReagentOrderValues,
    shouldFocusError: false,
  });
  const consumableForm = useForm<
    ConsumableOrderFormInputData,
    unknown,
    ConsumableOrderFormData
  >({
    resolver: createValibotResolver(ConsumableOrderSchema),
    defaultValues: defaultConsumableOrderValues,
    shouldFocusError: false,
  });
  const {
    casWarning,
    casLoading,
    clearCASWarning,
    reagentFormFields,
    resetReagentFormByItem,
  } = useCartImportReagentFormState({
    currentItem,
    orderType,
    reagentForm,
  });

  const fillFormByItem = useCallback(
    (item: ImportItem, forcedType?: OrderType) => {
      const currentType =
        forcedType ||
        item.order_type ||
        item.suggested_order_type ||
        detectOrderType(item.cas_number);

      if (currentType === "reagent") {
        resetReagentFormByItem(item);
        return;
      }

      consumableForm.reset(
        createCartImportConsumableFormValues(item, cartImportDraftDefaults),
      );
    },
    [consumableForm, resetReagentFormByItem],
  );

  const persistCurrentDraft = useCallback(
    (forcedType?: OrderType) => {
      if (!currentItem) {
        return null;
      }

      // 所有切卡、切类型都走同一条草稿持久化路径，避免再次出现草稿丢失。
      const nextOrderType = forcedType || orderType;
      const reagentDraft =
        orderType === "reagent" ? reagentForm.getValues() : currentItem.reagent_draft;
      const consumableDraft =
        orderType === "consumable" ? consumableForm.getValues() : currentItem.consumable_draft;
      const nextItem = updateImportItemWithDrafts({
        item: currentItem,
        orderType: nextOrderType,
        reagentDraft,
        consumableDraft,
        defaults: cartImportDraftDefaults,
      });

      setItems((previousItems) =>
        previousItems.map((item, index) =>
          index === currentIndex ? nextItem : item,
        ),
      );

      return nextItem;
    },
    [
      consumableForm,
      currentIndex,
      currentItem,
      orderType,
      reagentForm,
      setItems,
    ],
  );

  useEffect(() => {
    if (currentItem) {
      fillFormByItem(currentItem);
    }
  }, [currentItem, fillFormByItem]);

  const handleTypeSwitch = useCallback(
    (value: OrderType) => {
      if (!currentItem) {
        return;
      }

      const nextItem = persistCurrentDraft(value);
      fillFormByItem(nextItem || currentItem, value);
      if (value !== "reagent") {
        clearCASWarning();
      }
    },
    [clearCASWarning, currentItem, fillFormByItem, persistCurrentDraft],
  );

  return {
    orderType,
    reagentForm,
    consumableForm,
    reagentFormFields,
    casWarning,
    casLoading,
    handleTypeSwitch,
    persistCurrentDraft,
  };
}

function useResetCartImportDeleteConfirmOnItemChange(
  currentItem: ImportItem | null,
  setDeleteConfirm: Dispatch<SetStateAction<boolean>>,
) {
  useEffect(() => {
    if (currentItem) {
      setDeleteConfirm(false);
    }
  }, [currentItem, setDeleteConfirm]);
}

export function useCartImportActions(params: {
  items: ImportItem[];
  setItems: Dispatch<SetStateAction<ImportItem[]>>;
  currentIndex: number;
  setCurrentIndex: Dispatch<SetStateAction<number>>;
  submittedIds: Set<number>;
  setSubmittedIds: Dispatch<SetStateAction<Set<number>>>;
  currentItem: ImportItem | null;
  navigate: (path: string) => void | Promise<void>;
  orderType: OrderType;
  casWarningCasNumber?: string;
  reagentForm: UseFormReturn<
    ReagentOrderFormInputData,
    unknown,
    ReagentOrderFormData
  >;
  consumableForm: UseFormReturn<
    ConsumableOrderFormInputData,
    unknown,
    ConsumableOrderFormData
  >;
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
  } = params;
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  useResetCartImportDeleteConfirmOnItemChange(currentItem, setDeleteConfirm);

  const handleDeleteCurrent = useCallback(() => {
    if (!currentItem) {
      return;
    }

    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }

    setDeleteConfirm(false);
    const nextItems = items.filter((_, index) => index !== currentIndex);
    const nextSubmittedIds = removeSubmittedImportId(submittedIds, currentItem.id);
    setItems(nextItems);
    setSubmittedIds(nextSubmittedIds);
    if (nextItems.length === 0) {
      // 保持原交互：删空批次后给提示，再延迟回跳。
      toast.success("已删除全部条目，即将返回试剂页");
      clearCartImportBatchStorage();
      scheduleCartImportReturn(navigate);
      return;
    }

    setCurrentIndex(Math.min(currentIndex, nextItems.length - 1));
    toast.success(`已删除: ${currentItem.name}`);
  }, [
    currentIndex,
    currentItem,
    deleteConfirm,
    items,
    navigate,
    setCurrentIndex,
    setItems,
    setSubmittedIds,
    submittedIds,
  ]);

  const handleSubmitCurrent = useCallback(async () => {
    if (!currentItem) {
      return;
    }

    setDeleteConfirm(false);
    setSubmitting(true);
    try {
      const submitSucceeded =
        orderType === "reagent"
          ? await submitCartImportReagentForm(reagentForm)
          : await submitCartImportConsumableForm(consumableForm);

      if (!submitSucceeded) {
        return;
      }

      const nextSubmitted = new Set(submittedIds);
      nextSubmitted.add(currentItem.id);
      setSubmittedIds(nextSubmitted);
      toast.success(`已提交: ${currentItem.name}`);

      const nextPendingIndex = findNextPendingImportIndex(items, nextSubmitted);
      if (nextPendingIndex >= 0) {
        setCurrentIndex(nextPendingIndex);
      }

      if (nextSubmitted.size >= items.length) {
        // 与旧页一致，全部完成后不立即跳走，给用户留出成功反馈时间。
        toast.success("全部导入完成，即将返回试剂页");
        clearCartImportBatchStorage();
        scheduleCartImportReturn(navigate);
      }
    } catch (error) {
      const detail = extractApiErrorDetail(error);
      const validationErrors = toValidationErrors(detail);
      if (
        applyCartImportValidationErrors({
          orderType,
          validationErrors,
          reagentForm,
          consumableForm,
        })
      ) {
        return;
      }
      toast.error(normalizeApiErrorMessage(detail, "提交失败"));
    } finally {
      setSubmitting(false);
    }
  }, [
    consumableForm,
    currentItem,
    items,
    navigate,
    orderType,
    reagentForm,
    setCurrentIndex,
    setSubmittedIds,
    submittedIds,
  ]);

  const navigateToCasSearch = useCallback(
    (path: string, field: string) => {
      if (!casWarningCasNumber) {
        return;
      }

      const query = new URLSearchParams({
        search: casWarningCasNumber,
        field,
      });
      navigate(`${path}?${query.toString()}`);
    },
    [casWarningCasNumber, navigate],
  );

  return {
    deleteConfirm,
    submitting,
    handleDeleteCurrent,
    handleSubmitCurrent,
    navigateToCasSearch,
  };
}
