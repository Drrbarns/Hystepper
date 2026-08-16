'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { adminAuthHeaders } from '@/lib/admin-auth-headers';

export default function NotificationsPage() {
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState('');
    const [error, setError] = useState('');

    const [form, setForm] = useState({
        subject: '',
        message: '',
        channels: { email: true, sms: false },
        audience: 'all'
    });

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            // 1. Fetch Recipients (Client-side to use Admin session)
            let recipients: any[] = [];
            if (form.audience === 'all' || form.audience === 'newsletter') {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('email, phone, full_name');

                if (error) throw error;
                recipients = data.map(u => ({ email: u.email, phone: u.phone, name: u.full_name }));
            }

            if (recipients.length === 0) throw new Error('No recipients found in selected audience');

            // 2. Call API
            const res = await fetch('/api/notifications', {
                method: 'POST',
                headers: await adminAuthHeaders(),
                body: JSON.stringify({
                    type: 'campaign',
                    payload: {
                        recipients, // Array of { email, phone, name }
                        subject: form.subject,
                        message: form.message,
                        channels: form.channels,
                        // audience: form.audience // Audience is now handled client-side for recipient fetching
                    }
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to send');

            setSuccess(`Campaign sent successfully! ${data.message || ''}`);
            // Clear sensitive fields
            setForm(prev => ({ ...prev, subject: '', message: '' }));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold text-gray-900 mb-6">Marketing & Notifications</h1>

            <div className="bg-white p-4 sm:p-6 lg:p-8 rounded-xl shadow-sm border border-gray-200">
                <h2 className="text-xl font-semibold mb-6">Send New Campaign</h2>

                {success && <div className="bg-emerald-50 text-emerald-700 p-4 rounded-lg mb-4">{success}</div>}
                {error && <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-4">{error}</div>}

                <form onSubmit={handleSend} className="space-y-6">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Audience</label>
                        <select
                            value={form.audience}
                            onChange={e => setForm({ ...form, audience: e.target.value })}
                            className="w-full p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                            <option value="all">All Customers</option>
                            <option value="newsletter">Newsletter Subscribers</option>
                        </select>
                    </div>

                    <div className="flex gap-6 p-4 bg-gray-50 rounded-lg border border-gray-100">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.channels.email}
                                onChange={e => setForm({ ...form, channels: { ...form.channels, email: e.target.checked } })}
                                className="w-5 h-5 text-emerald-600 rounded focus:ring-emerald-500 cursor-pointer"
                            />
                            <span className="font-medium text-gray-900">Send Email</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.channels.sms}
                                onChange={e => setForm({ ...form, channels: { ...form.channels, sms: e.target.checked } })}
                                className="w-5 h-5 text-emerald-600 rounded focus:ring-emerald-500 cursor-pointer"
                            />
                            <span className="font-medium text-gray-900">Send SMS</span>
                        </label>
                    </div>

                    {form.channels.email && (
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Email Subject</label>
                            <input
                                type="text"
                                value={form.subject}
                                onChange={e => setForm({ ...form, subject: e.target.value })}
                                className="w-full p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500"
                                placeholder="e.g., Summer Sale Starts Now!"
                                required={form.channels.email}
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Message Content</label>
                        <textarea
                            value={form.message}
                            onChange={e => setForm({ ...form, message: e.target.value })}
                            className="w-full p-3 border border-gray-300 rounded-lg h-40 outline-none focus:ring-2 focus:ring-emerald-500"
                            placeholder="Write your message here... For emails, this supports plain text."
                            required
                        />
                        <p className="text-sm text-gray-500 mt-1">This message will be used for the email body (wrapped in a template) and SMS content (if selected).</p>
                    </div>

                    <button
                        type="submit"
                        disabled={loading || (!form.channels.email && !form.channels.sms)}
                        className="w-full bg-emerald-700 text-white py-4 rounded-lg font-bold text-lg hover:bg-emerald-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                        {loading ? (
                            <span className="flex items-center justify-center">
                                <i className="ri-loader-4-line animate-spin mr-2"></i> Sending...
                            </span>
                        ) : 'Send Campaign'}
                    </button>
                </form>
            </div>
        </div>
    );
}
