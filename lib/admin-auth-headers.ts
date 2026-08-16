import { supabase } from '@/lib/supabase';

/** Bearer + JSON headers for admin API routes gated by requireStaff. */
export async function adminAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  return headers;
}
