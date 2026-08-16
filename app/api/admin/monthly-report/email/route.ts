import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/require-staff';
import { sendEmail, emailLayout } from '@/lib/notifications';
import { findUserById } from '@/server/auth';

export async function POST(request: Request) {
  const staffAuth = await requireStaff(request, { permission: 'analytics' });
  if (staffAuth instanceof NextResponse) return staffAuth;

  try {
    const body = await request.json().catch(() => ({}));
    const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';

    if (!summary || !subject) {
      return NextResponse.json({ error: 'summary and subject are required' }, { status: 400 });
    }

    const user = await findUserById(staffAuth.userId);
    const to = String(user?.email || '').trim();
    if (!to) {
      return NextResponse.json({ error: 'No email on staff account' }, { status: 400 });
    }

    await sendEmail({
      to,
      subject,
      html: emailLayout(
        `<pre style="white-space:pre-wrap;font-family:monospace;font-size:13px;color:#374151;line-height:1.6;">${summary.replace(/</g, '&lt;')}</pre>`,
        subject
      ),
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Email failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
