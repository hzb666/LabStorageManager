export const INVENTORY_SSE_EVENTS = [
  'inventory.created',
  'inventory.updated',
  'inventory.deleted',
  'inventory.borrowed',
  'inventory.returned',
] as const

export const COMMON_SHELF_SSE_EVENTS = [
  'common_shelf.created',
  'common_shelf.updated',
  'common_shelf.deleted',
] as const

export const REAGENT_ORDER_SSE_EVENTS = [
  'reagent_order.created',
  'reagent_order.updated',
  'reagent_order.deleted',
] as const

export const CONSUMABLE_ORDER_SSE_EVENTS = [
  'consumable_order.created',
  'consumable_order.updated',
  'consumable_order.deleted',
] as const
