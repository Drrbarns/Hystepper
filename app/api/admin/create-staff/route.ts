import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireStaff } from '@/lib/require-staff';
import {
  createUser,
  findUserByEmail,
  updateUserMetadata,
  updateUserPassword,
} from '@/server/auth';
import { query } from '@/server/db/pool';

export async function POST(request: Request) {
  try {
    const auth = await requireStaff(request, { superAdminOnly: true });
    if (auth instanceof NextResponse) return auth;

    const { email, full_name, role, permissions, password } = await request.json();

    if (!email || !password || !full_name) {
      return NextResponse.json({ error: 'Email, name and password are required.' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
    }

    if (role === 'admin' && !auth.isSuperAdmin) {
      return NextResponse.json({ error: 'Only super-admins may create admin staff.' }, { status: 403 });
    }

    const cleanEmail = email.trim().toLowerCase();
    let userId: string | undefined;
    let createdFreshUser = false;

    const existing = await findUserByEmail(cleanEmail);
    if (existing) {
      const { data: existingStaff } = await supabaseAdmin
        .from('staff')
        .select('id')
        .eq('user_id', existing.id)
        .maybeSingle();

      if (existingStaff) {
        return NextResponse.json({ error: 'A staff member with that email already exists.' }, { status: 409 });
      }

      await updateUserPassword(existing.id, password);
      await updateUserMetadata(existing.id, { full_name });
      userId = existing.id;
      createdFreshUser = false;
    } else {
      const user = await createUser({
        email: cleanEmail,
        password,
        user_metadata: { full_name },
        email_confirm: true,
      });
      userId = user.id;
      createdFreshUser = true;
    }

    const { error: staffError } = await supabaseAdmin.from('staff').insert({
      user_id: userId,
      email: cleanEmail,
      full_name: full_name.trim(),
      role,
      permissions,
    });

    if (staffError) {
      if (userId && createdFreshUser) {
        await query(`DELETE FROM public.profiles WHERE id = $1`, [userId]);
        await query(`DELETE FROM auth.users WHERE id = $1`, [userId]);
      }
      if ((staffError.message || '').includes('unique')) {
        return NextResponse.json({ error: 'A staff member with that email already exists.' }, { status: 409 });
      }
      return NextResponse.json({ error: staffError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
