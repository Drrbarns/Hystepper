'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import MiniCart from './MiniCart';
import { useCart } from '@/context/CartContext';
import { supabase } from '@/lib/supabase';
import { useCMS } from '@/context/CMSContext';
import AnnouncementBar from './AnnouncementBar';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';

export default function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  useBodyScrollLock(isMobileMenuOpen || isSearchOpen);
  const [searchQuery, setSearchQuery] = useState('');
  const [wishlistCount, setWishlistCount] = useState(0);
  const [user, setUser] = useState<any>(null);
  const [scrolled, setScrolled] = useState(false);

  const { cartCount, isCartOpen, setIsCartOpen } = useCart();
  const { getSetting } = useCMS();

  const siteName = getSetting('site_name') || 'Hy-Stepper';

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const updateWishlistCount = () => {
      const wishlist = JSON.parse(localStorage.getItem('wishlist') || '[]');
      setWishlistCount(wishlist.length);
    };

    updateWishlistCount();
    window.addEventListener('wishlistUpdated', updateWishlistCount);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      window.removeEventListener('wishlistUpdated', updateWishlistCount);
      subscription.unsubscribe();
    };
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/shop?search=${encodeURIComponent(searchQuery)}`;
    }
  };

  return (
    <>
      <AnnouncementBar />

      <header className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? 'bg-white/95 backdrop-blur-md shadow-sm border-b border-gray-100' : 'bg-white border-b border-transparent'}`}>
        <nav aria-label="Main navigation" className="relative">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-20">
              
              {/* Left: Mobile Menu & Logo (Mobile) / Logo (Desktop) */}
              <div className="flex items-center gap-4 lg:gap-0">
                <button
                  className="lg:hidden p-2 -ml-2 text-gray-900 hover:text-gold-600 transition-colors"
                  onClick={() => setIsMobileMenuOpen(true)}
                  aria-label="Open menu"
                >
                  <i className="ri-menu-line text-2xl"></i>
                </button>
                
                <Link
                  href="/"
                  className="flex items-center group"
                  aria-label="Go to homepage"
                >
                  <span className="font-serif text-2xl font-bold tracking-tight text-gray-900 group-hover:text-gold-600 transition-colors">
                    {siteName}
                  </span>
                  {/* <img src="/logo-new.png" alt={siteName} className="h-8 md:h-10 w-auto object-contain" /> */}
                </Link>
              </div>

              {/* Center: Desktop Navigation */}
              <div className="hidden lg:flex items-center justify-center space-x-10">
                {[
                  { label: 'Home', href: '/' },
                  { label: 'Shop', href: '/shop' },
                  { label: 'New Arrivals', href: '/shop?sort=new' },
                  { label: 'About', href: '/about' },
                  { label: 'Contact', href: '/contact' },
                ].map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="text-sm font-medium text-gray-700 hover:text-gold-600 transition-colors relative group py-2"
                  >
                    {link.label}
                    <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-gold-600 transition-all duration-300 group-hover:w-full"></span>
                  </Link>
                ))}
              </div>

              {/* Right: Icons */}
              <div className="flex items-center space-x-1 sm:space-x-3">
                
                {/* Search */}
                <button
                  className="p-2 text-gray-700 hover:text-gold-600 transition-colors hover:bg-gray-50 rounded-full"
                  onClick={() => setIsSearchOpen(true)}
                  aria-label="Search"
                >
                  <i className="ri-search-line text-xl"></i>
                </button>

                {/* User Account */}
                <Link
                  href={user ? "/account" : "/auth/login"}
                  className="hidden sm:flex p-2 text-gray-700 hover:text-gold-600 transition-colors hover:bg-gray-50 rounded-full"
                  aria-label={user ? "My Account" : "Login"}
                >
                  <i className={`${user ? 'ri-user-smile-line' : 'ri-user-line'} text-xl`}></i>
                </Link>

                {/* Wishlist */}
                <Link
                  href="/wishlist"
                  className="hidden sm:flex p-2 text-gray-700 hover:text-gold-600 transition-colors hover:bg-gray-50 rounded-full relative"
                  aria-label="Wishlist"
                >
                  <i className="ri-heart-line text-xl"></i>
                  {wishlistCount > 0 && (
                    <span className="absolute top-1 right-1 w-2 h-2 bg-gold-500 rounded-full ring-2 ring-white"></span>
                  )}
                </Link>

                {/* Cart */}
                <div className="relative">
                  <button
                    className="p-2 text-gray-700 hover:text-gold-600 transition-colors hover:bg-gray-50 rounded-full relative"
                    onClick={() => setIsCartOpen(!isCartOpen)}
                    aria-label="Cart"
                  >
                    <i className="ri-shopping-bag-line text-xl"></i>
                    {cartCount > 0 && (
                      <span className="absolute top-0 right-0 w-4 h-4 bg-gold-600 text-[10px] font-bold text-white flex items-center justify-center rounded-full ring-2 ring-white">
                        {cartCount}
                      </span>
                    )}
                  </button>
                  <MiniCart isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
                </div>
              </div>

            </div>
          </div>
        </nav>
      </header>

      {/* Full Screen Search Overlay */}
      {isSearchOpen && (
        <div className="fixed inset-0 bg-white/95 backdrop-blur-sm z-[60] animate-in fade-in duration-200 overflow-y-auto overscroll-contain">
          <div className="max-w-4xl mx-auto px-4 pt-32 pb-16">
            <div className="relative">
              <button
                onClick={() => setIsSearchOpen(false)}
                className="absolute -top-16 right-0 p-2 text-gray-500 hover:text-gray-900 transition-colors"
              >
                <i className="ri-close-line text-3xl"></i>
              </button>
              
              <form onSubmit={handleSearch} className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search for..."
                  className="w-full text-4xl md:text-5xl font-serif border-b-2 border-gray-200 py-4 bg-transparent focus:outline-none focus:border-gold-500 placeholder-gray-300 text-gray-900 transition-colors"
                  autoFocus
                />
                <button
                  type="submit"
                  className="absolute right-0 top-1/2 -translate-y-1/2 p-4 text-gray-400 hover:text-gold-600 transition-colors"
                >
                  <i className="ri-arrow-right-line text-3xl"></i>
                </button>
              </form>

              <div className="mt-8">
                <p className="text-sm text-gray-500 uppercase tracking-widest mb-4">Popular Searches</p>
                <div className="flex flex-wrap gap-3">
                  {/* Each suggestion routes to a destination that actually
                      returns results: text search, newest sort, or the sale
                      page — no dead-end chips. */}
                  {[
                    { label: 'Heels', href: '/shop?search=Heels' },
                    { label: 'Bags', href: '/shop?category=bags-handbags' },
                    { label: 'New Arrivals', href: '/shop?sort=new' },
                    { label: 'Sale', href: '/sale' },
                  ].map((term) => (
                    <button
                      key={term.label}
                      onClick={() => {
                        setIsSearchOpen(false);
                        window.location.href = term.href;
                      }}
                      className="px-4 py-2 bg-gray-50 hover:bg-gray-100 rounded-full text-sm text-gray-700 transition-colors"
                    >
                      {term.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Menu Drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-[100] lg:hidden">
          <div
            className="absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute top-0 left-0 bottom-0 w-[85%] max-w-sm bg-white shadow-2xl flex flex-col animate-in slide-in-from-left duration-300">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <span className="font-serif text-xl font-bold text-gray-900">{siteName}</span>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 -mr-2 text-gray-500 hover:text-gray-900 transition-colors"
              >
                <i className="ri-close-line text-2xl"></i>
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-6 py-8 space-y-6">
              <div className="space-y-4">
                {[
                  { label: 'Home', href: '/' },
                  { label: 'Shop', href: '/shop' },
                  { label: 'Categories', href: '/categories' },
                  { label: 'New Arrivals', href: '/shop?sort=new' },
                  { label: 'Sale', href: '/sale' },
                  { label: 'About Us', href: '/about' },
                  { label: 'Contact', href: '/contact' },
                ].map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="block text-2xl font-serif text-gray-900 hover:text-gold-600 transition-colors"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>

              <div className="h-px bg-gray-100"></div>

              <div className="space-y-3">
                {[
                  { label: 'My Account', href: '/account', icon: 'ri-user-line' },
                  { label: 'Wishlist', href: '/wishlist', icon: 'ri-heart-line' },
                  { label: 'Track Order', href: '/account?tab=orders', icon: 'ri-truck-line' },
                ].map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex items-center gap-3 text-base font-medium text-gray-600 hover:text-gray-900 transition-colors"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <i className={`${link.icon} text-lg`}></i>
                    {link.label}
                  </Link>
                ))}
              </div>
            </nav>

            <div className="p-6 bg-gray-50">
              <p className="text-xs text-gray-400 text-center">
                &copy; {new Date().getFullYear()} {siteName}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
