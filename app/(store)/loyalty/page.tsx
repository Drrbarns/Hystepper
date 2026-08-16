'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PageHero from '@/components/PageHero';
import { supabase } from '@/lib/supabase';
import { DEFAULT_PROMOTIONS, fetchStorePromotions, type StorePromotions } from '@/lib/promotions';

type LoyaltyTx = {
  id: string;
  amount: number;
  type: string;
  description: string;
  created_at: string;
};

export default function LoyaltyPage() {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [points, setPoints] = useState(0);
  const [lifetime, setLifetime] = useState(0);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<LoyaltyTx[]>([]);
  const [promo, setPromo] = useState<StorePromotions>({ ...DEFAULT_PROMOTIONS });

  useEffect(() => {
    async function load() {
      try {
        const promotions = await fetchStorePromotions();
        setPromo(promotions);

        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          setSignedIn(false);
          return;
        }
        setSignedIn(true);

        const [pointsRes, txRes] = await Promise.all([
          supabase
            .from('loyalty_points')
            .select('points, lifetime_earned, expires_at, updated_at')
            .eq('user_id', session.user.id)
            .single(),
          supabase
            .from('loyalty_transactions')
            .select('id, amount, type, description, created_at')
            .eq('user_id', session.user.id)
            .order('created_at', { ascending: false })
            .limit(20),
        ]);

        if (pointsRes.data) {
          setPoints(pointsRes.data.points || 0);
          setLifetime(pointsRes.data.lifetime_earned || 0);
          // Prefer live settings period over a stale stored expires_at
          const anchor = pointsRes.data.updated_at || pointsRes.data.expires_at;
          if (anchor && promotions.loyaltyExpiryMonths > 0) {
            const d = new Date(pointsRes.data.updated_at || Date.now());
            d.setMonth(d.getMonth() + promotions.loyaltyExpiryMonths);
            setExpiresAt(d.toISOString());
          } else {
            setExpiresAt(pointsRes.data.expires_at || null);
          }
        }
        if (txRes.data) setTransactions(txRes.data);
      } catch (err) {
        console.error('Failed to load loyalty data:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const threshold = promo.loyaltyMinRedeem;
  const pointValue = promo.loyaltyPointValueGhs;
  const pointsWorth = Math.round(points * pointValue * 100) / 100;
  const canRedeem = promo.loyaltyEnabled && points >= threshold;
  const pointsToGo = Math.max(0, threshold - points);
  const progress = threshold > 0 ? Math.min(100, Math.round((points / threshold) * 100)) : 100;

  const howItWorks = [
    {
      icon: 'ri-shopping-bag-3-line',
      title: `Earn ${promo.loyaltyPointsPerItem} point${promo.loyaltyPointsPerItem === 1 ? '' : 's'} per item`,
      text: `Every item you buy earns ${promo.loyaltyPointsPerItem} Sleek Point${promo.loyaltyPointsPerItem === 1 ? '' : 's'}. Points are credited to your account as soon as your order is delivered.`,
    },
    {
      icon: 'ri-coupon-3-line',
      title: `Redeem from ${threshold} points`,
      text: `Once you reach ${threshold} points, a “Use my points” toggle appears at checkout. Each point takes GH₵ ${pointValue} off your order.`,
    },
    {
      icon: 'ri-time-line',
      title: `Points last ${promo.loyaltyExpiryMonths} months`,
      text: `Points expire ${promo.loyaltyExpiryMonths} months after your most recent purchase — every new delivery extends them.`,
    },
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      <PageHero
        title="Sleek Points Rewards"
        subtitle="Shop, earn points, and save on your next order"
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
        {loading ? (
          <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
            <i className="ri-loader-4-line animate-spin text-3xl text-gold-600"></i>
          </div>
        ) : !promo.loyaltyEnabled ? (
          <div className="bg-white rounded-2xl shadow-sm p-10 text-center mb-12">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <i className="ri-pause-circle-line text-3xl text-gray-500"></i>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Sleek Points is paused</h2>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              The rewards programme is temporarily unavailable. Your existing balance is safe and will
              be ready when we turn it back on.
            </p>
            <Link href="/shop" className="px-6 py-3 bg-gray-900 text-white rounded-xl font-semibold hover:bg-gray-800 transition-colors inline-block">
              Continue Shopping
            </Link>
          </div>
        ) : !signedIn ? (
          <div className="bg-white rounded-2xl shadow-sm p-10 text-center mb-12">
            <div className="w-16 h-16 mx-auto mb-4 bg-gold-100 rounded-full flex items-center justify-center">
              <i className="ri-medal-line text-3xl text-gold-600"></i>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Sign in to see your points</h2>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              Sleek Points are tied to your account. Sign in (or create an account) to start
              earning {promo.loyaltyPointsPerItem} point{promo.loyaltyPointsPerItem === 1 ? '' : 's'} on every item you buy.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Link
                href="/auth/login?redirect=/loyalty"
                className="px-6 py-3 bg-gray-900 text-white rounded-xl font-semibold hover:bg-gray-800 transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/auth/signup"
                className="px-6 py-3 border-2 border-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-colors"
              >
                Create Account
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl shadow-lg p-8 text-white mb-8">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                <div>
                  <p className="text-gray-300 text-sm font-medium mb-1">Your balance</p>
                  <p className="text-5xl font-bold">
                    {points}
                    <span className="text-xl font-semibold text-gold-400 ml-2">Sleek Points</span>
                  </p>
                  <p className="text-gray-400 text-sm mt-2">
                    Worth GH₵ {pointsWorth.toFixed(2)} at checkout · {lifetime} earned all-time
                    {expiresAt && (
                      <> · expire {new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</>
                    )}
                  </p>
                </div>
                <div className="md:text-right">
                  {canRedeem ? (
                    <>
                      <span className="inline-flex items-center gap-2 bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-4 py-2 rounded-full text-sm font-semibold mb-3">
                        <i className="ri-checkbox-circle-fill"></i> Ready to redeem
                      </span>
                      <p className="text-sm text-gray-300">
                        Flip the <span className="font-semibold text-white">“Use my points”</span> toggle at checkout
                        to take GH₵ {pointsWorth.toFixed(2)} off.
                      </p>
                    </>
                  ) : (
                    <>
                      <span className="inline-flex items-center gap-2 bg-amber-500/20 text-amber-300 border border-amber-400/30 px-4 py-2 rounded-full text-sm font-semibold mb-3">
                        <i className="ri-lock-line"></i> {pointsToGo} more point{pointsToGo === 1 ? '' : 's'} to unlock
                      </span>
                      <p className="text-sm text-gray-300">
                        Redemption unlocks at {threshold} points.
                      </p>
                    </>
                  )}
                </div>
              </div>

              {!canRedeem && (
                <div className="mt-6">
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gold-500 rounded-full transition-all"
                      style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">{points} / {threshold} points</p>
                </div>
              )}
            </div>

            <div className="bg-gold-50 border border-gold-200 rounded-xl p-4 mb-12 text-sm text-gray-700 flex items-start gap-3">
              <i className="ri-information-line text-gold-600 text-lg mt-0.5"></i>
              <p>
                Points can&apos;t be combined with a coupon code on the same order, and each point is worth
                GH₵ {pointValue} off your items subtotal. Redeeming points also pauses delivery fee discounts
                for that order. Points are earned on items only (not delivery fees) and
                only after your order is delivered.
              </p>
            </div>
          </>
        )}

        {/* How it works — always show when programme is on */}
        {promo.loyaltyEnabled && (
          <div className="mb-12">
            <h2 className="text-xl font-bold text-gray-900 mb-6">How it works</h2>
            <div className="grid sm:grid-cols-3 gap-4">
              {howItWorks.map((item) => (
                <div key={item.title} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                  <div className="w-10 h-10 rounded-full bg-gold-100 text-gold-700 flex items-center justify-center mb-3">
                    <i className={`${item.icon} text-xl`}></i>
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-1">{item.title}</h3>
                  <p className="text-sm text-gray-600">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {signedIn && promo.loyaltyEnabled && !loading && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-12">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Points Activity</h2>
            </div>
            {transactions.length === 0 ? (
              <p className="p-6 text-sm text-gray-500">No points activity yet. Place an order and we&apos;ll credit you when it&apos;s delivered.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {transactions.map((tx) => (
                  <li key={tx.id} className="px-6 py-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{tx.description || tx.type}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {new Date(tx.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <span className={`font-semibold ${tx.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {tx.amount >= 0 ? '+' : ''}{tx.amount}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {promo.loyaltyEnabled && (
          <div className="text-center">
            <Link href="/shop" className="inline-flex items-center gap-2 px-6 py-3 bg-gold-600 hover:bg-gold-700 text-white rounded-xl font-semibold transition-colors">
              Shop to earn points <i className="ri-arrow-right-line"></i>
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
