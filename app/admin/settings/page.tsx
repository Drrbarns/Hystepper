'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface StoreSetting {
    key: string;
    value: any;
    description: string;
}

interface DeliveryZone {
    id: string;
    name: string;
    base_fee: number;
    is_accra: boolean;
    is_active: boolean;
}

interface HeroSlide {
    id: string;
    image: string;
    title: string;
    subtitle: string;
    button_text: string;
    button_link: string;
}

interface AnnouncementBanner {
    id: string;
    name: string;
    title: string;
    subtitle: string;
    background_color: string;
    text_color: string;
    button_text: string;
    button_url: string;
    is_active: boolean;
    sort_order: number;
}

const DEFAULT_HERO_SLIDE: Omit<HeroSlide, 'id'> = {
    image: '/hero-new.jpeg',
    title: 'Stay Sleek in Style',
    subtitle: 'Elevate your look with our exclusive collection of footwear and bags — made for the modern woman.',
    button_text: 'Shop Now',
    button_link: '/categories',
};

function makeSlideId() {
    return `slide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState('general');
    const [settings, setSettings] = useState<Record<string, any>>({});
    const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Delivery Zone Edit State
    const [editingZone, setEditingZone] = useState<DeliveryZone | null>(null);
    const [isZoneModalOpen, setIsZoneModalOpen] = useState(false);

    // Hero slides state
    const [heroSlides, setHeroSlides] = useState<HeroSlide[]>([]);
    const [uploadingSlideId, setUploadingSlideId] = useState<string | null>(null);

    // Announcement banners state (top bar)
    const [announcements, setAnnouncements] = useState<AnnouncementBanner[]>([]);
    const [editingAnnouncement, setEditingAnnouncement] = useState<AnnouncementBanner | null>(null);

    useEffect(() => {
        fetchData();
    }, []);

    async function fetchData() {
        setLoading(true);
        try {
            // Fetch Settings
            const { data: settingsData, error: settingsError } = await supabase
                .from('store_settings')
                .select('*');

            if (settingsError) throw settingsError;

            // Transform array to object for easier access
            const settingsMap: Record<string, any> = {};
            settingsData?.forEach((s: StoreSetting) => {
                settingsMap[s.key] = s.value;
            });
            setSettings(settingsMap);

            // Hydrate hero slides (stored as JSON array under hero_slides).
            // Supports legacy rows where value was double-encoded as a string.
            const rawSlides = settingsMap.hero_slides;
            let parsed: HeroSlide[] = [];
            if (Array.isArray(rawSlides)) {
                parsed = rawSlides;
            } else if (typeof rawSlides === 'string') {
                try {
                    const maybe = JSON.parse(rawSlides);
                    if (Array.isArray(maybe)) parsed = maybe;
                } catch { /* ignore */ }
            }
            setHeroSlides(
                parsed.map((s, i) => ({
                    id: s.id || `slide-${i}`,
                    image: s.image || '',
                    title: s.title || '',
                    subtitle: s.subtitle || '',
                    button_text: s.button_text || '',
                    button_link: s.button_link || '',
                }))
            );

            // Fetch Delivery Zones
            const { data: zonesData, error: zonesError } = await supabase
                .from('delivery_zones')
                .select('*')
                .order('base_fee', { ascending: true });

            if (zonesError) throw zonesError;
            setDeliveryZones(zonesData || []);

            // Fetch top announcement banners
            const { data: bannersData } = await supabase
                .from('banners')
                .select('id, name, title, subtitle, background_color, text_color, button_text, button_url, is_active, sort_order')
                .eq('position', 'top')
                .order('sort_order', { ascending: true });
            setAnnouncements((bannersData || []).map((b: any) => ({
                id: b.id,
                name: b.name || '',
                title: b.title || '',
                subtitle: b.subtitle || '',
                background_color: b.background_color || '#111827',
                text_color: b.text_color || '#ffffff',
                button_text: b.button_text || '',
                button_url: b.button_url || '',
                is_active: !!b.is_active,
                sort_order: b.sort_order || 0,
            })));

        } catch (err: any) {
            console.error('Error fetching settings:', err);
            toast.error('Failed to load settings');
        } finally {
            setLoading(false);
        }
    }

    async function handleSaveSettings(e: React.FormEvent) {
        e.preventDefault();
        setSaving(true);

        try {
            // Prepare updates
            const updates = Object.entries(settings).map(([key, value]) => ({
                key,
                value,
                updated_at: new Date().toISOString()
            }));

            const { error } = await supabase
                .from('store_settings')
                .upsert(updates);

            if (error) throw error;
            toast.success('Settings saved successfully');
            // Bust the storefront settings cache so changes show right away.
            try { sessionStorage.removeItem('hy_cms_settings'); } catch { /* ignore */ }
        } catch (err: any) {
            console.error('Error saving settings:', err);
            toast.error('Failed to save settings');
        } finally {
            setSaving(false);
        }
    }

    const updateSetting = (key: string, value: any) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    // ---------------------------------------------------------------
    // Hero Slides handlers
    // ---------------------------------------------------------------
    const addHeroSlide = () => {
        setHeroSlides(prev => [
            ...prev,
            { id: makeSlideId(), ...DEFAULT_HERO_SLIDE },
        ]);
    };

    const updateHeroSlide = (id: string, patch: Partial<HeroSlide>) => {
        setHeroSlides(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));
    };

    const removeHeroSlide = (id: string) => {
        if (!confirm('Remove this slide?')) return;
        setHeroSlides(prev => prev.filter(s => s.id !== id));
    };

    const moveHeroSlide = (id: string, direction: 'up' | 'down') => {
        setHeroSlides(prev => {
            const idx = prev.findIndex(s => s.id === id);
            if (idx === -1) return prev;
            const target = direction === 'up' ? idx - 1 : idx + 1;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            [next[idx], next[target]] = [next[target], next[idx]];
            return next;
        });
    };

    const handleUploadSlideImage = async (slideId: string, file: File) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast.error('Please select an image file');
            return;
        }
        const maxMb = 5;
        if (file.size > maxMb * 1024 * 1024) {
            toast.error(`Image must be smaller than ${maxMb}MB`);
            return;
        }

        setUploadingSlideId(slideId);
        try {
            const ext = file.name.split('.').pop() || 'jpg';
            const filePath = `hero/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

            const { error: uploadError } = await supabase.storage
                .from('products')
                .upload(filePath, file, { upsert: true });

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('products')
                .getPublicUrl(filePath);

            updateHeroSlide(slideId, { image: publicUrl });
            toast.success('Image uploaded');
        } catch (err: any) {
            console.error('Error uploading slide image:', err);
            toast.error(err?.message || 'Upload failed');
        } finally {
            setUploadingSlideId(null);
        }
    };

    const handleSaveHero = async () => {
        setSaving(true);
        try {
            const cleaned = heroSlides
                .map(s => ({
                    id: s.id,
                    image: (s.image || '').trim(),
                    title: (s.title || '').trim(),
                    subtitle: (s.subtitle || '').trim(),
                    button_text: (s.button_text || '').trim(),
                    button_link: (s.button_link || '').trim(),
                }))
                .filter(s => s.image || s.title || s.subtitle);

            const autoplay = Number(settings.hero_autoplay_seconds);
            const safeAutoplay = Number.isFinite(autoplay) && autoplay >= 2 && autoplay <= 30 ? autoplay : 6;

            const payload = [
                {
                    key: 'hero_slides',
                    value: cleaned,
                    updated_at: new Date().toISOString(),
                },
                {
                    key: 'hero_autoplay_seconds',
                    value: safeAutoplay,
                    updated_at: new Date().toISOString(),
                },
            ];

            const { error } = await supabase.from('store_settings').upsert(payload);
            if (error) throw error;

            toast.success('Hero section saved');
            setSettings(prev => ({ ...prev, hero_slides: cleaned, hero_autoplay_seconds: safeAutoplay }));
            try {
                sessionStorage.removeItem('hy_cms_settings');
            } catch { /* ignore */ }
        } catch (err: any) {
            console.error('Error saving hero:', err);
            toast.error(err?.message || 'Failed to save hero');
        } finally {
            setSaving(false);
        }
    };

    // Delivery Zone Handlers
    async function handleSaveZone(e: React.FormEvent) {
        e.preventDefault();
        if (!editingZone) return;

        try {
            const { data, error } = await supabase
                .from('delivery_zones')
                .upsert({
                    id: editingZone.id, // limits creation if id is missing, but for new zones we might need to handle empty id
                    name: editingZone.name,
                    base_fee: editingZone.base_fee,
                    is_accra: editingZone.is_accra,
                    is_active: editingZone.is_active
                })
                .select()
                .single();

            if (error) throw error;

            if (editingZone.id) {
                setDeliveryZones(prev => prev.map(z => z.id === editingZone.id ? data : z));
                toast.success('Zone updated');
            } else {
                setDeliveryZones(prev => [...prev, data]);
                toast.success('Zone created');
            }
            setIsZoneModalOpen(false);
            setEditingZone(null);
        } catch (err: any) {
            console.error('Error saving zone:', err);
            toast.error('Failed to save delivery zone');
        }
    }

    async function handleDeleteZone(id: string) {
        if (!confirm('Are you sure you want to delete this zone?')) return;

        try {
            const { error } = await supabase
                .from('delivery_zones')
                .delete()
                .eq('id', id);

            if (error) throw error;
            setDeliveryZones(prev => prev.filter(z => z.id !== id));
            toast.success('Zone deleted');
        } catch (err: any) {
            console.error('Error deleting zone:', err);
            toast.error('Failed to delete zone');
        }
    }

    // ---------------------------------------------------------------
    // Announcement banner handlers (top bar)
    // ---------------------------------------------------------------
    async function handleSaveAnnouncement(e: React.FormEvent) {
        e.preventDefault();
        if (!editingAnnouncement) return;
        if (!editingAnnouncement.title.trim()) {
            toast.error('Announcement text is required');
            return;
        }
        setSaving(true);
        try {
            const payload: any = {
                name: editingAnnouncement.name || editingAnnouncement.title.slice(0, 60),
                type: 'announcement',
                title: editingAnnouncement.title.trim(),
                subtitle: editingAnnouncement.subtitle.trim() || null,
                background_color: editingAnnouncement.background_color || '#111827',
                text_color: editingAnnouncement.text_color || '#ffffff',
                button_text: editingAnnouncement.button_text.trim() || null,
                button_url: editingAnnouncement.button_url.trim() || null,
                is_active: editingAnnouncement.is_active,
                position: 'top',
                sort_order: editingAnnouncement.sort_order || 0,
                updated_at: new Date().toISOString(),
            };
            if (editingAnnouncement.id) payload.id = editingAnnouncement.id;

            const { error } = await supabase.from('banners').upsert(payload);
            if (error) throw error;

            toast.success('Announcement saved');
            setEditingAnnouncement(null);
            try { sessionStorage.removeItem('hy_banners'); } catch { /* ignore */ }
            fetchData();
        } catch (err: any) {
            console.error('Error saving announcement:', err);
            toast.error(err?.message || 'Failed to save announcement');
        } finally {
            setSaving(false);
        }
    }

    async function handleDeleteAnnouncement(id: string) {
        if (!confirm('Delete this announcement?')) return;
        try {
            const { error } = await supabase.from('banners').delete().eq('id', id);
            if (error) throw error;
            setAnnouncements(prev => prev.filter(a => a.id !== id));
            try { sessionStorage.removeItem('hy_banners'); } catch { /* ignore */ }
            toast.success('Announcement deleted');
        } catch (err: any) {
            console.error('Error deleting announcement:', err);
            toast.error('Failed to delete announcement');
        }
    }

    async function handleToggleAnnouncement(banner: AnnouncementBanner) {
        try {
            const { error } = await supabase
                .from('banners')
                .update({ is_active: !banner.is_active, updated_at: new Date().toISOString() })
                .eq('id', banner.id);
            if (error) throw error;
            setAnnouncements(prev => prev.map(a => a.id === banner.id ? { ...a, is_active: !a.is_active } : a));
            try { sessionStorage.removeItem('hy_banners'); } catch { /* ignore */ }
        } catch (err: any) {
            toast.error('Failed to update announcement');
        }
    }

    if (loading) return (
        <div className="flex items-center justify-center min-h-screen">
            <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
    );

    return (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
                    <p className="text-gray-500">Manage your store configuration and preferences</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                {/* Sidebar Navigation */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden h-fit">
                    <nav className="flex flex-col">
                        {[
                            { id: 'general', label: 'General Info', icon: 'ri-store-2-line' },
                            { id: 'hero', label: 'Hero Section', icon: 'ri-image-2-line' },
                            { id: 'announcements', label: 'Announcement Bar', icon: 'ri-megaphone-line' },
                            { id: 'popup', label: 'Welcome Popup', icon: 'ri-window-line' },
                            { id: 'contact', label: 'Contact & Social', icon: 'ri-contacts-line' },
                            { id: 'store', label: 'Store Config', icon: 'ri-settings-4-line' },
                            { id: 'tracking', label: 'Tracking & Pixels', icon: 'ri-line-chart-line' },
                            { id: 'delivery', label: 'Delivery Zones', icon: 'ri-truck-line' },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center space-x-3 px-6 py-4 text-left transition-colors ${activeTab === tab.id
                                    ? 'bg-emerald-50 text-emerald-700 font-medium border-l-4 border-emerald-500'
                                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 border-l-4 border-transparent'
                                    }`}
                            >
                                <i className={`${tab.icon} text-xl`}></i>
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Content Area */}
                <div className="lg:col-span-3">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6 lg:p-8">
                        {/* General Info Tab */}
                        {activeTab === 'general' && (
                            <form onSubmit={handleSaveSettings} className="space-y-6">
                                <h2 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-4 mb-6">General Information</h2>

                                <div className="grid grid-cols-1 gap-6">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Site Name</label>
                                        <input
                                            type="text"
                                            value={settings.site_name || ''}
                                            onChange={(e) => updateSetting('site_name', e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Tagline</label>
                                        <input
                                            type="text"
                                            value={settings.site_tagline || ''}
                                            onChange={(e) => updateSetting('site_tagline', e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Logo URL</label>
                                        <div className="flex gap-4">
                                            <input
                                                type="text"
                                                value={settings.site_logo || ''}
                                                onChange={(e) => updateSetting('site_logo', e.target.value)}
                                                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                            />
                                            {settings.site_logo && (
                                                <div className="w-10 h-10 bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center overflow-hidden">
                                                    <img src={settings.site_logo} alt="Logo Preview" className="w-full h-full object-contain" />
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Primary Color</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="color"
                                                    value={settings.primary_color || '#000000'}
                                                    onChange={(e) => updateSetting('primary_color', e.target.value)}
                                                    className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                                                />
                                                <input
                                                    type="text"
                                                    value={settings.primary_color || ''}
                                                    onChange={(e) => updateSetting('primary_color', e.target.value)}
                                                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all uppercase"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Secondary Color</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="color"
                                                    value={settings.secondary_color || '#000000'}
                                                    onChange={(e) => updateSetting('secondary_color', e.target.value)}
                                                    className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                                                />
                                                <input
                                                    type="text"
                                                    value={settings.secondary_color || ''}
                                                    onChange={(e) => updateSetting('secondary_color', e.target.value)}
                                                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all uppercase"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Maintenance Mode */}
                                <div className="pt-6 border-t border-gray-100">
                                    <h3 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
                                        <i className="ri-tools-line text-lg text-gray-600"></i>
                                        Maintenance Mode
                                    </h3>
                                    <p className="text-sm text-gray-500 mb-4">When enabled, the storefront shows a maintenance page. Use the sidebar toggle to enable/disable. Admin always remains accessible.</p>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Countdown Duration (minutes)</label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="1440"
                                            value={settings.maintenance_countdown_minutes || '30'}
                                            onChange={(e) => updateSetting('maintenance_countdown_minutes', e.target.value || '30')}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                            placeholder="30"
                                        />
                                        <p className="text-sm text-gray-500 mt-1">How long the countdown displays on the maintenance page (default: 30)</p>
                                    </div>
                                </div>

                                <div className="pt-6 border-t border-gray-100 flex justify-end">
                                    <button
                                        type="submit"
                                        disabled={saving}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {saving && <i className="ri-loader-4-line animate-spin"></i>}
                                        Save Changes
                                    </button>
                                </div>
                            </form>
                        )}

                        {/* Hero Section Tab */}
                        {activeTab === 'hero' && (
                            <div className="space-y-6">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-gray-100 pb-4 mb-6">
                                    <div>
                                        <h2 className="text-lg font-semibold text-gray-900">Homepage Hero</h2>
                                        <p className="text-sm text-gray-500">Manage the slider at the top of your homepage. Add one slide for a static hero, or multiple slides for a rotating banner.</p>
                                        <p className="text-xs text-gray-500 mt-2">For the best fit on all screens, use a <strong className="font-medium text-gray-700">wide landscape</strong> image (around <strong className="font-medium text-gray-700">1920×1080</strong> or 16∶9). Images are cropped to fill the hero and kept centred.</p>
                                    </div>
                                    <button
                                        onClick={addHeroSlide}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap"
                                    >
                                        <i className="ri-add-line"></i> Add Slide
                                    </button>
                                </div>

                                {/* Autoplay settings */}
                                <div className="bg-gray-50 border border-gray-100 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                    <div>
                                        <p className="font-medium text-gray-900 text-sm">Autoplay Interval</p>
                                        <p className="text-xs text-gray-500">Seconds each slide stays visible before the next one appears (only applies when you have more than one slide).</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            min={2}
                                            max={30}
                                            value={settings.hero_autoplay_seconds ?? 6}
                                            onChange={(e) => updateSetting('hero_autoplay_seconds', Number(e.target.value))}
                                            className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-center"
                                        />
                                        <span className="text-sm text-gray-500">seconds</span>
                                    </div>
                                </div>

                                {/* Slide list */}
                                {heroSlides.length === 0 && (
                                    <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
                                        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                            <i className="ri-image-2-line text-2xl text-gray-400"></i>
                                        </div>
                                        <p className="text-gray-700 font-medium">No slides yet</p>
                                        <p className="text-sm text-gray-500 mb-4">Add your first hero slide to customize the homepage banner.</p>
                                        <button
                                            onClick={addHeroSlide}
                                            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                                        >
                                            <i className="ri-add-line"></i> Add Slide
                                        </button>
                                    </div>
                                )}

                                <div className="space-y-5">
                                    {heroSlides.map((slide, index) => (
                                        <div key={slide.id} className="border border-gray-200 rounded-xl p-4 sm:p-5 bg-white">
                                            <div className="flex items-center justify-between mb-4">
                                                <div className="flex items-center gap-2">
                                                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-50 text-emerald-700 font-semibold text-sm">
                                                        {index + 1}
                                                    </span>
                                                    <span className="font-medium text-gray-900 text-sm">Slide {index + 1}</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => moveHeroSlide(slide.id, 'up')}
                                                        disabled={index === 0}
                                                        title="Move up"
                                                        className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                                    >
                                                        <i className="ri-arrow-up-line"></i>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => moveHeroSlide(slide.id, 'down')}
                                                        disabled={index === heroSlides.length - 1}
                                                        title="Move down"
                                                        className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                                    >
                                                        <i className="ri-arrow-down-line"></i>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeHeroSlide(slide.id)}
                                                        title="Remove slide"
                                                        className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                    >
                                                        <i className="ri-delete-bin-line"></i>
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
                                                {/* Image preview + upload */}
                                                <div className="md:col-span-2">
                                                    <label className="block text-sm font-medium text-gray-700 mb-2">Image</label>
                                                    <div className="relative w-full aspect-[4/3] bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                                                        {slide.image ? (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img src={slide.image} alt={`Slide ${index + 1}`} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center text-gray-400">
                                                                <i className="ri-image-line text-4xl"></i>
                                                            </div>
                                                        )}
                                                        {uploadingSlideId === slide.id && (
                                                            <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                                                                <i className="ri-loader-4-line text-2xl text-emerald-600 animate-spin"></i>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="mt-2 flex gap-2">
                                                        <label className="flex-1 cursor-pointer inline-flex items-center justify-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors">
                                                            <i className="ri-upload-cloud-line"></i>
                                                            <span>Upload</span>
                                                            <input
                                                                type="file"
                                                                accept="image/*"
                                                                className="hidden"
                                                                onChange={(e) => {
                                                                    const file = e.target.files?.[0];
                                                                    if (file) handleUploadSlideImage(slide.id, file);
                                                                    e.target.value = '';
                                                                }}
                                                            />
                                                        </label>
                                                        {slide.image && (
                                                            <button
                                                                type="button"
                                                                onClick={() => updateHeroSlide(slide.id, { image: '' })}
                                                                className="px-3 py-2 bg-gray-50 hover:bg-red-50 hover:text-red-600 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 transition-colors"
                                                            >
                                                                <i className="ri-close-line"></i>
                                                            </button>
                                                        )}
                                                    </div>
                                                    <input
                                                        type="url"
                                                        placeholder="Or paste image URL"
                                                        value={slide.image}
                                                        onChange={(e) => updateHeroSlide(slide.id, { image: e.target.value })}
                                                        className="mt-2 w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                                                    />
                                                </div>

                                                {/* Text fields */}
                                                <div className="md:col-span-3 space-y-3">
                                                    <div>
                                                        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                                                        <input
                                                            type="text"
                                                            value={slide.title}
                                                            onChange={(e) => updateHeroSlide(slide.id, { title: e.target.value })}
                                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                                                            placeholder="Stay Sleek in Style"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-sm font-medium text-gray-700 mb-1">Subtitle</label>
                                                        <textarea
                                                            rows={2}
                                                            value={slide.subtitle}
                                                            onChange={(e) => updateHeroSlide(slide.id, { subtitle: e.target.value })}
                                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
                                                            placeholder="A short line that sells the collection."
                                                        />
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        <div>
                                                            <label className="block text-sm font-medium text-gray-700 mb-1">Button Text</label>
                                                            <input
                                                                type="text"
                                                                value={slide.button_text}
                                                                onChange={(e) => updateHeroSlide(slide.id, { button_text: e.target.value })}
                                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                                                                placeholder="Shop Now"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-sm font-medium text-gray-700 mb-1">Button Link</label>
                                                            <input
                                                                type="text"
                                                                value={slide.button_link}
                                                                onChange={(e) => updateHeroSlide(slide.id, { button_link: e.target.value })}
                                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                                                                placeholder="/shop or https://..."
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="pt-6 border-t border-gray-100 flex items-center justify-between gap-3 flex-wrap">
                                    <p className="text-xs text-gray-500">
                                        Changes go live as soon as you save. Slides with no image, title or subtitle are removed on save.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handleSaveHero}
                                        disabled={saving}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {saving && <i className="ri-loader-4-line animate-spin"></i>}
                                        Save Hero Section
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Contact & Social Tab */}
                        {activeTab === 'contact' && (
                            <form onSubmit={handleSaveSettings} className="space-y-6">
                                <div className="border-b border-gray-100 pb-4 mb-6">
                                    <h2 className="text-lg font-semibold text-gray-900">Contact & Social Media</h2>
                                    <p className="text-sm text-gray-500 mt-1">
                                        These fields power every social icon and contact link on the storefront — footer, Contact Us page, Privacy, Terms, floating WhatsApp button, Instagram feed, checkout fallbacks, etc. Updating Contact Email here updates it everywhere customers see it. Leave a social field blank to hide that icon site-wide.
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="md:col-span-2">
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Physical Address</label>
                                        <textarea
                                            value={settings.contact_address || ''}
                                            onChange={(e) => updateSetting('contact_address', e.target.value)}
                                            rows={3}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                                        <div className="relative">
                                            <i className="ri-mail-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                                            <input
                                                type="email"
                                                value={settings.contact_email || ''}
                                                onChange={(e) => updateSetting('contact_email', e.target.value)}
                                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
                                        <div className="relative">
                                            <i className="ri-phone-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                                            <input
                                                type="tel"
                                                value={settings.contact_phone || ''}
                                                onChange={(e) => updateSetting('contact_phone', e.target.value)}
                                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">WhatsApp Number (No +)</label>
                                        <div className="relative">
                                            <i className="ri-whatsapp-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                                            <input
                                                type="text"
                                                value={settings.whatsapp_number || ''}
                                                onChange={(e) => updateSetting('whatsapp_number', e.target.value)}
                                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                                placeholder="233200000000"
                                            />
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">Powers the floating WhatsApp chat button + checkout fallback. Digits only, with country code (e.g. <span className="font-mono">233276558163</span>).</p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Facebook URL</label>
                                        <div className="relative">
                                            <i className="ri-facebook-fill absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                                            <input
                                                type="url"
                                                value={settings.social_facebook || ''}
                                                onChange={(e) => updateSetting('social_facebook', e.target.value)}
                                                placeholder="https://facebook.com/yourpage"
                                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                            />
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">Shown in the footer. Leave blank to hide.</p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Instagram URL</label>
                                        <div className="relative">
                                            <i className="ri-instagram-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                                            <input
                                                type="url"
                                                value={settings.social_instagram || ''}
                                                onChange={(e) => updateSetting('social_instagram', e.target.value)}
                                                placeholder="https://instagram.com/yourhandle"
                                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                            />
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">Shown in the footer, the homepage Instagram feed section, and the checkout contact fallback. Leave blank to hide.</p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">TikTok URL</label>
                                        <div className="relative">
                                            <i className="ri-tiktok-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                                            <input
                                                type="url"
                                                value={settings.social_tiktok || ''}
                                                onChange={(e) => updateSetting('social_tiktok', e.target.value)}
                                                placeholder="https://www.tiktok.com/@yourhandle"
                                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                            />
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">Shown in the footer. Leave blank to hide.</p>
                                    </div>
                                </div>

                                <div className="pt-6 border-t border-gray-100 flex justify-end">
                                    <button
                                        type="submit"
                                        disabled={saving}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {saving && <i className="ri-loader-4-line animate-spin"></i>}
                                        Save Changes
                                    </button>
                                </div>
                            </form>
                        )}

                        {/* Store Config Tab */}
                        {activeTab === 'store' && (
                            <form onSubmit={handleSaveSettings} className="space-y-6">
                                <h2 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-4 mb-6">Store Configuration</h2>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="font-medium text-gray-900">Stop All Deliveries</label>
                                            <button
                                                type="button"
                                                onClick={() => updateSetting('delivery_unavailable', !settings.delivery_unavailable)}
                                                className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${settings.delivery_unavailable ? 'bg-red-500' : 'bg-gray-300'}`}
                                            >
                                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 ${settings.delivery_unavailable ? 'translate-x-6' : 'translate-x-0'}`}></span>
                                            </button>
                                        </div>
                                        <p className="text-sm text-gray-500">Prevent customers from placing orders with delivery (e.g. during holidays).</p>
                                    </div>

                                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="font-medium text-gray-900">Same Day Delivery</label>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    updateSetting('same_day_delivery_enabled', !settings.same_day_delivery_enabled);
                                                    if (!settings.same_day_delivery_enabled) updateSetting('next_day_delivery_enabled', false);
                                                }}
                                                className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${settings.same_day_delivery_enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
                                            >
                                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 ${settings.same_day_delivery_enabled ? 'translate-x-6' : 'translate-x-0'}`}></span>
                                            </button>
                                        </div>
                                        <p className="text-sm text-gray-500">Show a notice that orders placed today will be delivered today.</p>
                                    </div>

                                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="font-medium text-gray-900">Next Day Delivery</label>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    updateSetting('next_day_delivery_enabled', !settings.next_day_delivery_enabled);
                                                    if (!settings.next_day_delivery_enabled) updateSetting('same_day_delivery_enabled', false);
                                                }}
                                                className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${settings.next_day_delivery_enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
                                            >
                                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 ${settings.next_day_delivery_enabled ? 'translate-x-6' : 'translate-x-0'}`}></span>
                                            </button>
                                        </div>
                                        <p className="text-sm text-gray-500">Show a notice that orders placed today will be delivered tomorrow.</p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Currency Symbol</label>
                                        <input
                                            type="text"
                                            value={settings.currency_symbol || ''}
                                            onChange={(e) => updateSetting('currency_symbol', e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Currency Code</label>
                                        <input
                                            type="text"
                                            value={settings.currency || ''}
                                            onChange={(e) => updateSetting('currency', e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Loyalty Points Per Item</label>
                                        <input
                                            type="number"
                                            value={settings.loyalty_points_per_item || 0}
                                            onChange={(e) => updateSetting('loyalty_points_per_item', parseInt(e.target.value))}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            Full rewards controls (pause, expiry, point value) are under{' '}
                                            <a href="/admin/promotions" className="text-emerald-700 underline">Promotions</a>.
                                        </p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Min Points to Redeem</label>
                                        <input
                                            type="number"
                                            value={settings.loyalty_min_redeem || 0}
                                            onChange={(e) => updateSetting('loyalty_min_redeem', parseInt(e.target.value))}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                        />
                                    </div>

                                </div>

                                <div className="pt-6 border-t border-gray-100 flex justify-end">
                                    <button
                                        type="submit"
                                        disabled={saving}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {saving && <i className="ri-loader-4-line animate-spin"></i>}
                                        Save Changes
                                    </button>
                                </div>
                            </form>
                        )}

                        {/* Announcement Bar Tab */}
                        {activeTab === 'announcements' && (
                            <div className="space-y-6">
                                <div className="flex items-center justify-between border-b border-gray-100 pb-4 mb-6">
                                    <div>
                                        <h2 className="text-lg font-semibold text-gray-900">Announcement Bar</h2>
                                        <p className="text-sm text-gray-500 mt-1">The message strip shown at the very top of the website. Multiple active announcements rotate automatically.</p>
                                    </div>
                                    <button
                                        onClick={() => setEditingAnnouncement({
                                            id: '', name: '', title: '', subtitle: '',
                                            background_color: '#111827', text_color: '#ffffff',
                                            button_text: '', button_url: '', is_active: true,
                                            sort_order: announcements.length,
                                        })}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap"
                                    >
                                        <i className="ri-add-line"></i> New
                                    </button>
                                </div>

                                {announcements.length === 0 ? (
                                    <div className="text-center py-10 text-gray-500">
                                        <i className="ri-megaphone-line text-4xl text-gray-300 block mb-2"></i>
                                        No announcements yet. The site shows the default message
                                        (&quot;Shop Premium Footwear — Nationwide Delivery Available&quot;) until you add one.
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {announcements.map(banner => (
                                            <div key={banner.id} className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl">
                                                <div
                                                    className="hidden sm:flex px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 max-w-[180px] truncate"
                                                    style={{ backgroundColor: banner.background_color, color: banner.text_color }}
                                                >
                                                    {banner.title || 'Preview'}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium text-gray-900 truncate">{banner.title}</p>
                                                    {banner.subtitle && <p className="text-sm text-gray-500 truncate">{banner.subtitle}</p>}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleToggleAnnouncement(banner)}
                                                    className={`relative w-12 h-6 rounded-full transition-colors duration-200 shrink-0 ${banner.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`}
                                                    title={banner.is_active ? 'Active — click to hide' : 'Hidden — click to show'}
                                                >
                                                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 ${banner.is_active ? 'translate-x-6' : 'translate-x-0'}`}></span>
                                                </button>
                                                <button
                                                    onClick={() => setEditingAnnouncement(banner)}
                                                    className="text-gray-400 hover:text-emerald-600 transition-colors p-1"
                                                >
                                                    <i className="ri-pencil-line text-lg"></i>
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteAnnouncement(banner.id)}
                                                    className="text-gray-400 hover:text-red-500 transition-colors p-1"
                                                >
                                                    <i className="ri-delete-bin-line text-lg"></i>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Edit Announcement Modal */}
                                {editingAnnouncement && (
                                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                                        <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
                                            <h3 className="text-lg font-bold text-gray-900 mb-4">
                                                {editingAnnouncement.id ? 'Edit Announcement' : 'New Announcement'}
                                            </h3>
                                            <form onSubmit={handleSaveAnnouncement} className="space-y-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Announcement text</label>
                                                    <input
                                                        type="text"
                                                        required
                                                        value={editingAnnouncement.title}
                                                        onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, title: e.target.value })}
                                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                                                        placeholder="e.g. Shop Premium Footwear — Nationwide Delivery Available"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Extra text <span className="text-gray-400 font-normal">(optional, shown after the main text)</span></label>
                                                    <input
                                                        type="text"
                                                        value={editingAnnouncement.subtitle}
                                                        onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, subtitle: e.target.value })}
                                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-sm font-medium text-gray-700 mb-1">Background</label>
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="color"
                                                                value={editingAnnouncement.background_color}
                                                                onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, background_color: e.target.value })}
                                                                className="w-10 h-10 rounded cursor-pointer border border-gray-200"
                                                            />
                                                            <input
                                                                type="text"
                                                                value={editingAnnouncement.background_color}
                                                                onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, background_color: e.target.value })}
                                                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                                            />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="block text-sm font-medium text-gray-700 mb-1">Text colour</label>
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="color"
                                                                value={editingAnnouncement.text_color}
                                                                onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, text_color: e.target.value })}
                                                                className="w-10 h-10 rounded cursor-pointer border border-gray-200"
                                                            />
                                                            <input
                                                                type="text"
                                                                value={editingAnnouncement.text_color}
                                                                onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, text_color: e.target.value })}
                                                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-sm font-medium text-gray-700 mb-1">Button text <span className="text-gray-400 font-normal">(optional)</span></label>
                                                        <input
                                                            type="text"
                                                            value={editingAnnouncement.button_text}
                                                            onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, button_text: e.target.value })}
                                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm"
                                                            placeholder="Shop Now"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-sm font-medium text-gray-700 mb-1">Button link</label>
                                                        <input
                                                            type="text"
                                                            value={editingAnnouncement.button_url}
                                                            onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, button_url: e.target.value })}
                                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm"
                                                            placeholder="/shop"
                                                        />
                                                    </div>
                                                </div>
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={editingAnnouncement.is_active}
                                                        onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, is_active: e.target.checked })}
                                                        className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500 border-gray-300"
                                                    />
                                                    <span className="text-sm text-gray-700">Show on the website</span>
                                                </label>

                                                {/* Live preview */}
                                                <div
                                                    className="py-2 px-4 text-center text-sm rounded-lg"
                                                    style={{ backgroundColor: editingAnnouncement.background_color, color: editingAnnouncement.text_color }}
                                                >
                                                    <span className="font-medium">{editingAnnouncement.title || 'Your announcement text'}</span>
                                                    {editingAnnouncement.subtitle && <span className="opacity-90 ml-2">{editingAnnouncement.subtitle}</span>}
                                                </div>

                                                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditingAnnouncement(null)}
                                                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        type="submit"
                                                        disabled={saving}
                                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                                                    >
                                                        Save Announcement
                                                    </button>
                                                </div>
                                            </form>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Welcome Popup Tab */}
                        {activeTab === 'popup' && (
                            <form onSubmit={handleSaveSettings} className="space-y-6">
                                <div className="border-b border-gray-100 pb-4 mb-6">
                                    <h2 className="text-lg font-semibold text-gray-900">Welcome Popup</h2>
                                    <p className="text-sm text-gray-500 mt-1">An optional popup shown to visitors when they land on the website — great for promotions, newsletter sign-ups, or announcements.</p>
                                </div>

                                <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="font-medium text-gray-900">Enable Welcome Popup</label>
                                        <button
                                            type="button"
                                            onClick={() => updateSetting('welcome_popup_enabled', settings.welcome_popup_enabled === 'true' ? 'false' : 'true')}
                                            className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${settings.welcome_popup_enabled === 'true' ? 'bg-emerald-500' : 'bg-gray-300'}`}
                                        >
                                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 ${settings.welcome_popup_enabled === 'true' ? 'translate-x-6' : 'translate-x-0'}`}></span>
                                        </button>
                                    </div>
                                    <p className="text-sm text-gray-500">Turn the popup on or off without losing your content.</p>
                                </div>

                                <div className="grid grid-cols-1 gap-6">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Heading</label>
                                        <input
                                            type="text"
                                            value={settings.welcome_popup_title || ''}
                                            onChange={(e) => updateSetting('welcome_popup_title', e.target.value)}
                                            placeholder="e.g. Welcome to Hy_stepper!"
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Message</label>
                                        <textarea
                                            rows={3}
                                            value={settings.welcome_popup_message || ''}
                                            onChange={(e) => updateSetting('welcome_popup_message', e.target.value)}
                                            placeholder="e.g. Enjoy nationwide delivery on all orders. Sign up today for exclusive offers!"
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Image URL <span className="text-gray-400 font-normal">(optional)</span></label>
                                        <input
                                            type="text"
                                            value={settings.welcome_popup_image || ''}
                                            onChange={(e) => updateSetting('welcome_popup_image', e.target.value)}
                                            placeholder="https://…"
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Button text</label>
                                            <input
                                                type="text"
                                                value={settings.welcome_popup_button_text || ''}
                                                onChange={(e) => updateSetting('welcome_popup_button_text', e.target.value)}
                                                placeholder="Shop Now"
                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Button link</label>
                                            <input
                                                type="text"
                                                value={settings.welcome_popup_button_link || ''}
                                                onChange={(e) => updateSetting('welcome_popup_button_link', e.target.value)}
                                                onBlur={(e) => updateSetting('welcome_popup_button_link', e.target.value.trim())}
                                                placeholder="/shop"
                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Delay before showing (seconds)</label>
                                            <input
                                                type="number"
                                                min={0}
                                                max={60}
                                                value={settings.welcome_popup_delay_seconds ?? 3}
                                                onChange={(e) => updateSetting('welcome_popup_delay_seconds', e.target.value)}
                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">How often to show</label>
                                            <select
                                                value={settings.welcome_popup_frequency || 'once'}
                                                onChange={(e) => updateSetting('welcome_popup_frequency', e.target.value)}
                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all bg-white"
                                            >
                                                <option value="once">Once per visitor</option>
                                                <option value="daily">Once per day</option>
                                                <option value="always">Every visit</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-6 border-t border-gray-100 flex justify-end">
                                    <button
                                        type="submit"
                                        disabled={saving}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {saving && <i className="ri-loader-4-line animate-spin"></i>}
                                        Save Changes
                                    </button>
                                </div>
                            </form>
                        )}

                        {/* Tracking & Pixels Tab */}
                        {activeTab === 'tracking' && (
                            <form onSubmit={handleSaveSettings} className="space-y-6">
                                <div className="border-b border-gray-100 pb-4 mb-6">
                                    <h2 className="text-lg font-semibold text-gray-900">Tracking &amp; Pixels</h2>
                                    <p className="text-sm text-gray-500 mt-1">Connect Google Analytics 4 and Meta (Facebook) Pixel. Once saved, page views and purchases are tracked automatically on the storefront.</p>
                                </div>

                                <div className="grid grid-cols-1 gap-6">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Google Analytics 4 Measurement ID</label>
                                        <input
                                            type="text"
                                            value={settings.ga4_measurement_id || ''}
                                            onChange={(e) => updateSetting('ga4_measurement_id', e.target.value.trim())}
                                            placeholder="G-XXXXXXXXXX"
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all font-mono"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            Find it in Google Analytics → Admin → Data Streams → your web stream. Starts with <span className="font-mono">G-</span>.
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Meta (Facebook) Pixel ID</label>
                                        <input
                                            type="text"
                                            value={settings.meta_pixel_id || ''}
                                            onChange={(e) => updateSetting('meta_pixel_id', e.target.value.trim())}
                                            placeholder="1234567890123456"
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all font-mono"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            Find it in Meta Events Manager → Data Sources → your pixel. A 15-16 digit number.
                                        </p>
                                    </div>
                                </div>

                                <div className="bg-blue-50 rounded-lg border border-blue-100 p-4 text-sm text-blue-800">
                                    <p className="font-semibold mb-1"><i className="ri-information-line mr-1"></i>What gets tracked</p>
                                    <ul className="list-disc ml-5 space-y-0.5">
                                        <li>Every page view on the storefront</li>
                                        <li>Completed purchases (order number, value, items) — powers conversion reports</li>
                                    </ul>
                                    <p className="mt-2">Conversion rates then appear inside Google Analytics / Meta Events Manager.</p>
                                </div>

                                <div className="pt-6 border-t border-gray-100 flex justify-end">
                                    <button
                                        type="submit"
                                        disabled={saving}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {saving && <i className="ri-loader-4-line animate-spin"></i>}
                                        Save Changes
                                    </button>
                                </div>
                            </form>
                        )}

                        {/* Delivery Zones Tab */}
                        {activeTab === 'delivery' && (
                            <div className="space-y-6">
                                <div className="flex items-center justify-between border-b border-gray-100 pb-4 mb-6">
                                    <div>
                                        <h2 className="text-lg font-semibold text-gray-900">Delivery Zones</h2>
                                        <a href="/admin/settings/delivery" className="text-sm text-emerald-600 hover:text-emerald-700 font-medium">
                                            Open full delivery manager (methods, discounts, free delivery) <i className="ri-arrow-right-line"></i>
                                        </a>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setEditingZone({ id: '', name: '', base_fee: 0, is_accra: false, is_active: true });
                                            setIsZoneModalOpen(true);
                                        }}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                                    >
                                        <i className="ri-add-line"></i> Add Zone
                                    </button>
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="border-b border-gray-100 text-sm text-gray-500 uppercase tracking-wider">
                                                <th className="py-3 px-4">Zone Name</th>
                                                <th className="py-3 px-4">Fee (GH₵)</th>
                                                <th className="py-3 px-4">Type</th>
                                                <th className="py-3 px-4">Status</th>
                                                <th className="py-3 px-4 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {deliveryZones.length === 0 ? (
                                                <tr>
                                                    <td colSpan={5} className="py-8 text-center text-gray-500">No delivery zones configured</td>
                                                </tr>
                                            ) : (
                                                deliveryZones.map(zone => (
                                                    <tr key={zone.id} className="hover:bg-gray-50 transition-colors">
                                                        <td className="py-3 px-4 font-medium text-gray-900">{zone.name}</td>
                                                        <td className="py-3 px-4">{zone.base_fee.toFixed(2)}</td>
                                                        <td className="py-3 px-4">
                                                            {zone.is_accra ? (
                                                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">Accra</span>
                                                            ) : (
                                                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">Regional</span>
                                                            )}
                                                        </td>
                                                        <td className="py-3 px-4">
                                                            {zone.is_active ? (
                                                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">Active</span>
                                                            ) : (
                                                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700">Inactive</span>
                                                            )}
                                                        </td>
                                                        <td className="py-3 px-4 text-right space-x-2">
                                                            <button
                                                                onClick={() => {
                                                                    setEditingZone(zone);
                                                                    setIsZoneModalOpen(true);
                                                                }}
                                                                className="text-gray-400 hover:text-emerald-600 transition-colors"
                                                            >
                                                                <i className="ri-pencil-line text-lg"></i>
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteZone(zone.id)}
                                                                className="text-gray-400 hover:text-red-500 transition-colors"
                                                            >
                                                                <i className="ri-delete-bin-line text-lg"></i>
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Edit Zone Modal */}
                                {isZoneModalOpen && editingZone && (
                                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                                        <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                                            <h3 className="text-lg font-bold text-gray-900 mb-4">{editingZone.id ? 'Edit Zone' : 'New Delivery Zone'}</h3>

                                            <form onSubmit={handleSaveZone} className="space-y-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Zone Name</label>
                                                    <input
                                                        type="text"
                                                        required
                                                        value={editingZone.name}
                                                        onChange={(e) => setEditingZone({ ...editingZone, name: e.target.value })}
                                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                                                        placeholder="e.g. Greater Accra, Ashanti Region"
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Base Delivery Fee</label>
                                                    <input
                                                        type="number"
                                                        required
                                                        min="0"
                                                        step="0.01"
                                                        value={editingZone.base_fee}
                                                        onChange={(e) => setEditingZone({ ...editingZone, base_fee: parseFloat(e.target.value) })}
                                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                                                    />
                                                </div>

                                                <div className="flex items-center gap-4">
                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={editingZone.is_accra}
                                                            onChange={(e) => setEditingZone({ ...editingZone, is_accra: e.target.checked })}
                                                            className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500 border-gray-300"
                                                        />
                                                        <span className="text-sm text-gray-700">Is Accra Zone?</span>
                                                    </label>

                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={editingZone.is_active}
                                                            onChange={(e) => setEditingZone({ ...editingZone, is_active: e.target.checked })}
                                                            className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500 border-gray-300"
                                                        />
                                                        <span className="text-sm text-gray-700">Active Status</span>
                                                    </label>
                                                </div>

                                                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsZoneModalOpen(false)}
                                                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        type="submit"
                                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
                                                    >
                                                        Save Zone
                                                    </button>
                                                </div>
                                            </form>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                    </div>
                </div>
            </div>
        </div>
    );
}
