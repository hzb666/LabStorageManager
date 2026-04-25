import { normalizeCASInputValue } from "@/lib/validationSchemas";

export const CART_STORAGE_KEY = "cart_import_batch_latest";
const BATCH_TTL_MS = 2 * 60 * 60 * 1000;

export type OrderType = "reagent" | "consumable";

export interface ReagentDraft {
  name: string;
  cas_number: string;
  english_name: string;
  alias: string;
  category: string;
  brand: string;
  specification: string;
  quantity: string | number;
  price?: string | number | undefined;
  order_reason:
    | "running_out"
    | "not_stocked"
    | "common_public"
    | "not_found"
    | "reorder"
    | "high_usage"
    | "degraded"
    | "others";
  is_hazardous: boolean;
  notes: string;
}

export interface ConsumableDraft {
  name: string;
  english_name: string;
  product_number: string;
  specification: string;
  unit: string;
  quantity: string | number;
  price?: string | number | undefined;
  communication?: string;
  notes: string;
}

export interface CartImportDraftDefaults {
  reagent: ReagentDraft;
  consumable: ConsumableDraft;
}

export interface CurrentUser {
  id: number;
  username: string;
  full_name: string | null;
}

export interface ImportItem {
  id: number;
  name: string;
  cas_number: string;
  english_name: string;
  specification: string;
  quantity: number;
  price?: number;
  brand: string;
  alias: string;
  unit: string;
  product_number: string;
  is_hazardous: boolean;
  order_type: OrderType;
  suggested_order_type: OrderType;
  product_id: string;
  detail_url: string;
  reagent_draft: ReagentDraft;
  consumable_draft: ConsumableDraft;
}

export interface StoredBatch {
  batch_id: string;
  items: Array<Partial<ImportItem>>;
  created_at: string;
}

export type BatchLoadResult =
  | { type: "loaded"; items: ImportItem[] }
  | { type: "redirect"; message: string; clearStorage?: boolean }
  | { type: "retry" };

type ImportTextField =
  | "name"
  | "english_name"
  | "specification"
  | "brand"
  | "alias"
  | "unit"
  | "product_number"
  | "product_id"
  | "detail_url";

export interface ReagentAsyncRequestSnapshot {
  token: number;
  itemId: number | null;
  orderType: OrderType;
  casNumber: string;
}

export interface ReagentAsyncGuardState {
  latestToken: number;
  currentItemId: number | null;
  currentOrderType: OrderType;
  currentCasNumber: string;
}

export interface CartImportReagentSelectionSnapshot {
  orderType: OrderType;
  itemCasNumber: string | null | undefined;
}

