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

/** Set by TrackingScripts when conversion-tracking module is enabled. */
let conversionTrackingModuleEnabled = false;

export function setConversionTrackingModuleEnabled(enabled: boolean) {
    conversionTrackingModuleEnabled = enabled;
}

function canFireConversionEvents(): boolean {
    if (typeof window === 'undefined') return false;
    // Scripts only load when conversion-tracking module is enabled + IDs exist.
    return typeof window.gtag === 'function' || typeof window.fbq === 'function';
}

export function trackAddToCart(payload: {
    id: string;
    name: string;
    price: number;
    quantity: number;
}) {
    try {
        if (!canFireConversionEvents()) return;
        const value = payload.price * payload.quantity;
        if (typeof window.gtag === 'function') {
            window.gtag('event', 'add_to_cart', {
                currency: 'GHS',
                value,
                items: [{
                    item_id: payload.id,
                    item_name: payload.name,
                    price: payload.price,
                    quantity: payload.quantity,
                }],
            });
        }
        if (typeof window.fbq === 'function') {
            window.fbq('track', 'AddToCart', {
                content_ids: [payload.id],
                content_name: payload.name,
                content_type: 'product',
                value,
                currency: 'GHS',
            });
        }
    } catch {
        // Tracking must never break the storefront.
    }
}

export function trackBeginCheckout(payload: {
    value: number;
    items: Array<{ id: string; name: string; price: number; quantity: number }>;
}) {
    try {
        if (!canFireConversionEvents()) return;
        if (typeof window.gtag === 'function') {
            window.gtag('event', 'begin_checkout', {
                currency: 'GHS',
                value: payload.value,
                items: payload.items.map((it) => ({
                    item_id: it.id,
                    item_name: it.name,
                    price: it.price,
                    quantity: it.quantity,
                })),
            });
        }
        if (typeof window.fbq === 'function') {
            window.fbq('track', 'InitiateCheckout', {
                value: payload.value,
                currency: 'GHS',
                contents: payload.items.map((it) => ({
                    id: it.id,
                    quantity: it.quantity,
                })),
                content_type: 'product',
                num_items: payload.items.reduce((sum, it) => sum + it.quantity, 0),
            });
        }
    } catch {
        // Tracking must never break the storefront.
    }
}

export function trackViewContent(payload: { id: string; name: string; price: number }) {
    try {
        if (!canFireConversionEvents()) return;
        if (typeof window.gtag === 'function') {
            window.gtag('event', 'view_item', {
                currency: 'GHS',
                value: payload.price,
                items: [{
                    item_id: payload.id,
                    item_name: payload.name,
                    price: payload.price,
                }],
            });
        }
        if (typeof window.fbq === 'function') {
            window.fbq('track', 'ViewContent', {
                content_ids: [payload.id],
                content_name: payload.name,
                content_type: 'product',
                value: payload.price,
                currency: 'GHS',
            });
        }
    } catch {
        // Tracking must never break the storefront.
    }
}

export function trackPurchase(order: {
    orderNumber: string;
    total: number;
    currency?: string;
    items?: { name: string; quantity: number; price: number }[];
}) {
    try {
        if (typeof window === 'undefined') return;
        if (!conversionTrackingModuleEnabled) return;
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
                if (!cancelled) {
                    const enabled = !!data?.enabled;
                    setConversionEnabled(enabled);
                    setConversionTrackingModuleEnabled(enabled);
                }
            } catch {
                if (!cancelled) {
                    setConversionEnabled(false);
                    setConversionTrackingModuleEnabled(false);
                }
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
