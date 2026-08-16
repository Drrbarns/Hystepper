'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useCMS } from '@/context/CMSContext';
import { supabase } from '@/lib/supabase';

declare global {
    interface Window {
        dataLayer: any[];
        gtag: (...args: any[]) => void;
        fbq: any;
        _fbq: any;
    }
}

// Injects Google Analytics 4 + Meta Pixel when the conversion-tracking module
// is enabled AND IDs exist in Admin → Settings → Tracking.
export default function TrackingScripts() {
    const { getSetting } = useCMS();
    const pathname = usePathname();
    const [conversionEnabled, setConversionEnabled] = useState(false);

    const ga4Id = (getSetting('ga4_measurement_id') || '').trim();
    const pixelId = (getSetting('meta_pixel_id') || '').trim();

    const ga4Loaded = useRef(false);
    const pixelLoaded = useRef(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { data } = await supabase
                    .from('store_modules')
                    .select('enabled')
                    .eq('id', 'conversion-tracking')
                    .maybeSingle();
                if (!cancelled) setConversionEnabled(!!data?.enabled);
            } catch {
                if (!cancelled) setConversionEnabled(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const trackingActive = conversionEnabled && (!!ga4Id || !!pixelId);

    useEffect(() => {
        if (!trackingActive || !ga4Id || ga4Loaded.current) return;
        ga4Loaded.current = true;

        window.dataLayer = window.dataLayer || [];
        window.gtag = function gtag() {
            window.dataLayer.push(arguments);
        };
        window.gtag('js', new Date());
        window.gtag('config', ga4Id, { send_page_view: true });

        const script = document.createElement('script');
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`;
        document.head.appendChild(script);
    }, [ga4Id, trackingActive]);

    useEffect(() => {
        if (!trackingActive || !pixelId || pixelLoaded.current) return;
        pixelLoaded.current = true;

        /* eslint-disable */
        (function (f: any, b: any, e: any, v: any, n?: any, t?: any, s?: any) {
            if (f.fbq) return;
            n = f.fbq = function () {
                n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
            };
            if (!f._fbq) f._fbq = n;
            n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
            t = b.createElement(e); t.async = true; t.src = v;
            s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
        })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
        /* eslint-enable */

        window.fbq('init', pixelId);
        window.fbq('track', 'PageView');
    }, [pixelId, trackingActive]);

    useEffect(() => {
        if (!trackingActive) return;
        if (ga4Id && typeof window.gtag === 'function') {
            window.gtag('event', 'page_view', { page_path: pathname });
        }
        if (pixelId && typeof window.fbq === 'function') {
            window.fbq('track', 'PageView');
        }
    }, [pathname, ga4Id, pixelId, trackingActive]);

    return null;
}

export function trackPurchase(order: {
    orderNumber: string;
    total: number;
    currency?: string;
    items?: { name: string; quantity: number; price: number }[];
}) {
    try {
        if (typeof window === 'undefined') return;
        const currency = order.currency || 'GHS';
        if (typeof window.gtag === 'function') {
            window.gtag('event', 'purchase', {
                transaction_id: order.orderNumber,
                value: order.total,
                currency,
                items: (order.items || []).map(it => ({
                    item_name: it.name,
                    quantity: it.quantity,
                    price: it.price,
                })),
            });
        }
        if (typeof window.fbq === 'function') {
            window.fbq('track', 'Purchase', { value: order.total, currency });
        }
    } catch {
        // Tracking must never break the storefront.
    }
}
