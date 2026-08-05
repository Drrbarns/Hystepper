import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
}

/**
 * "Remember me" support. The login page calls setRememberMe() BEFORE
 * signInWithPassword. When remember is off, the session is kept in
 * sessionStorage (cleared when the browser closes); when on (default),
 * it lives in localStorage like a normal persistent session.
 */
const REMEMBER_KEY = 'hs-remember-me';

export function setRememberMe(remember: boolean) {
    try {
        localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
    } catch { /* storage unavailable (private mode) — persistent by default */ }
}

function rememberPreferred(): boolean {
    try {
        return localStorage.getItem(REMEMBER_KEY) !== '0';
    } catch {
        return true;
    }
}

const isBrowser = typeof window !== 'undefined';

// Reads check BOTH stores so an existing session survives a preference flip;
// writes go to whichever store matches the current preference.
const dualStorage = {
    getItem(key: string): string | null {
        if (!isBrowser) return null;
        try {
            return sessionStorage.getItem(key) ?? localStorage.getItem(key);
        } catch {
            return null;
        }
    },
    setItem(key: string, value: string) {
        if (!isBrowser) return;
        try {
            if (rememberPreferred()) {
                localStorage.setItem(key, value);
                sessionStorage.removeItem(key);
            } else {
                sessionStorage.setItem(key, value);
                localStorage.removeItem(key);
            }
        } catch { /* ignore quota/private-mode errors */ }
    },
    removeItem(key: string) {
        if (!isBrowser) return;
        try {
            sessionStorage.removeItem(key);
            localStorage.removeItem(key);
        } catch { /* ignore */ }
    },
};

export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        storage: dualStorage,
        // Bypass the Navigator LockManager. On mobile Safari, backgrounding the
        // tab can suspend a token refresh while it still holds the browser lock;
        // on return every Supabase call waits on that lock forever and the whole
        // site appears frozen. An immediate-execution lock avoids the deadlock —
        // auth-js tolerates concurrent refreshes via its reuse window.
        lock: async (_name, _acquireTimeout, fn) => await fn(),
    },
});

/** Wipe every supabase-js auth key from both storages (remember-me dual store). */
export function clearAuthStorage() {
    if (!isBrowser) return;
    const purge = (store: Storage) => {
        const keys: string[] = [];
        for (let i = 0; i < store.length; i++) {
            const k = store.key(i);
            if (!k) continue;
            // supabase-js keys look like sb-<ref>-auth-token (+ code-verifier, etc.)
            if (k.startsWith('sb-') || k.includes('auth-token') || k.endsWith('-code-verifier')) {
                keys.push(k);
            }
        }
        keys.forEach((k) => {
            try {
                store.removeItem(k);
            } catch { /* ignore */ }
        });
    };
    try {
        purge(localStorage);
        purge(sessionStorage);
    } catch { /* ignore */ }
}

/**
 * Reliable sign-out for the custom auth proxy. Remote /logout failures must
 * never leave the customer stuck signed in — always clear local session and
 * hard-navigate so in-memory auth state is gone too.
 */
export async function signOutFully(redirectTo = '/auth/login') {
    try {
        // Prefer local scope; still attempts server revoke but we ignore failures.
        // Cap wait so a hung /logout never leaves the button stuck.
        await Promise.race([
            supabase.auth.signOut({ scope: 'local' }),
            new Promise<void>((resolve) => setTimeout(resolve, 2500)),
        ]);
    } catch (err) {
        console.error('[auth] signOut error (continuing with local clear):', err);
    } finally {
        clearAuthStorage();
        if (isBrowser) {
            window.location.assign(redirectTo);
        }
    }
}
