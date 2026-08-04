'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { parsePromotions, DEFAULT_PROMOTIONS, type StorePromotions } from '@/lib/promotions';

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

type PromoForm = {
  storewide_sale_enabled: boolean;
  storewide_sale_percent: number;
  storewide_sale_name: string;
  global_delivery_discount_percent: number;
  free_delivery_min_items: number;
  loyalty_enabled: boolean;
  loyalty_points_per_item: number;
  loyalty_min_redeem: number;
  loyalty_expiry_months: number;
  loyalty_point_value_ghs: number;
};

function toForm(p: StorePromotions): PromoForm {
  return {
    storewide_sale_enabled: p.storewideSaleEnabled,
    storewide_sale_percent: p.storewideSalePercent,
    storewide_sale_name: p.storewideSaleName,
    global_delivery_discount_percent: p.globalDeliveryDiscountPercent,
    free_delivery_min_items: p.freeDeliveryMinItems,
    loyalty_enabled: p.loyaltyEnabled,
    loyalty_points_per_item: p.loyaltyPointsPerItem,
    loyalty_min_redeem: p.loyaltyMinRedeem,
    loyalty_expiry_months: p.loyaltyExpiryMonths,
    loyalty_point_value_ghs: p.loyaltyPointValueGhs,
  };
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <label className="font-medium text-gray-900">{label}</label>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-12 h-6 rounded-full transition-colors duration-200 shrink-0 cursor-pointer ${checked ? 'bg-emerald-500' : 'bg-gray-300'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 ${checked ? 'translate-x-6' : 'translate-x-0'}`}
        />
      </button>
    </div>
  );
}

export default function AdminPromotionsPage() {
  const [form, setForm] = useState<PromoForm>(toForm(DEFAULT_PROMOTIONS));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('store_settings')
        .select('key, value')
        .in('key', [...PROMO_KEYS]);
      if (error) throw error;
      setForm(toForm(parsePromotions(data)));
    } catch (err) {
      console.error(err);
      toast.error('Failed to load promotion settings');
    } finally {
      setLoading(false);
    }
  };

  const update = <K extends keyof PromoForm>(key: K, value: PromoForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const updates = PROMO_KEYS.map((key) => ({
        key,
        value: form[key],
        updated_at: now,
      }));

      const { error } = await supabase.from('store_settings').upsert(updates, { onConflict: 'key' });
      if (error) throw error;

      try {
        sessionStorage.removeItem('hy_cms_settings');
      } catch {
        /* ignore */
      }
      toast.success('Promotion settings saved');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save settings';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleApplyBulkSale = async () => {
    const pct = form.storewide_sale_percent;
    if (pct <= 0 || pct > 100) {
      toast.error('Enter a sale percent between 1 and 100 first');
      return;
    }
    if (
      !window.confirm(
        `Apply ${pct}% off to ALL active products? This permanently changes product prices (compare-at + sale price).`
      )
    ) {
      return;
    }

    setBulkWorking(true);
    try {
      const { data: products, error } = await supabase
        .from('products')
        .select('id, price, compare_at_price')
        .eq('status', 'active')
        .gt('price', 0);

      if (error) throw error;
      if (!products?.length) {
        toast.success('No active products to update');
        return;
      }

      let updated = 0;
      for (const p of products) {
        const price = Number(p.price) || 0;
        const compareAt = p.compare_at_price == null ? null : Number(p.compare_at_price);
        if (price <= 0) continue;

        const needsCompare =
          compareAt == null || !Number.isFinite(compareAt) || compareAt <= price;
        const newCompare = needsCompare ? price : compareAt;
        const newPrice = Math.round(price * (1 - pct / 100) * 100) / 100;

        const { error: upErr } = await supabase
          .from('products')
          .update({
            compare_at_price: newCompare,
            price: newPrice,
            on_sale: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', p.id);

        if (!upErr) updated += 1;
      }

      toast.success(`Updated ${updated} product${updated === 1 ? '' : 's'}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Bulk apply failed';
      toast.error(message);
    } finally {
      setBulkWorking(false);
    }
  };

  const handleRestoreSalePrices = async () => {
    if (
      !window.confirm(
        'Restore original prices for all products marked on sale with a compare-at price?'
      )
    ) {
      return;
    }

    setBulkWorking(true);
    try {
      const { data: products, error } = await supabase
        .from('products')
        .select('id, price, compare_at_price')
        .eq('on_sale', true);

      if (error) throw error;

      const eligible = (products || []).filter((p) => {
        const price = Number(p.price) || 0;
        const compareAt = Number(p.compare_at_price) || 0;
        return compareAt > price;
      });

      if (!eligible.length) {
        toast.success('No sale products to restore');
        return;
      }

      let restored = 0;
      for (const p of eligible) {
        const compareAt = Number(p.compare_at_price);
        const { error: upErr } = await supabase
          .from('products')
          .update({
            price: compareAt,
            compare_at_price: null,
            on_sale: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', p.id);

        if (!upErr) restored += 1;
      }

      toast.success(`Restored ${restored} product${restored === 1 ? '' : 's'}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Restore failed';
      toast.error(message);
    } finally {
      setBulkWorking(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-500">
        <i className="ri-loader-4-line animate-spin text-2xl mr-2" />
        Loading promotions…
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Promotions & Rewards</h1>
        <p className="text-gray-600 mt-1 text-sm sm:text-base">
          Manage store-wide sales, delivery deals, and Sleek Points — all in one place.
        </p>
      </div>

      {/* Store-wide Sale */}
      <section className="bg-white rounded-xl border-2 border-gray-200 p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Store-wide Sale</h2>
          <p className="text-sm text-gray-500 mt-1">
            Temporary checkout discount applied to every product without editing prices individually.
          </p>
        </div>

        <div className="p-4 bg-gray-50 rounded-lg border border-gray-100 space-y-4">
          <Toggle
            label="Sale enabled"
            checked={form.storewide_sale_enabled}
            onChange={(v) => update('storewide_sale_enabled', v)}
          />
          <p className="text-sm text-gray-500">
            When enabled, every product gets this % off automatically — no need to edit products one by one.
            Toggle off to end the sale instantly.
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-1">Sale name (optional)</label>
          <input
            type="text"
            value={form.storewide_sale_name}
            onChange={(e) => update('storewide_sale_name', e.target.value)}
            placeholder='e.g. "Black Friday"'
            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-1">Discount percent</label>
          <div className="relative max-w-xs">
            <input
              type="number"
              min={0}
              max={100}
              value={form.storewide_sale_percent}
              onChange={(e) =>
                update(
                  'storewide_sale_percent',
                  Math.min(100, Math.max(0, Number(e.target.value) || 0))
                )
              }
              className="w-full pl-4 pr-10 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">%</span>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100 space-y-3">
          <p className="text-sm font-semibold text-gray-700">Bulk price tools</p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleApplyBulkSale}
              disabled={bulkWorking}
              className="px-4 py-2.5 border-2 border-amber-300 bg-amber-50 text-amber-900 rounded-lg font-semibold text-sm hover:bg-amber-100 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Apply {form.storewide_sale_percent}% to all active products
            </button>
            <button
              type="button"
              onClick={handleRestoreSalePrices}
              disabled={bulkWorking}
              className="px-4 py-2.5 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-50 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Restore all sale prices
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Bulk apply permanently changes product prices. Prefer the toggle above for temporary sales like Black Friday.
          </p>
        </div>
      </section>

      {/* Delivery Promotions */}
      <section className="bg-white rounded-xl border-2 border-gray-200 p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Delivery Promotions</h2>
          <p className="text-sm text-gray-500 mt-1">
            Store-wide delivery discounts on top of zone settings. These do not combine with coupons,
            Sleek Points, or store-wide sale % — customers choose one. Sale-priced products in the cart
            still qualify for delivery discounts.
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-1">
            Global delivery discount
          </label>
          <div className="relative max-w-xs">
            <input
              type="number"
              min={0}
              max={100}
              value={form.global_delivery_discount_percent}
              onChange={(e) =>
                update(
                  'global_delivery_discount_percent',
                  Math.min(100, Math.max(0, Number(e.target.value) || 0))
                )
              }
              className="w-full pl-4 pr-10 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">%</span>
          </div>
          <p className="text-sm text-gray-500 mt-2">
            Applies to ALL delivery locations on top of any zone-specific discounts.
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-1">
            Free delivery minimum items
          </label>
          <input
            type="number"
            min={0}
            value={form.free_delivery_min_items}
            onChange={(e) =>
              update('free_delivery_min_items', Math.max(0, Math.floor(Number(e.target.value) || 0)))
            }
            className="w-full max-w-xs px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          />
          <p className="text-sm text-gray-500 mt-2">
            When a customer&apos;s cart has at least this many items, delivery is free everywhere. Use 0 to turn off.
          </p>
        </div>
      </section>

      {/* Sleek Points */}
      <section className="bg-white rounded-xl border-2 border-gray-200 p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Sleek Points (Rewards)</h2>
          <p className="text-sm text-gray-500 mt-1">Loyalty program earning and redemption rules.</p>
        </div>

        <div className="p-4 bg-gray-50 rounded-lg border border-gray-100 space-y-2">
          <Toggle
            label="Program enabled"
            checked={form.loyalty_enabled}
            onChange={(v) => update('loyalty_enabled', v)}
          />
          <p className="text-sm text-gray-500">
            When off, customers stop earning new points and redemption is hidden at checkout.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-1">Points per item</label>
            <input
              type="number"
              min={0}
              value={form.loyalty_points_per_item}
              onChange={(e) =>
                update('loyalty_points_per_item', Math.max(0, Math.floor(Number(e.target.value) || 0)))
              }
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-1">Min points to redeem</label>
            <input
              type="number"
              min={0}
              value={form.loyalty_min_redeem}
              onChange={(e) =>
                update('loyalty_min_redeem', Math.max(0, Math.floor(Number(e.target.value) || 0)))
              }
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-1">Expiry (months)</label>
            <input
              type="number"
              min={1}
              value={form.loyalty_expiry_months}
              onChange={(e) =>
                update('loyalty_expiry_months', Math.max(1, Math.floor(Number(e.target.value) || 1)))
              }
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-1">Point value (GH₵)</label>
            <input
              type="number"
              min={0}
              step={0.1}
              value={form.loyalty_point_value_ghs}
              onChange={(e) =>
                update('loyalty_point_value_ghs', Math.max(0, Number(e.target.value) || 0))
              }
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
            <p className="text-sm text-gray-500 mt-2">
              1 point = GH₵ {form.loyalty_point_value_ghs} off at checkout
            </p>
          </div>
        </div>
      </section>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
        >
          {saving && <i className="ri-loader-4-line animate-spin" />}
          Save Changes
        </button>
      </div>
    </div>
  );
}
