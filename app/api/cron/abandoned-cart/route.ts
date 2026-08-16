import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/require-staff';
import { runAbandonedCartRecovery } from '@/lib/abandoned-cart-recovery';

function isAuthorizedCron(request: Request): boolean {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  const header = request.headers.get('authorization') || '';
  const bearer = header.replace(/^Bearer\s+/i, '').trim();
  const cronHeader = request.headers.get('x-cron-secret') || '';
  return bearer === secret || cronHeader === secret;
}

export async function POST(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runAbandonedCartRecovery();
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Recovery failed';
    console.error('[AbandonedCart Cron]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const staffAuth = await requireStaff(request, { permission: 'orders' });
  if (staffAuth instanceof NextResponse) return staffAuth;

  try {
    const result = await runAbandonedCartRecovery();
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Recovery failed';
    console.error('[AbandonedCart Manual]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
