'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const BRAND = '#ee1c77';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function clean(v: unknown, fallback: string): string {
  const s = String(v ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
  return s || fallback;
}

function TimeCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center min-w-[4.5rem] sm:min-w-[5.5rem]">
      <span
        className="text-4xl sm:text-5xl font-semibold tabular-nums tracking-tight text-neutral-900"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </span>
      <span className="mt-2 text-[10px] sm:text-xs font-medium uppercase tracking-[0.28em] text-neutral-400">
        {label}
      </span>
    </div>
  );
}

export default function MaintenancePage() {
  const [timeLeft, setTimeLeft] = useState<{ h: number; m: number; s: number } | null>(null);
  const [ended, setEnded] = useState(false);
  const [contactEmail, setContactEmail] = useState('info@hystepper.com');
  const [whatsappUrl, setWhatsappUrl] = useState('https://wa.me/233276558163');
  const [phoneTel, setPhoneTel] = useState('tel:+233276558163');

  useEffect(() => {
    async function loadContact() {
      try {
        const { data } = await supabase
          .from('store_settings')
          .select('key, value')
          .in('key', ['contact_email', 'contact_phone', 'whatsapp_number']);
        if (!data) return;
        const map = Object.fromEntries(data.map((r) => [r.key, r.value]));
        const email = clean(map.contact_email, 'info@hystepper.com');
        const phone = clean(map.contact_phone, '0276558163');
        const wa = clean(map.whatsapp_number, phone).replace(/\D/g, '');
        setContactEmail(email);
        if (wa) setWhatsappUrl(`https://wa.me/${wa}`);
        setPhoneTel(`tel:${phone.replace(/\s/g, '')}`);
      } catch {
        /* keep defaults */
      }
    }
    void loadContact();
  }, []);

  useEffect(() => {
    let endTime = 0;
    let id: ReturnType<typeof setInterval>;
    let mounted = true;

    (async () => {
      try {
        const res = await fetch('/api/maintenance-status');
        const { countdownMinutes } = await res.json();
        endTime = Date.now() + (countdownMinutes || 30) * 60 * 1000;
      } catch {
        endTime = Date.now() + 30 * 60 * 1000;
      }

      const tick = () => {
        if (!mounted) return;
        const diff = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
        if (diff === 0) {
          setEnded(true);
          return;
        }
        setTimeLeft({
          h: Math.floor(diff / 3600),
          m: Math.floor((diff % 3600) / 60),
          s: diff % 60,
        });
      };

      tick();
      id = setInterval(tick, 1000);
    })();

    return () => {
      mounted = false;
      clearInterval(id!);
    };
  }, []);

  return (
    <div
      className="relative min-h-screen overflow-hidden text-neutral-900"
      style={{
        fontFamily: 'Outfit, system-ui, sans-serif',
        background:
          'radial-gradient(1200px 600px at 50% -10%, rgba(238,28,119,0.16), transparent 55%), linear-gradient(180deg, #fff7fa 0%, #ffffff 42%, #f6f3f4 100%)',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes hs-breathe {
          0%, 100% { transform: scale(1); opacity: 0.55; }
          50% { transform: scale(1.08); opacity: 0.85; }
        }
        @keyframes hs-rise {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes hs-tick {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        .hs-breathe { animation: hs-breathe 5.5s ease-in-out infinite; }
        .hs-rise { animation: hs-rise 0.85s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .hs-d1 { animation-delay: 0.08s; }
        .hs-d2 { animation-delay: 0.18s; }
        .hs-d3 { animation-delay: 0.28s; }
        .hs-d4 { animation-delay: 0.4s; }
        .hs-colon { animation: hs-tick 1s steps(1, end) infinite; }
      `}} />

      {/* Soft diagonal sheen */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(-18deg, #111 0 1px, transparent 1px 14px)',
        }}
      />

      {/* Brand orb behind mark — echoes the logo circle */}
      <div
        aria-hidden
        className="hs-breathe pointer-events-none absolute left-1/2 top-[18%] h-56 w-56 -translate-x-1/2 rounded-full sm:h-72 sm:w-72"
        style={{
          background: `radial-gradient(circle, ${BRAND} 0%, rgba(238,28,119,0.35) 38%, transparent 70%)`,
          filter: 'blur(2px)',
        }}
      />

      <main className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
        <div className="hs-rise relative mb-8">
          <p className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-gray-900">
            Hy-Stepper
          </p>
          <p
            className="mt-2 text-xs font-medium italic tracking-wide sm:text-sm"
            style={{ color: BRAND }}
          >
            Stay sleek in style…
          </p>
        </div>

        <h1 className="hs-rise hs-d1 text-[2.35rem] leading-tight font-semibold tracking-tight text-neutral-900 sm:text-5xl">
          We&apos;ll be right back
        </h1>
        <p className="hs-rise hs-d2 mt-4 max-w-md text-base leading-relaxed text-neutral-600 sm:text-lg">
          The boutique is closed for a quick polish. Your cart stays safe — we&apos;ll reopen shortly.
        </p>

        <div className="hs-rise hs-d3 mt-12 w-full">
          <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.32em] text-neutral-400">
            Estimated time remaining
          </p>

          {timeLeft !== null && !ended ? (
            <div className="flex items-start justify-center gap-2 sm:gap-4">
              <TimeCell value={pad(timeLeft.h)} label="Hours" />
              <span
                className="hs-colon mt-1 text-3xl font-light sm:text-4xl"
                style={{ color: BRAND }}
                aria-hidden
              >
                :
              </span>
              <TimeCell value={pad(timeLeft.m)} label="Mins" />
              <span
                className="hs-colon mt-1 text-3xl font-light sm:text-4xl"
                style={{ color: BRAND }}
                aria-hidden
              >
                :
              </span>
              <TimeCell value={pad(timeLeft.s)} label="Secs" />
            </div>
          ) : ended ? (
            <p className="text-neutral-600">
              Almost there —{' '}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="font-semibold underline underline-offset-4"
                style={{ color: BRAND }}
              >
                refresh the page
              </button>
            </p>
          ) : (
            <p className="text-neutral-500">Preparing countdown…</p>
          )}

          <div
            className="mx-auto mt-8 h-px w-24"
            style={{ background: `linear-gradient(90deg, transparent, ${BRAND}, transparent)` }}
          />
        </div>

        <div className="hs-rise hs-d4 mt-12 w-full">
          <p className="mb-5 text-sm text-neutral-500">Need help right now?</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
              style={{ backgroundColor: BRAND }}
            >
              <i className="ri-whatsapp-line text-lg" />
              WhatsApp
            </a>
            <a
              href={`mailto:${contactEmail}`}
              className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/80 px-5 py-3 text-sm font-medium text-neutral-800 backdrop-blur transition-colors hover:border-neutral-300"
            >
              <i className="ri-mail-line" />
              Email
            </a>
            <a
              href={phoneTel}
              className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/80 px-5 py-3 text-sm font-medium text-neutral-800 backdrop-blur transition-colors hover:border-neutral-300"
            >
              <i className="ri-phone-line" />
              Call
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
