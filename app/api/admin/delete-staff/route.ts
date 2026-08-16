import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireStaff } from '@/lib/require-staff';
import { query } from '@/server/db/pool';

/**
 * Fully removes a staff member (staff row + auth.users + profile).
 */
export async function POST(request: Request) {
  try {
    const auth = await requireStaff(request, { superAdminOnly: true });
    if (auth instanceof NextResponse) return auth;

    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Staff id is required.' }, { status: 400 });
    }

    const { data: staffRow, error: lookupError } = await supabaseAdmin
      .from('staff')
      .select('id, user_id, email')
      .eq('id', id)
      .maybeSingle();

    if (lookupError) {
      return NextResponse.json({ error: lookupError.message }, { status: 400 });
    }

    if (!staffRow) {
      return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 });
    }

    const { error: deleteStaffError } = await supabaseAdmin
      .from('staff')
      .delete()
      .eq('id', id);

    if (deleteStaffError) {
      return NextResponse.json({ error: deleteStaffError.message }, { status: 400 });
    }

    if (staffRow.user_id) {
      await query(`DELETE FROM public.profiles WHERE id = $1`, [staffRow.user_id]);
      await query(`DELETE FROM auth.users WHERE id = $1`, [staffRow.user_id]);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
