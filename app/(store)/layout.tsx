'use client';

import dynamic from 'next/dynamic';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import MobileBottomNav from '@/components/MobileBottomNav';
import { CMSProvider } from '@/context/CMSContext';

const WhatsAppButton = dynamic(() => import('@/components/WhatsAppButton'), { ssr: false });
const OfflineIndicator = dynamic(() => import('@/components/OfflineIndicator'), { ssr: false });
const TrackingScripts = dynamic(() => import('@/components/TrackingScripts'), { ssr: false });
const WelcomePopup = dynamic(() => import('@/components/WelcomePopup'), { ssr: false });

export default function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CMSProvider>
      <div className="min-h-screen bg-gray-50 pb-20 lg:pb-0">
        <Header />
        {children}
        <Footer />
        <MobileBottomNav />
        <OfflineIndicator />
        <WhatsAppButton />
        <TrackingScripts />
        <WelcomePopup />
      </div>
    </CMSProvider>
  );
}
