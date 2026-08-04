/**
 * Store-wide promotions + loyalty config helpers.
 * Settings live in public.store_settings and are managed at /admin/promotions.
 */

import { supabase } from '@/lib/supabase';

export type StorePromotions = {
  storewideSaleEnabled: boolean;
  storewideSalePercent: number;
  storewideSaleName: string;
  globalDeliveryDiscountPercent: number;
  freeDeliveryMinItems: number;
  loyaltyEnabled: boolean;
  loyaltyPointsPerItem: number;
  loyaltyMinRedeem: number;
  loyaltyExpiryMonths: number;
  loyaltyPointValueGhs: number;
};

export const DEFAULT_PROMOTIONS: StorePromotions = {
  storewideSaleEnabled: false,
  storewideSalePercent: 0,
  storewideSaleName: '',
  globalDeliveryDiscountPercent: 0,
  freeDeliveryMinItems: 0,
  loyaltyEnabled: true,
  loyaltyPointsPerItem: 5,
  loyaltyMinRedeem: 15,
  loyaltyExpiryMonths: 6,
  loyaltyPointValueGhs: 1,
};

const PROMO_KEYS = [
  'storewide_sale_enabled',
  'storewide_sale_percent',
  'storewide_sale_name',
  'global_delivery_discount_percent',
  'free_delivery_min_items',
  'loyalty_enabled',
  'loyalty_points_per_item',
  'loyalty_min_redeem',
  'loyalty_expiry_months',
  'loyalty_point_value_ghs',
] as const;

function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === '') return false;
  }
  return fallback;
}

function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (v == null) return fallback;
  return String(v);
}

export function parsePromotions(rows: Array<{ key: string; value: unknown }> | null | undefined): StorePromotions {
  const map = new Map((rows || []).map((r) => [r.key, r.value]));
  return {
    storewideSaleEnabled: asBool(map.get('storewide_sale_enabled'), false),
    storewideSalePercent: Math.min(100, Math.max(0, asNumber(map.get('storewide_sale_percent'), 0))),
    storewideSaleName: asString(map.get('storewide_sale_name'), ''),
    globalDeliveryDiscountPercent: Math.min(100, Math.max(0, asNumber(map.get('global_delivery_discount_percent'), 0))),
    freeDeliveryMinItems: Math.max(0, Math.floor(asNumber(map.get('free_delivery_min_items'), 0))),
    loyaltyEnabled: asBool(map.get('loyalty_enabled'), true),
    loyaltyPointsPerItem: Math.max(0, Math.floor(asNumber(map.get('loyalty_points_per_item'), 5))),
    loyaltyMinRedeem: Math.max(0, Math.floor(asNumber(map.get('loyalty_min_redeem'), 15))),
    loyaltyExpiryMonths: Math.max(1, Math.floor(asNumber(map.get('loyalty_expiry_months'), 6))),
    loyaltyPointValueGhs: Math.max(0, asNumber(map.get('loyalty_point_value_ghs'), 1)),
  };
}

export async function fetchStorePromotions(): Promise<StorePromotions> {
  const { data, error } = await supabase
    .from('store_settings')
    .select('key, value')
    .in('key', [...PROMO_KEYS]);

  if (error) {
    console.error('[promotions] failed to load settings:', error.message);
    return { ...DEFAULT_PROMOTIONS };
  }
  return parsePromotions(data);
}

/** Effective selling price when a store-wide sale is active. */
export function salePrice(listPrice: number, promo: Pick<StorePromotions, 'storewideSaleEnabled' | 'storewideSalePercent'>): number {
  const price = Math.max(0, Number(listPrice) || 0);
  if (!promo.storewideSaleEnabled || promo.storewideSalePercent <= 0) return price;
  return Math.max(0, Math.round(price * (1 - promo.storewideSalePercent / 100) * 100) / 100);
}

export function storewideDiscountAmount(subtotal: number, promo: Pick<StorePromotions, 'storewideSaleEnabled' | 'storewideSalePercent'>): number {
  const base = Math.max(0, Number(subtotal) || 0);
  if (!promo.storewideSaleEnabled || promo.storewideSalePercent <= 0) return 0;
  return Math.max(0, Math.round(base * (promo.storewideSalePercent / 100) * 100) / 100);
}

/**
 * Delivery fee discounts (zone free/%, global %, free-by-item-count) are
 * exclusive of checkout promotions. They do NOT stack with coupons, Sleek
 * Points redemption, or store-wide sale %.
 *
 * Individual sale / non-sale product prices in the cart do NOT block delivery
 * discounts — mixed carts still qualify when location rules apply.
 */
export function isDeliveryDiscountEligible(opts: {
  hasCoupon?: boolean;
  hasLoyaltyRedeem?: boolean;
  hasStorewideSale?: boolean;
}): boolean {
  if (opts.hasCoupon) return false;
  if (opts.hasLoyaltyRedeem) return false;
  if (opts.hasStorewideSale) return false;
  return true;
}

/**
 * Apply zone free-delivery / zone % off, then global delivery discount,
 * then free-by-item-count threshold.
 * Pass `eligible: false` to skip all delivery promotions (full fee).
 */
export function applyDeliveryFeeAdjustments(
  fee: number,
  opts: {
    zoneFreeDelivery?: boolean;
    zoneDiscountPercent?: number;
    globalDeliveryDiscountPercent?: number;
    freeDeliveryMinItems?: number;
    totalItems?: number;
    /** When false, return the raw fee with no delivery promotions. Default true. */
    eligible?: boolean;
  }
): number {
  let result = Math.max(0, Number(fee) || 0);
  if (opts.eligible === false) return Math.round(result * 100) / 100;

  const minItems = Math.max(0, Math.floor(Number(opts.freeDeliveryMinItems) || 0));
  const items = Math.max(0, Math.floor(Number(opts.totalItems) || 0));

  if (minItems > 0 && items >= minItems) return 0;
  if (opts.zoneFreeDelivery) return 0;

  const zonePct = Math.min(100, Math.max(0, Number(opts.zoneDiscountPercent) || 0));
  if (zonePct > 0) result = result * (1 - zonePct / 100);

  const globalPct = Math.min(100, Math.max(0, Number(opts.globalDeliveryDiscountPercent) || 0));
  if (globalPct > 0) result = result * (1 - globalPct / 100);

  return Math.max(0, Math.round(result * 100) / 100);
}

export function loyaltyDiscountAmount(
  pointsBalance: number,
  redeem: boolean,
  merchandiseSubtotal: number,
  promo: Pick<StorePromotions, 'loyaltyEnabled' | 'loyaltyMinRedeem' | 'loyaltyPointValueGhs'>
): number {
  if (!redeem || !promo.loyaltyEnabled) return 0;
  if (pointsBalance < promo.loyaltyMinRedeem) return 0;
  const value = Math.max(0, promo.loyaltyPointValueGhs);
  const maxFromPoints = pointsBalance * value;
  return Math.min(maxFromPoints, Math.max(0, merchandiseSubtotal));
}

export function pointsToRedeemForDiscount(
  discountGhs: number,
  promo: Pick<StorePromotions, 'loyaltyPointValueGhs'>
): number {
  const value = Math.max(0.0001, promo.loyaltyPointValueGhs || 1);
  return Math.ceil(discountGhs / value);
}
