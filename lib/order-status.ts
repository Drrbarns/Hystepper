/** Canonical order fulfillment statuses for Hy_stepper admin. */

export const ORDER_STATUS_OPTIONS = [
  'pending',
  'processing',
  'packed',
  'packaging_for_delivery',
  'shipped',
  'delivered',
  'returned',
  'cancelled',
] as const;

export type OrderStatusOption = (typeof ORDER_STATUS_OPTIONS)[number];

const LABELS: Record<string, string> = {
  pending: 'Pending',
  awaiting_payment: 'Awaiting Payment',
  processing: 'Processing',
  packed: 'Packed',
  packaging_for_delivery: 'Packaging for Delivery',
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Completed',
  returned: 'Returned',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export const ORDER_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 border-amber-200',
  awaiting_payment: 'bg-gray-100 text-gray-700 border-gray-200',
  processing: 'bg-blue-100 text-blue-700 border-blue-200',
  packed: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  packaging_for_delivery: 'bg-sky-100 text-sky-800 border-sky-200',
  shipped: 'bg-purple-100 text-purple-700 border-purple-200',
  delivered: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  completed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  returned: 'bg-orange-100 text-orange-800 border-orange-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
  refunded: 'bg-red-100 text-red-700 border-red-200',
};

export function formatOrderStatus(status: string | null | undefined): string {
  if (!status) return 'Unknown';
  if (LABELS[status]) return LABELS[status];
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Still need warehouse picking (paid / confirmed sales). */
export const PACKING_LIST_STATUSES = ['processing', 'packed'] as const;

/** Optional later stages on the packing list when “include shipped” is on. */
export const PACKING_LIST_LATE_STATUSES = ['packaging_for_delivery', 'shipped'] as const;

/** Can be assigned to a rider / delivery queue. */
export const DELIVERY_ASSIGNABLE_STATUSES = [
  'processing',
  'packed',
  'packaging_for_delivery',
  'shipped',
] as const;
