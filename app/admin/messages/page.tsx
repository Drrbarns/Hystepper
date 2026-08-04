'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

type ContactMessage = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
  status: 'new' | 'read' | 'replied';
  created_at: string;
};

type Subscriber = {
  id: string;
  email: string;
  source: string;
  is_active: boolean;
  created_at: string;
};

const statusStyles: Record<string, string> = {
  new: 'bg-amber-100 text-amber-700 border-amber-200',
  read: 'bg-gray-100 text-gray-600 border-gray-200',
  replied: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

export default function AdminMessagesPage() {
  const [tab, setTab] = useState<'contact' | 'newsletter'>('contact');
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [msgRes, subRes] = await Promise.all([
          supabase.from('contact_submissions').select('*').order('created_at', { ascending: false }),
          supabase.from('newsletter_subscribers').select('*').order('created_at', { ascending: false }),
        ]);
        if (msgRes.error) throw msgRes.error;
        if (subRes.error) throw subRes.error;
        setMessages(msgRes.data || []);
        setSubscribers(subRes.data || []);
      } catch (err: any) {
        console.error('Failed to load messages:', err);
        toast.error('Could not load messages. Refresh to try again.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const newCount = useMemo(() => messages.filter(m => m.status === 'new').length, [messages]);
  const activeSubscribers = useMemo(() => subscribers.filter(s => s.is_active), [subscribers]);

  const setMessageStatus = async (id: string, status: ContactMessage['status']) => {
    const prev = messages;
    setMessages(prev.map(m => (m.id === id ? { ...m, status } : m)));
    const { error } = await supabase.from('contact_submissions').update({ status }).eq('id', id);
    if (error) {
      setMessages(prev);
      toast.error('Could not update message status');
    }
  };

  const openMessage = (m: ContactMessage) => {
    setExpandedId(expandedId === m.id ? null : m.id);
    if (m.status === 'new') void setMessageStatus(m.id, 'read');
  };

  const copyEmails = async () => {
    const list = activeSubscribers.map(s => s.email).join(', ');
    try {
      await navigator.clipboard.writeText(list);
      toast.success(`${activeSubscribers.length} email${activeSubscribers.length === 1 ? '' : 's'} copied — paste into BCC to send an update`);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const exportCsv = () => {
    const rows = [
      ['email', 'source', 'subscribed_at'],
      ...activeSubscribers.map(s => [s.email, s.source, new Date(s.created_at).toISOString()]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `newsletter-subscribers-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
        <p className="text-sm text-gray-500 mt-1">
          Contact form messages and newsletter sign-ups from the storefront.
        </p>
      </div>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('contact')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${tab === 'contact' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          Contact Messages
          {newCount > 0 && (
            <span className="ml-2 bg-amber-400 text-gray-900 text-xs font-bold px-1.5 py-0.5 rounded-full">{newCount} new</span>
          )}
        </button>
        <button
          onClick={() => setTab('newsletter')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${tab === 'newsletter' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          Newsletter Subscribers ({activeSubscribers.length})
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-500">Loading…</div>
      ) : tab === 'contact' ? (
        <div className="space-y-3">
          {messages.length === 0 && (
            <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-500">
              No contact messages yet. Messages sent from the storefront Contact page will appear here
              (a copy is also emailed to the store inbox).
            </div>
          )}
          {messages.map(m => (
            <div key={m.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
              <button
                onClick={() => openMessage(m)}
                className="w-full flex items-center gap-4 p-4 text-left cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{m.name}</span>
                    <span className={`text-xs font-semibold border px-2 py-0.5 rounded-full ${statusStyles[m.status] || statusStyles.read}`}>
                      {m.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 truncate mt-0.5">{m.subject}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-400">{new Date(m.created_at).toLocaleString()}</p>
                  <i className={`ri-arrow-${expandedId === m.id ? 'up' : 'down'}-s-line text-gray-400`}></i>
                </div>
              </button>

              {expandedId === m.id && (
                <div className="px-4 pb-4 border-t border-gray-100 pt-4 space-y-3">
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{m.message}</p>
                  <div className="flex items-center gap-3 flex-wrap text-sm">
                    <a href={`mailto:${m.email}?subject=Re: ${encodeURIComponent(m.subject)}`} className="text-gold-600 font-semibold hover:underline">
                      <i className="ri-mail-line mr-1"></i>{m.email}
                    </a>
                    {m.phone && (
                      <a href={`tel:${m.phone}`} className="text-gold-600 font-semibold hover:underline">
                        <i className="ri-phone-line mr-1"></i>{m.phone}
                      </a>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setMessageStatus(m.id, 'replied')}
                      disabled={m.status === 'replied'}
                      className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                    >
                      Mark replied
                    </button>
                    <button
                      onClick={() => setMessageStatus(m.id, 'new')}
                      disabled={m.status === 'new'}
                      className="px-3 py-1.5 text-xs font-semibold bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
                    >
                      Mark unread
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-gray-600">
              To send an update: copy all emails and paste them into the <span className="font-semibold">BCC</span> field
              of your store email, or export a CSV for a mailing tool.
            </p>
            <div className="flex gap-2">
              <button
                onClick={copyEmails}
                disabled={activeSubscribers.length === 0}
                className="px-3 py-2 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 cursor-pointer"
              >
                <i className="ri-file-copy-line mr-1"></i>Copy all emails
              </button>
              <button
                onClick={exportCsv}
                disabled={activeSubscribers.length === 0}
                className="px-3 py-2 text-xs font-semibold bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
              >
                <i className="ri-download-2-line mr-1"></i>Export CSV
              </button>
            </div>
          </div>

          {subscribers.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              No subscribers yet. Sign-ups from the “Stay in the Loop” form in the storefront footer will appear here.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase border-b border-gray-100">
                  <th className="p-4">Email</th>
                  <th className="p-4">Source</th>
                  <th className="p-4">Subscribed</th>
                </tr>
              </thead>
              <tbody>
                {subscribers.map(s => (
                  <tr key={s.id} className="border-b border-gray-50 last:border-0">
                    <td className="p-4 font-medium text-gray-900">
                      {s.email}
                      {!s.is_active && <span className="ml-2 text-xs text-gray-400">(unsubscribed)</span>}
                    </td>
                    <td className="p-4 text-gray-500 capitalize">{s.source}</td>
                    <td className="p-4 text-gray-500">{new Date(s.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
