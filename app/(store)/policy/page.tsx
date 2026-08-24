'use client';

import Link from 'next/link';
import { useCMS } from '@/context/CMSContext';
import {
  DEFAULT_POLICY_EXCHANGE,
  DEFAULT_POLICY_REFUND,
  DEFAULT_POLICY_NOTICE,
  DEFAULT_POLICY_FOOTNOTE,
} from '@/lib/policy-defaults';

/**
 * Renders admin-editable policy text: plain lines become paragraphs,
 * lines starting with "- " become gold-bulleted list items.
 */
function PolicyBody({ text }: { text: string }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks: Array<{ type: 'p'; text: string } | { type: 'ul'; items: string[] }> = [];

  lines.forEach((line) => {
    if (line.startsWith('- ')) {
      const item = line.slice(2).trim();
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'ul') {
        blocks[blocks.length - 1] = { type: 'ul', items: [...last.items, item] };
      } else {
        blocks.push({ type: 'ul', items: [item] });
      }
    } else {
      blocks.push({ type: 'p', text: line });
    }
  });

  return (
    <div className="space-y-4 text-gray-300 text-sm md:text-base leading-relaxed">
      {blocks.map((block, i) =>
        block.type === 'p' ? (
          <p key={i} className="text-center">{block.text}</p>
        ) : (
          <ul key={i} className="space-y-2 text-left max-w-xl mx-auto">
            {block.items.map((item, j) => (
              <li key={j} className="flex items-start gap-2">
                <span className="text-gold-400 mt-0.5">&bull;</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

export default function PolicyPage() {
  const { getSetting } = useCMS();

  const exchangeText = getSetting('policy_exchange') || DEFAULT_POLICY_EXCHANGE;
  const refundText = getSetting('policy_refund') || DEFAULT_POLICY_REFUND;
  const noticeText = getSetting('policy_notice') || DEFAULT_POLICY_NOTICE;
  const footnote = getSetting('policy_footnote') || DEFAULT_POLICY_FOOTNOTE;

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-gradient-to-br from-gray-50 via-white to-gold-50 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-serif font-bold text-gray-900 mb-4">Exchange &amp; Refund Policy</h1>
            <p className="text-lg text-gray-500">
              Please read our policy carefully before making a purchase.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16 space-y-10">

        {/* Exchange Policy */}
        <section className="bg-gray-900 text-white rounded-2xl p-8 md:p-10 animate-fade-in-up shadow-xl hover:shadow-2xl transition-shadow duration-300 border border-transparent hover:border-gold-500/20">
          <h2 className="text-xl md:text-2xl font-bold text-center tracking-wide uppercase mb-6">Exchange Policy</h2>
          <PolicyBody text={exchangeText} />
        </section>

        {/* Refund Policy */}
        <section className="bg-gray-900 text-white rounded-2xl p-8 md:p-10 animate-fade-in-up delay-100 shadow-xl hover:shadow-2xl transition-shadow duration-300 border border-transparent hover:border-gold-500/20">
          <h2 className="text-xl md:text-2xl font-bold text-center tracking-wide uppercase mb-6">Refund Policy</h2>
          <PolicyBody text={refundText} />
        </section>

        {/* Important Notice */}
        <section className="bg-gray-900 text-white rounded-2xl p-8 md:p-10 animate-fade-in-up delay-200 shadow-xl hover:shadow-2xl transition-shadow duration-300 border border-transparent hover:border-gold-500/20">
          <h2 className="text-xl md:text-2xl font-bold text-center tracking-wide uppercase mb-6">Important Notice</h2>
          <PolicyBody text={noticeText} />

          {footnote && (
            <p className="mt-8 text-center text-white font-bold text-sm md:text-base">
              {footnote}
            </p>
          )}
        </section>

        {/* Contact */}
        <section className="text-center py-4">
          <p className="text-gray-500 mb-4">Have questions about our policy?</p>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 text-gold-600 hover:text-gold-700 font-semibold transition-colors"
          >
            <i className="ri-customer-service-2-line"></i>
            Contact Us
          </Link>
        </section>

      </div>
    </div>
  );
}