function readCartImportBatchStorageRaw(): string | null {
  try {
    return localStorage.getItem(CART_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearCartImportBatchStorage(): void {
  try {
    localStorage.removeItem(CART_STORAGE_KEY);
  } catch {
    // 忽略存储异常
  }
}

export function isExpiredBatch(batch: StoredBatch): boolean {
  const createdAt = batch?.created_at
    ? Date.parse(batch.created_at)
    : Number.NaN;
  return Number.isNaN(createdAt) || Date.now() - createdAt > BATCH_TTL_MS;
}

export function extractFirstCasNumber(input: string): string {
  // 插件抓取的 CAS 文本可能夹带纯度或其他描述，导入时只认首个合法 CAS。
  const match = /\b\d{2,7}-\d{2}-\d\b/.exec(String(input || ""));
  return match ? match[0] : "";
}

export function detectOrderType(casNumber: string): OrderType {
  return extractFirstCasNumber(casNumber) ? "reagent" : "consumable";
}

export function normalizeOrderType(value: unknown): OrderType {
  return value === "reagent" ? "reagent" : "consumable";
}

export function normalizeReagentSpecification(specification: string): string {
  const trimmed = (specification || "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.split("/")[0].trim();
}

export function isPlaceholderImportName(name: string): boolean {
  const normalized = (name || "").trim();
  return normalized === "未知";
}

export function shouldSkipChineseLookupByName(name: string): boolean {
  const normalizedName = (name || "").trim();
  return Boolean(normalizedName && !isPlaceholderImportName(normalizedName));
}

function readImportText(item: Partial<ImportItem>, field: ImportTextField): string {
  const value = item[field];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeImportName(item: Partial<ImportItem>): string {
  const rawName = readImportText(item, "name");
  return isPlaceholderImportName(rawName) ? "" : rawName;
}

export function normalizeImportQuantity(quantity: unknown): number {
  if (
    typeof quantity === "number" &&
    Number.isFinite(quantity) &&
    quantity > 0
  ) {
    return quantity;
  }
  const parsedQuantity = Number(quantity);
  return Number.isFinite(parsedQuantity) && parsedQuantity > 0
    ? parsedQuantity
    : 1;
}

export function normalizeImportPrice(price: unknown): number | undefined {
  return typeof price === "number" && Number.isFinite(price)
    ? price
    : undefined;
}

export function createInitialReagentDraft(
  item: Pick<
    ImportItem,
    | "name"
    | "cas_number"
    | "english_name"
    | "alias"
    | "brand"
    | "specification"
    | "quantity"
    | "price"
    | "is_hazardous"
  >,
  defaults: CartImportDraftDefaults,
): ReagentDraft {
  return {
    ...defaults.reagent,
    name: item.name,
    cas_number: item.cas_number,
    english_name: item.english_name,
    alias: item.alias,
    brand: item.brand,
    specification: normalizeReagentSpecification(item.specification),
    quantity: item.quantity,
    price: item.price,
    is_hazardous: item.is_hazardous,
  };
}

export function createInitialConsumableDraft(
  item: Pick<
    ImportItem,
    | "name"
    | "english_name"
    | "product_number"
    | "specification"
    | "unit"
    | "quantity"
    | "price"
  >,
  defaults: CartImportDraftDefaults,
): ConsumableDraft {
  return {
    ...defaults.consumable,
    name: item.name,
    english_name: item.english_name,
    product_number: item.product_number,
    specification: item.specification,
    unit: item.unit,
    quantity: item.quantity,
    price: item.price,
  };
}

export function toImportItem(
  item: Partial<ImportItem>,
  index: number,
  defaults: CartImportDraftDefaults,
): ImportItem {
  // 批次解析阶段统一收口脏数据，后续表单和提交都只处理稳定的页面模型。
  const casNumber = extractFirstCasNumber(item.cas_number || "");
  const suggestedOrderType = normalizeOrderType(
    item.suggested_order_type ?? item.order_type ?? detectOrderType(casNumber),
  );
  const orderType = normalizeOrderType(item.order_type ?? suggestedOrderType);
  const importItem: ImportItem = {
    id: index,
    name: normalizeImportName(item),
    cas_number: casNumber,
    english_name: readImportText(item, "english_name"),
    specification: readImportText(item, "specification"),
    quantity: normalizeImportQuantity(item.quantity),
    price: normalizeImportPrice(item.price),
    brand: readImportText(item, "brand"),
    alias: readImportText(item, "alias"),
    unit: readImportText(item, "unit"),
    product_number: readImportText(item, "product_number"),
    is_hazardous: Boolean(item.is_hazardous),
    order_type: orderType,
    suggested_order_type: suggestedOrderType,
    product_id: readImportText(item, "product_id"),
    detail_url: readImportText(item, "detail_url"),
    reagent_draft: { ...defaults.reagent },
    consumable_draft: { ...defaults.consumable },
  };

  return {
    ...importItem,
    reagent_draft: createInitialReagentDraft(importItem, defaults),
    consumable_draft: createInitialConsumableDraft(importItem, defaults),
  };
}

export function readCartImportBatchFromStorage(
  batchId: string,
  importFlag: boolean,
  defaults: CartImportDraftDefaults,
): BatchLoadResult {
  if (!importFlag || !batchId) {
    return {
      type: "redirect",
      message: "缺少导入参数，请从浏览器插件重新发起导入",
    };
  }

  const raw = readCartImportBatchStorageRaw();
  if (!raw) {
    return { type: "retry" };
  }

  try {
    const batch = JSON.parse(raw) as StoredBatch;
    if (batch.batch_id !== batchId) {
      return { type: "redirect", message: "批次ID不匹配，请重新发起导入" };
    }

    if (isExpiredBatch(batch)) {
      return {
        type: "redirect",
        message: "导入批次已过期（2小时），请在插件中重新发起导入",
        clearStorage: true,
      };
    }

    const parsedItems = (batch.items || []).map((item, index) =>
      toImportItem(item, index, defaults),
    );

    if (parsedItems.length === 0) {
      return {
        type: "redirect",
        message: "当前批次没有可导入商品，请在插件中重新抓取",
      };
    }

    return { type: "loaded", items: parsedItems };
  } catch {
    return {
      type: "redirect",
      message: "批次数据解析失败，请重新发起导入",
      clearStorage: true,
    };
  }
}

export function createCartImportReagentFormValues(
  item: ImportItem,
  defaults: CartImportDraftDefaults,
): ReagentDraft {
  return {
    ...defaults.reagent,
    ...item.reagent_draft,
  };
}

export function createCartImportConsumableFormValues(
  item: ImportItem,
  defaults: CartImportDraftDefaults,
): ConsumableDraft {
  return {
    ...defaults.consumable,
    ...item.consumable_draft,
  };
}

export function updateImportItemWithDrafts(params: {
  item: ImportItem;
  orderType: OrderType;
  reagentDraft: ReagentDraft;
  consumableDraft: ConsumableDraft;
  defaults: CartImportDraftDefaults;
}): ImportItem {
  const { item, orderType, reagentDraft, consumableDraft, defaults } = params;
  // 切卡或切类型前先把当前表单压回条目，避免上一轮草稿只留在 react-hook-form 内存里。
  const normalizedReagentDraft: ReagentDraft = {
    ...defaults.reagent,
    ...reagentDraft,
    cas_number: extractFirstCasNumber(reagentDraft.cas_number || ""),
    quantity: normalizeImportQuantity(reagentDraft.quantity),
    price: normalizeImportPrice(reagentDraft.price),
  };
  const normalizedConsumableDraft: ConsumableDraft = {
    ...defaults.consumable,
    ...consumableDraft,
    quantity: normalizeImportQuantity(consumableDraft.quantity),
    price: normalizeImportPrice(consumableDraft.price),
  };

  if (orderType === "reagent") {
    return {
      ...item,
      name: normalizedReagentDraft.name.trim(),
      cas_number: normalizedReagentDraft.cas_number,
      english_name: (normalizedReagentDraft.english_name || "").trim(),
      specification: (normalizedReagentDraft.specification || "").trim(),
      quantity: normalizeImportQuantity(normalizedReagentDraft.quantity),
      price: normalizeImportPrice(normalizedReagentDraft.price),
      brand: (normalizedReagentDraft.brand || "").trim(),
      alias: (normalizedReagentDraft.alias || "").trim(),
      is_hazardous: Boolean(normalizedReagentDraft.is_hazardous),
      order_type: orderType,
      reagent_draft: normalizedReagentDraft,
      consumable_draft: normalizedConsumableDraft,
    };
  }

  return {
    ...item,
    name: normalizedConsumableDraft.name.trim(),
    english_name: (normalizedConsumableDraft.english_name || "").trim(),
    specification: (normalizedConsumableDraft.specification || "").trim(),
    quantity: normalizeImportQuantity(normalizedConsumableDraft.quantity),
    price: normalizeImportPrice(normalizedConsumableDraft.price),
    unit: (normalizedConsumableDraft.unit || "").trim(),
    product_number: (normalizedConsumableDraft.product_number || "").trim(),
    order_type: orderType,
    reagent_draft: normalizedReagentDraft,
    consumable_draft: normalizedConsumableDraft,
  };
}

export function normalizeReagentAsyncCas(casNumber: string | null | undefined): string {
  return normalizeCASInputValue(String(casNumber || ""));
}

export function getCartImportReagentCasOnSelection(
  snapshot: CartImportReagentSelectionSnapshot,
): string {
  if (snapshot.orderType !== "reagent") {
    return "";
  }

  return normalizeReagentAsyncCas(snapshot.itemCasNumber);
}

export function shouldApplyReagentAsyncResult(
  snapshot: ReagentAsyncRequestSnapshot,
  state: ReagentAsyncGuardState,
): boolean {
  // 结果需同时命中“最新请求 + 当前条目 + 当前类型 + 当前 CAS”，不匹配的一律丢弃。
  return (
    snapshot.token === state.latestToken &&
    snapshot.orderType === "reagent" &&
    state.currentOrderType === "reagent" &&
    snapshot.itemId !== null &&
    snapshot.itemId === state.currentItemId &&
    snapshot.casNumber === normalizeReagentAsyncCas(state.currentCasNumber)
  );
}

export function findNextPendingImportIndex(
  items: ImportItem[],
  submittedIds: Set<number>,
): number {
  return items.findIndex((item) => !submittedIds.has(item.id));
}

export function removeSubmittedImportId(
  submittedIds: Set<number>,
  removedItemId: number,
): Set<number> {
  const nextSubmittedIds = new Set(submittedIds);
  nextSubmittedIds.delete(removedItemId);
  return nextSubmittedIds;
}

export function scheduleCartImportReturn(
  navigate: (path: string) => void | Promise<void>,
): void {
  globalThis.setTimeout(() => navigate("/reagents"), 2000);
}
