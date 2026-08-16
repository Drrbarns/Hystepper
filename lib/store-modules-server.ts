import { supabaseAdmin } from '@/lib/supabase-admin';
import { isModuleEnabled } from '@/lib/store-modules';

let enabledCache: { ids: string[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

export async function fetchEnabledModuleIdsServer(): Promise<string[]> {
  const now = Date.now();
  if (enabledCache && now - enabledCache.fetchedAt < CACHE_TTL_MS) {
    return enabledCache.ids;
  }

  const { data, error } = await supabaseAdmin.from('store_modules').select('id, enabled');
  if (error) {
    console.warn('[store-modules] fetch failed:', error.message);
    return enabledCache?.ids || [];
  }

  const ids = (data || []).filter((m: { enabled?: boolean }) => m.enabled).map((m: { id: string }) => m.id);
  enabledCache = { ids, fetchedAt: now };
  return ids;
}

export async function isModuleEnabledServer(moduleId: string): Promise<boolean> {
  const ids = await fetchEnabledModuleIdsServer();
  return isModuleEnabled(ids, moduleId);
}

/** Bust in-process cache after admin toggles a module (same Node process). */
export function invalidateModuleCache(): void {
  enabledCache = null;
}
