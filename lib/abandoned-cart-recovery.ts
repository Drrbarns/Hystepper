import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendPaymentLink } from '@/lib/notifications';
import { isModuleEnabledServer } from '@/lib/store-modules-server';

type StoreSettingRow = { key: string; value: unknown };

function parseSettingBool(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const v = value.trim().replace(/^"+|"+$/g, '').toLowerCase();
    return v === 'true' || v === '1';
  }
  return false;
}

function parseSettingNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(/^"+|"+$/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

async function loadAbandonedCartSettings(): Promise<{
  enabled: boolean;
  delayHours: number;
  lastRun: string | null;
}> {
  const { data } = await supabaseAdmin
    .from('store_settings')
    .select('key, value')
    .in('key', ['abandoned_cart_enabled', 'abandoned_cart_delay_hours', 'abandoned_cart_last_run']);

  const map = new Map<string, unknown>();
  (data as StoreSettingRow[] | null)?.forEach((row) => map.set(row.key, row.value));

  const moduleOn = await isModuleEnabledServer('abandoned-cart');
  const settingOn = parseSettingBool(map.get('abandoned_cart_enabled'));

  return {
    enabled: moduleOn && settingOn,
    delayHours: Math.max(1, parseSettingNumber(map.get('abandoned_cart_delay_hours'), 2)),
    lastRun: typeof map.get('abandoned_cart_last_run') === 'string'
      ? String(map.get('abandoned_cart_last_run'))
      : null,
  };
}

function isConfirmedOrder(order: {
  payment_status?: string | null;
  metadata?: Record<string, unknown> | null;
}): boolean {
  if (order.payment_status === 'paid') return true;
  return order.metadata?.pos_sale === true;
}

export type AbandonedCartRunResult = {
  skipped?: boolean;
  reason?: string;
  scanned: number;
  emailed: number;
  errors: number;
  delayHours: number;
};

export async function runAbandonedCartRecovery(): Promise<AbandonedCartRunResult> {
  const settings = await loadAbandonedCartSettings();

  if (!await isModuleEnabledServer('abandoned-cart')) {
    return { skipped: true, reason: 'abandoned-cart module disabled', scanned: 0, emailed: 0, errors: 0, delayHours: settings.delayHours };
  }

  if (!settings.enabled) {
    return { skipped: true, reason: 'abandoned_cart_enabled setting is off', scanned: 0, emailed: 0, errors: 0, delayHours: settings.delayHours };
  }

  const cutoff = new Date(Date.now() - settings.delayHours * 60 * 60 * 1000).toISOString();

  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, email, phone, total, metadata, payment_status, created_at, shipping_address')
    .neq('payment_status', 'paid')
    .lte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    throw new Error(error.message || 'Failed to load orders');
  }

  let scanned = 0;
  let emailed = 0;
  let errors = 0;

  for (const order of orders || []) {
    if (isConfirmedOrder(order)) continue;
    if (!order.email || order.email === 'pos@store.local') continue;

    const meta = (order.metadata || {}) as Record<string, unknown>;
    if (meta.abandoned_cart_emailed_at) continue;

    scanned += 1;

    try {
      await sendPaymentLink(order);
      const nextMeta = {
        ...meta,
        abandoned_cart_emailed_at: new Date().toISOString(),
      };
      await supabaseAdmin
        .from('orders')
        .update({ metadata: nextMeta })
        .eq('id', order.id);
      emailed += 1;
    } catch (err) {
      console.error('[AbandonedCart] send failed for', order.id, err);
      errors += 1;
    }
  }

  await supabaseAdmin.from('store_settings').upsert(
    {
      key: 'abandoned_cart_last_run',
      value: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );

  return { scanned, emailed, errors, delayHours: settings.delayHours };
}

export async function getAbandonedCartAdminData() {
  const settings = await loadAbandonedCartSettings();
  const moduleOn = await isModuleEnabledServer('abandoned-cart');

  const { data: orders } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, email, phone, total, status, payment_status, created_at, metadata')
    .order('created_at', { ascending: false })
    .limit(500);

  const abandoned = (orders || []).filter((o: {
    payment_status?: string | null;
    metadata?: Record<string, unknown> | null;
  }) => !isConfirmedOrder(o));

  return {
    moduleEnabled: moduleOn,
    settings,
    orders: abandoned,
  };
}

export async function upsertAbandonedCartSettings(payload: {
  enabled?: boolean;
  delayHours?: number;
}) {
  const rows: Array<{ key: string; value: unknown; updated_at: string }> = [];
  const now = new Date().toISOString();

  if (typeof payload.enabled === 'boolean') {
    rows.push({ key: 'abandoned_cart_enabled', value: payload.enabled, updated_at: now });
  }
  if (typeof payload.delayHours === 'number' && Number.isFinite(payload.delayHours)) {
    rows.push({
      key: 'abandoned_cart_delay_hours',
      value: Math.max(1, Math.round(payload.delayHours)),
      updated_at: now,
    });
  }

  if (rows.length === 0) return;

  for (const row of rows) {
    await supabaseAdmin.from('store_settings').upsert(row, { onConflict: 'key' });
  }
}
