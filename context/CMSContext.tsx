'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

interface SiteSettings {
    site_name: string;
    site_tagline: string;
    site_logo: string;
    contact_email: string;
    contact_phone: string;
    contact_address: string;
    whatsapp_number: string;
    social_facebook: string;
    social_instagram: string;
    social_tiktok: string;
    primary_color: string;
    secondary_color: string;
    currency: string;
    currency_symbol: string;
    [key: string]: string;
}

interface CMSContent {
    id: string;
    section: string;
    block_key: string;
    title: string | null;
    subtitle: string | null;
    content: string | null;
    image_url: string | null;
    button_text: string | null;
    button_url: string | null;
    metadata: Record<string, any>;
    is_active: boolean;
}

interface Banner {
    id: string;
    name: string;
    type: string;
    title: string | null;
    subtitle: string | null;
    image_url: string | null;
    background_color: string;
    text_color: string;
    button_text: string | null;
    button_url: string | null;
    is_active: boolean;
    position: string;
}

interface CMSContextType {
    settings: SiteSettings;
    content: CMSContent[];
    banners: Banner[];
    loading: boolean;
    getContent: (section: string, blockKey: string) => CMSContent | undefined;
    getSetting: (key: string) => string;
    getActiveBanners: (position?: string) => Banner[];
    refreshCMS: () => Promise<void>;
}

const defaultSettings: SiteSettings = {
    site_name: 'Hy_stepper',
    site_tagline: 'Stay sleek in style...',
    site_logo: '/brand/hy-stepper-logo.png?v=20260813b',
    contact_email: 'info@hystepper.com',
    contact_phone: '+233 XX XXX XXXX',
    contact_address: 'Accra, Ghana',
    whatsapp_number: '',
    social_facebook: '',
    social_instagram: '',
    social_tiktok: '',
    primary_color: '#059669',
    secondary_color: '#0D9488',
    currency: 'GHS',
    currency_symbol: 'GH₵',
};

const CMSContext = createContext<CMSContextType>({
    settings: defaultSettings,
    content: [],
    banners: [],
    loading: true,
    getContent: () => undefined,
    getSetting: () => '',
    getActiveBanners: () => [],
    refreshCMS: async () => { },
});

export function CMSProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<SiteSettings>({
        site_name: 'Hy_stepper',
        site_tagline: 'Stay sleek in style...',
        site_logo: '/brand/hy-stepper-logo.png?v=20260813b',
        contact_email: 'info@hystepper.com',
        contact_phone: '0276558163',
        contact_address: 'Accra, Ghana',
        whatsapp_number: '233276558163',
        social_facebook: 'https://facebook.com/hystepper',
        social_instagram: 'https://instagram.com/hystepper',
        social_tiktok: 'https://www.tiktok.com/@hystepper',
        primary_color: '#FBF6F2',
        secondary_color: '#A14F57',
        currency: 'GHS',
        currency_symbol: 'GH₵',
    });
    const [content, setContent] = useState<CMSContent[]>([]);
    const [banners, setBanners] = useState<Banner[]>([]);
    const [loading, setLoading] = useState(false);

    const CACHE_KEY = 'hy_cms_settings';
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    const fetchCMSData = async (force = false) => {
        if (!force) {
            try {
                const cached = sessionStorage.getItem(CACHE_KEY);
                if (cached) {
                    const { data: cachedData, ts } = JSON.parse(cached);
                    if (Date.now() - ts < CACHE_TTL) {
                        setSettings(cachedData);
                        return;
                    }
                }
            } catch {}
        }

        setLoading(true);
        try {
            const { data } = await supabase
                .from('store_settings')
                .select('key, value');

            if (data) {
                const newSettings: any = { ...defaultSettings };
                data.forEach((item: any) => {
                    const v = item.value;
                    if (v !== undefined && v !== null) newSettings[item.key] = v;
                });
                setSettings(newSettings);
                try {
                    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: newSettings, ts: Date.now() }));
                } catch {}
            }
        } catch (err) {
            console.error('Error loading CMS data:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCMSData();
    }, []);

    const getContent = (section: string, blockKey: string): CMSContent | undefined => {
        return content.find(c => c.section === section && c.block_key === blockKey);
    };

    const getSetting = (key: string): string => {
        const raw = settings[key] ?? defaultSettings[key];
        if (raw === undefined || raw === null) return '';
        if (typeof raw === 'string') return raw;
        if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
        try { return typeof raw === 'object' ? JSON.stringify(raw) : String(raw); } catch { return ''; }
    };

    const getActiveBanners = (position?: string): Banner[] => {
        const now = new Date();
        return banners.filter(b => {
            if (position && b.position !== position) return false;
            if (b.start_date && new Date(b.start_date) > now) return false;
            if (b.end_date && new Date(b.end_date) < now) return false;
            return b.is_active;
        });
    };

    return (
        <CMSContext.Provider
            value={{
                settings,
                content,
                banners,
                loading,
                getContent,
                getSetting,
                getActiveBanners,
                refreshCMS: () => fetchCMSData(true),
            }}
        >
            {children}
        </CMSContext.Provider>
    );
}

export function useCMS() {
    const context = useContext(CMSContext);
    if (!context) {
        throw new Error('useCMS must be used within a CMSProvider');
    }
    return context;
}

export default CMSContext;
