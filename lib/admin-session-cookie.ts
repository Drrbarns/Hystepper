/** Client helpers for maintenance-mode storefront preview. */

export function setAdminSessionCookie() {
  if (typeof document === 'undefined') return;
  // Exact original shape (a month ago): path=/, SameSite=Lax, no Secure flag.
  // Middleware reads this to let logged-in admins browse while maintenance is on.
  document.cookie = 'admin_session=1; path=/; max-age=86400; SameSite=Lax';
}

export function clearAdminSessionCookie() {
  if (typeof document === 'undefined') return;
  // Clear both Secure and non-Secure variants (browsers require matching flags).
  document.cookie = 'admin_session=; path=/; max-age=0; SameSite=Lax';
  document.cookie = 'admin_session=; path=/; max-age=0; SameSite=Lax; Secure';
}

/** Ask the server to set an HttpOnly preview cookie after verifying staff JWT. */
export async function syncAdminPreviewCookie(accessToken: string | undefined | null) {
  if (!accessToken) return;
  try {
    await fetch('/api/admin/preview-session', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
    });
  } catch {
    /* non-blocking */
  }
}

export async function clearAdminPreviewCookie() {
  try {
    await fetch('/api/admin/preview-session', {
      method: 'DELETE',
      credentials: 'same-origin',
    });
  } catch {
    /* non-blocking */
  }
  clearAdminSessionCookie();
}
