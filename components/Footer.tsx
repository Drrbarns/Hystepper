"use client";

import Link from 'next/link';
import { useState } from 'react';
import { useCMS } from '@/context/CMSContext';

export default function Footer() {
  const { getSetting } = useCMS();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleaned)) {
      setSubmitStatus('error');
      return;
    }
    setIsSubmitting(true);
    setSubmitStatus('idle');

    try {
      // Server route uses the admin DB client (bypasses PostgREST RLS/RETURNING
      // quirks that broke anonymous footer sign-ups on plain Postgres).
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleaned, source: 'footer' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Subscribe failed');
      setSubmitStatus('success');
      setEmail('');
    } catch (error) {
      console.error('Newsletter subscribe failed:', error);
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const siteName = getSetting('site_name') || 'Hy-Stepper';
  const siteTagline = getSetting('site_tagline') || 'Stay sleek in style';
  const contactEmail = getSetting('contact_email')?.replace(/^['"]+|['"]+$/g, '').trim() || 'info@hystepper.com';
  const contactPhone = getSetting('contact_phone')?.replace(/^['"]+|['"]+$/g, '').trim() || '0276558163';
  const socialInstagram = getSetting('social_instagram') || '';
  const socialFacebook = getSetting('social_facebook') || '';
  const socialTiktok = getSetting('social_tiktok') || '';

  return (
    <footer className="bg-gray-900 text-gray-300 mt-8 lg:mt-0 overflow-hidden">

      {/* Newsletter Strip */}
      <div className="bg-gradient-to-r from-gold-600 to-gold-500">
        <div className="max-w-7xl mx-auto px-6 py-8 md:py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-center md:text-left">
              <h3 className="text-xl md:text-2xl font-bold text-white mb-1 font-serif">Stay in the Loop</h3>
              <p className="text-white/80 text-sm">Be the first to know about new arrivals & exclusive offers.</p>
            </div>
            <form onSubmit={handleSubmit} className="w-full md:w-auto flex gap-2">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Your email address"
                className="flex-1 md:w-72 px-5 py-3 bg-white/20 backdrop-blur-sm border border-white/30 rounded-full text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/50 focus:bg-white/30 transition-all text-sm"
              />
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-gray-900 hover:bg-gray-800 text-white font-semibold px-6 py-3 rounded-full transition-all disabled:opacity-75 text-sm whitespace-nowrap"
              >
                {isSubmitting ? '...' : 'Subscribe'}
              </button>
            </form>
          </div>
          {submitStatus === 'success' && (
            <p className="text-white text-sm mt-3 text-center md:text-right">
              <i className="ri-checkbox-circle-line mr-1 align-middle"></i> You&apos;re on the list!
            </p>
          )}
          {submitStatus === 'error' && (
            <p className="text-white text-sm mt-3 text-center md:text-right">
              <i className="ri-error-warning-line mr-1 align-middle"></i> Couldn&apos;t subscribe right now — check your email and try again.
            </p>
          )}
        </div>
      </div>

      {/* Main Footer */}
      <div className="max-w-7xl mx-auto px-6 py-14">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-12">

          {/* Brand */}
          <div className="space-y-5">
            <Link href="/" className="inline-block group">
              <img
                src="/brand/hy-stepper-logo-light.png?v=20260813"
                alt={siteName}
                className="h-12 w-auto max-w-[200px] object-contain"
                width={200}
                height={141}
              />
            </Link>
            <p className="text-gray-400 leading-relaxed text-sm">
              {siteTagline}
            </p>

            <div className="flex gap-3 pt-1">
              {socialInstagram && (
                <a
                  href={socialInstagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center text-gray-400 hover:bg-gold-500 hover:text-white transition-all"
                  aria-label="Instagram"
                >
                  <i className="ri-instagram-line text-lg"></i>
                </a>
              )}
              {socialFacebook && (
                <a
                  href={socialFacebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center text-gray-400 hover:bg-gold-500 hover:text-white transition-all"
                  aria-label="Facebook"
                >
                  <i className="ri-facebook-fill text-lg"></i>
                </a>
              )}
              {socialTiktok && (
                <a
                  href={socialTiktok}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center text-gray-400 hover:bg-gold-500 hover:text-white transition-all"
                  aria-label="TikTok"
                >
                  <i className="ri-tiktok-fill text-lg"></i>
                </a>
              )}
            </div>
          </div>

          {/* Shop Links */}
          <div>
            <h4 className="font-bold text-white text-sm uppercase tracking-wider mb-5">Shop</h4>
            <ul className="space-y-3 text-sm">
              <li><Link href="/shop" className="text-gray-400 hover:text-gold-400 transition-colors">All Products</Link></li>
              <li><Link href="/categories" className="text-gray-400 hover:text-gold-400 transition-colors">Categories</Link></li>
              <li><Link href="/shop?sort=new" className="text-gray-400 hover:text-gold-400 transition-colors">New Arrivals</Link></li>
              <li><Link href="/sale" className="text-gray-400 hover:text-gold-400 transition-colors">Sale</Link></li>
            </ul>
          </div>

          {/* Support */}
          <div>
            <h4 className="font-bold text-white text-sm uppercase tracking-wider mb-5">Support</h4>
            <ul className="space-y-3 text-sm">
              <li><Link href="/contact" className="text-gray-400 hover:text-gold-400 transition-colors">Contact Us</Link></li>
              <li><Link href="/account?tab=orders" className="text-gray-400 hover:text-gold-400 transition-colors">Track My Order</Link></li>
              <li><Link href="/shipping" className="text-gray-400 hover:text-gold-400 transition-colors">Shipping Info</Link></li>
              <li><Link href="/policy" className="text-gray-400 hover:text-gold-400 transition-colors">Exchange & Refund Policy</Link></li>
            </ul>
          </div>

          {/* Company + Contact */}
          <div>
            <h4 className="font-bold text-white text-sm uppercase tracking-wider mb-5">Company</h4>
            <ul className="space-y-3 text-sm mb-6">
              <li><Link href="/about" className="text-gray-400 hover:text-gold-400 transition-colors">Our Story</Link></li>
              <li><Link href="/privacy" className="text-gray-400 hover:text-gold-400 transition-colors">Privacy Policy</Link></li>
              <li><Link href="/terms" className="text-gray-400 hover:text-gold-400 transition-colors">Terms of Service</Link></li>
            </ul>

            {/* Contact Info */}
            <div className="space-y-2 pt-4 border-t border-gray-800">
              {contactPhone && (
                <a href={`tel:${contactPhone}`} className="flex items-center gap-2 text-gray-400 hover:text-gold-400 transition-colors text-sm">
                  <i className="ri-phone-line text-gold-500"></i> {contactPhone}
                </a>
              )}
              {contactEmail && (
                <a href={`mailto:${contactEmail}`} className="flex items-center gap-2 text-gray-400 hover:text-gold-400 transition-colors text-sm">
                  <i className="ri-mail-line text-gold-500"></i> {contactEmail}
                </a>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col md:flex-row justify-between items-center gap-3">
          <p className="text-xs text-gray-500">&copy; {new Date().getFullYear()} {siteName}. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <div className="flex gap-3 text-gray-600">
              <i className="ri-visa-line text-xl"></i>
              <i className="ri-mastercard-line text-xl"></i>
            </div>
            <a
              href="https://doctorbarns.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-600 hover:text-gold-400 transition-colors"
            >
              Powered by Doctor Barns Tech
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
