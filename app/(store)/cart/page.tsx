'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import CartCountdown from '@/components/CartCountdown';
// import CartSuggestions from '@/components/CartSuggestions'; // Removed demo suggestions
import AdvancedCouponSystem from '@/components/AdvancedCouponSystem';
// import FreeShippingBar from '@/components/FreeShippingBar';
import { useCart } from '@/context/CartContext';
import PageHero from '@/components/PageHero';

export default function CartPage() {
  const { cart: cartItems, removeFromCart, updateQuantity, subtotal, addToCart, revalidateCart } = useCart();

  // Re-check stock + product status every time the cart page is opened.
  // The cart provider already runs revalidation on initial app load + on
  // window focus, but a customer who navigates to /cart from another tab
  // route would otherwise see whatever was in localStorage from minutes
  // (or hours) ago.
  useEffect(() => {
    void revalidateCart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);
  const [savedItems, setSavedItems] = useState<any[]>([]);

  // Function to move item to saved for later (local state only for now)
  const saveForLater = (id: string) => {
    const item = cartItems.find(item => item.id === id);
    if (item) {
      setSavedItems([...savedItems, item]);
      removeFromCart(item.id, item.variant); // Use context's removeFromCart
    }
  };

  const moveToCart = (id: string) => {
    const item = savedItems.find(item => item.id === id);
    if (item) {
      // Assuming addToCart can handle adding an existing item back
      // and that the item structure from savedItems is compatible with addToCart
      addToCart(item, item.quantity); // Add item back to cart
      setSavedItems(savedItems.filter(item => item.id !== id)); // Remove from saved items
    }
  };

  const applyCoupon = (coupon: any) => {
    setAppliedCoupon(coupon);
  };

  const removeCoupon = () => {
    setAppliedCoupon(null);
  };

  // Savings calculation is tricky without originalPrice in Context.
  // Assuming 0 for now unless we update Context.
  const savings = 0;

  let couponDiscount = 0;
  if (appliedCoupon) {
    if (appliedCoupon.type === 'percentage') {
      couponDiscount = subtotal * (appliedCoupon.discount / 100);
    } else {
      couponDiscount = appliedCoupon.discount;
    }
  }

  const total = subtotal - couponDiscount;

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHero title="Shopping Cart" />
      <div className="py-8 sm:py-12 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        <CartCountdown />
        {/* <FreeShippingBar currentAmount={subtotal} threshold={200} /> */}

        {cartItems.length === 0 && savedItems.length === 0 ? (
          <section className="py-20">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center">
              <div className="w-24 h-24 flex items-center justify-center mx-auto mb-6 bg-gray-200 rounded-full">
                <i className="ri-shopping-cart-line text-5xl text-gray-400"></i>
              </div>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">Your cart is empty</h2>
              <p className="text-gray-600 mb-8 text-lg">Looks like you haven&apos;t added anything to your cart yet</p>
              <Link href="/shop" className="inline-block bg-gray-900 hover:bg-gold-600 text-white px-8 py-4 rounded-lg font-semibold transition-colors whitespace-nowrap">
                Continue Shopping
              </Link>
            </div>
          </section>
        ) : (
          <section className="py-12">
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
              <div className="grid lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white rounded-xl shadow-sm p-6 overflow-hidden">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-2xl font-bold text-gray-900">Cart Items ({cartItems.length})</h2>
                      {savings > 0 && (
                        <span className="text-gold-700 font-semibold">You save GH₵{savings.toFixed(2)}</span>
                      )}
                    </div>

                    <div className="space-y-6">
                      {cartItems.map((item) => (
                        <div key={`${item.id}-${item.variant || ''}`} className="flex flex-col sm:flex-row gap-4 sm:gap-6 pb-6 border-b border-gray-200 last:border-0 last:pb-0">
                          <Link href={`/product/${item.slug || item.id}`} className="w-full sm:w-32 h-48 sm:h-32 flex-shrink-0 bg-gray-100 rounded-lg overflow-hidden">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={item.image || '/placeholder-product.png'} alt={item.name || 'Product'} className="w-full h-full object-cover object-top" loading="lazy" />
                          </Link>

                          <div className="flex-1">
                            <div className="flex justify-between mb-2">
                              <Link href={`/product/${item.slug || item.id}`} className="text-lg font-semibold text-gray-900 hover:text-gold-600 transition-colors line-clamp-2">
                                {item.name}
                              </Link>
                              <button
                                onClick={() => removeFromCart(item.id, item.variant)}
                                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-600 transition-colors"
                              >
                                <i className="ri-close-line text-xl"></i>
                              </button>
                            </div>

                            <div className="text-sm text-gray-600 mb-3 space-y-1">
                              {item.variant && <p>Variant: {item.variant}</p>}
                              {item.maxStock > 0 && item.maxStock <= 10 ? (
                                <p className="text-amber-600 font-medium">Only {item.maxStock} in stock</p>
                              ) : item.maxStock > 10 ? (
                                <p className="text-gold-600 font-medium">In Stock</p>
                              ) : (
                                <p className="text-red-600 font-medium">Out of Stock</p>
                              )}
                            </div>

                            <div className="flex items-center justify-between flex-wrap gap-4">
                              <div className="flex items-baseline space-x-3">
                                <span className="text-xl font-bold text-gray-900">GH₵{(Number(item.price) || 0).toFixed(2)}</span>
                              </div>

                              <div className="flex items-center space-x-4">
                                <div className="flex items-center border-2 border-gray-300 rounded-lg">
                                  <button
                                    onClick={() => updateQuantity(item.id, item.quantity - 1, item.variant)}
                                    className="w-10 h-10 flex items-center justify-center text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    disabled={item.quantity <= 1}
                                  >
                                    <i className="ri-subtract-line"></i>
                                  </button>
                                  <input
                                    type="number"
                                    value={item.quantity}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value) || 1;
                                      updateQuantity(item.id, Math.min(val, item.maxStock ?? 999), item.variant);
                                    }}
                                    className="w-12 h-10 text-center border-x-2 border-gray-300 focus:outline-none font-semibold"
                                    min="1"
                                    max={item.maxStock ?? 999}
                                  />
                                  <button
                                    onClick={() => updateQuantity(item.id, item.quantity + 1, item.variant)}
                                    className="w-10 h-10 flex items-center justify-center text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    disabled={item.quantity >= (item.maxStock ?? 999)}
                                  >
                                    <i className="ri-add-line"></i>
                                  </button>
                                </div>
                              </div>
                            </div>
                            {item.quantity >= (item.maxStock ?? 999) && (item.maxStock ?? 999) < 999 && (
                              <p className="text-xs text-amber-600 mt-1 font-medium">Max stock reached</p>
                            )}

                            {/* Saved for later functionality temporarily disabled until fully implemented with Context integration if requested */}
                            {/*
                            <button
                              onClick={() => saveForLater(item.id)}
                              className="mt-3 text-sm text-emerald-700 hover:text-emerald-900 font-medium whitespace-nowrap"
                            >
                              Save for Later
                            </button>
                            */}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {savedItems.length > 0 && (
                    <div className="bg-white rounded-xl shadow-sm p-6">
                      <h3 className="text-xl font-bold text-gray-900 mb-4">Saved for Later ({savedItems.length})</h3>
                      <div className="space-y-4">
                        {savedItems.map((item) => (
                          <div key={item.id} className="flex gap-4 pb-4 border-b border-gray-200 last:border-0 last:pb-0">
                            <div className="w-20 h-20 flex-shrink-0 bg-gray-100 rounded-lg overflow-hidden">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={item.image || '/placeholder-product.png'} alt={item.name || 'Product'} className="w-full h-full object-cover object-top" loading="lazy" />
                            </div>
                            <div className="flex-1">
                              <p className="font-semibold text-gray-900 mb-1">{item.name}</p>
                              <p className="text-lg font-bold text-gray-900 mb-2">GH₵{item.price.toFixed(2)}</p>
                              {/* Move to cart disabled for now */}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  <div className="bg-white rounded-xl shadow-sm p-6 lg:sticky lg:top-24">
                    <h3 className="text-xl font-bold text-gray-900 mb-6">Order Summary</h3>

                    <div className="space-y-4 mb-6">
                      <div className="flex justify-between text-gray-700">
                        <span>Subtotal</span>
                        <span className="font-semibold">GH₵{subtotal.toFixed(2)}</span>
                      </div>

                      {appliedCoupon && (
                        <div className="flex justify-between text-gold-700">
                          <div className="flex items-center space-x-2">
                            <span>Coupon ({appliedCoupon.code})</span>
                          </div>
                          <span className="font-semibold">-GH₵{couponDiscount.toFixed(2)}</span>
                        </div>
                      )}

                      <div className="flex justify-between text-gray-700">
                        <span>Shipping</span>
                        <span className="font-semibold text-gray-500 italic">Calculated at checkout</span>
                      </div>
                    </div>

                    <div className="border-t border-gray-200 pt-4 mb-6">
                      <div className="flex justify-between text-xl font-bold text-gray-900">
                        <span>Total</span>
                        <span>GH₵{total.toFixed(2)}</span>
                      </div>
                    </div>

                    <AdvancedCouponSystem
                      subtotal={subtotal}
                      onApply={applyCoupon}
                      onRemove={removeCoupon}
                      appliedCoupon={appliedCoupon}
                    />

                    <Link
                      href="/checkout"
                      className="block w-full bg-gold-600 hover:bg-gold-700 text-white py-4 rounded-lg font-semibold text-center transition-colors mt-6 mb-3"
                    >
                      Proceed to Checkout
                    </Link>

                    <Link
                      href="/shop"
                      className="block w-full text-center text-gold-600 hover:text-gold-700 font-semibold py-2"
                    >
                      Continue Shopping
                    </Link>

                    <div className="mt-6 pt-6 border-t border-gray-200 space-y-3">
                      <div className="flex items-center text-sm text-gray-600">
                        <i className="ri-shield-check-line text-gold-600 mr-2"></i>
                        <span>Secure checkout</span>
                      </div>
                      <div className="flex items-center text-sm text-gray-600">
                        <i className="ri-arrow-left-right-line text-gold-600 mr-2"></i>
                        <span>Exchange within 24 hours</span>
                      </div>
                      <div className="flex items-center text-sm text-gray-600">
                        <i className="ri-customer-service-line text-gold-600 mr-2"></i>
                        <span>Friendly support</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
