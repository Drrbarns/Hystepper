'use client';

import Link from 'next/link';
import { useCMS } from '@/context/CMSContext';
import {
  DEFAULT_POLICY_EXCHANGE,
  DEFAULT_POLICY_REFUND,
  DEFAULT_POLICY_NOTICE,
  DEFAULT_POLICY_FOOTNOTE,
} from '@/lib/policy-defaults';
import PolicyContent from '@/components/policy/PolicyContent';

export default function PolicyPage() {
  const { getSetting } = useCMS();

  const exchangeText = getSetting('policy_exchange') || DEFAULT_POLICY_EXCHANGE;
  const refundText = getSetting('policy_refund') || DEFAULT_POLICY_REFUND;
  const noticeText = getSetting('policy_notice') || DEFAULT_POLICY_NOTICE;
  const footnote = getSetting('policy_footnote') || DEFAULT_POLICY_FOOTNOTE;
  const footnotePlain = footnote.replace(/<[^>]+>/g, '').trim();

  return (
    <div className="min-h-screen bg-white">
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
        <section className="bg-gray-900 text-white rounded-2xl p-8 md:p-10 animate-fade-in-up shadow-xl hover:shadow-2xl transition-shadow duration-300 border border-transparent hover:border-gold-500/20">
          <h2 className="text-xl md:text-2xl font-bold text-center tracking-wide uppercase mb-6">Exchange Policy</h2>
          <PolicyContent text={exchangeText} />
        </section>

        <section className="bg-gray-900 text-white rounded-2xl p-8 md:p-10 animate-fade-in-up delay-100 shadow-xl hover:shadow-2xl transition-shadow duration-300 border border-transparent hover:border-gold-500/20">
          <h2 className="text-xl md:text-2xl font-bold text-center tracking-wide uppercase mb-6">Refund Policy</h2>
          <PolicyContent text={refundText} />
        </section>

        <section className="bg-gray-900 text-white rounded-2xl p-8 md:p-10 animate-fade-in-up delay-200 shadow-xl hover:shadow-2xl transition-shadow duration-300 border border-transparent hover:border-gold-500/20">
          <h2 className="text-xl md:text-2xl font-bold text-center tracking-wide uppercase mb-6">Important Notice</h2>
          <PolicyContent text={noticeText} />

          {footnotePlain && (
            <p className="mt-8 text-center text-white font-bold text-sm md:text-base">
              {footnotePlain}
            </p>
          )}
        </section>

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
