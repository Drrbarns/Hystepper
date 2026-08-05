'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useCart } from '@/context/CartContext';
import { productImageSrc } from '@/lib/media-url';

interface MiniCartProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MiniCart({ isOpen, onClose }: MiniCartProps) {
  const { cart, removeFromCart, updateQuantity, subtotal } = useCart();

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-gray-900/50 z-40"
        onClick={onClose}
      ></div>

      <div className="fixed top-0 bottom-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col animate-[slideIn_0.25s_ease-out]"
        style={{ height: '100dvh' }}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-xl font-bold text-gray-900">
            Shopping Cart ({cart.reduce((sum, i) => sum + i.quantity, 0)})
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
          >
            <i className="ri-close-line text-2xl text-gray-700"></i>
          </button>
        </div>

        {cart.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-24 h-24 flex items-center justify-center bg-gray-100 rounded-full mb-4">
              <i className="ri-shopping-cart-line text-5xl text-gray-400"></i>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Your cart is empty</h3>
            <p className="text-gray-600 mb-6">Add items to get started</p>
            <Link
              href="/shop"
              onClick={onClose}
              className="px-6 py-3 bg-gold-600 text-white rounded-lg font-semibold hover:bg-gold-700 transition-colors whitespace-nowrap cursor-pointer"
            >
              Continue Shopping
            </Link>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                {cart.map((item) => (
                  <div key={`${item.id}-${item.variant}`} className="flex space-x-4 bg-gray-50 rounded-lg p-4">
                    <div className="w-20 h-20 bg-white rounded-lg overflow-hidden flex-shrink-0 border border-gray-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={productImageSrc(item.image || '/placeholder-product.png', { width: 160 })}
                        alt={item.name || 'Product'}
                        className="w-full h-full object-cover object-center"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 mb-1 line-clamp-1">{item.name}</h3>
                      {item.variant && (
                        <p className="text-xs text-gray-600 mb-2">
                          Variant: {item.variant}
                        </p>
                      )}

                      <div className="flex items-center justify-between mt-2">
                        <span className="text-lg font-bold text-gold-700">
                          GH₵{(Number(item.price) || 0).toFixed(2)}
                        </span>

                        <div className="flex items-center border border-gray-300 rounded bg-white">
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity - 1, item.variant)}
                            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 transition-colors cursor-pointer"
                            disabled={item.quantity <= 1}
                          >
                            <i className="ri-subtract-line text-gray-700"></i>
                          </button>
                          <span className="w-10 text-center font-semibold text-gray-900">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity + 1, item.variant)}
                            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 transition-colors cursor-pointer"
                            disabled={item.quantity >= (item.maxStock ?? 999)}
                          >
                            <i className="ri-add-line text-gray-700"></i>
                          </button>
                        </div>
                      </div>
                      {item.quantity >= (item.maxStock ?? 999) && (
                        <p className="text-xs text-amber-600 mt-1">Max stock reached</p>
                      )}
                    </div>

                    <button
                      onClick={() => removeFromCart(item.id, item.variant)}
                      className="w-8 h-8 flex items-center justify-center hover:bg-red-50 rounded-full transition-colors flex-shrink-0 cursor-pointer"
                    >
                      <i className="ri-delete-bin-line text-red-600"></i>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-200 p-6 bg-gray-50 flex-shrink-0">
              <div className="flex items-center justify-between mb-4">
                <span className="text-gray-700 font-medium">Subtotal</span>
                <span className="text-2xl font-bold text-gray-900">GH₵{(Number(subtotal) || 0).toFixed(2)}</span>
              </div>

              <p className="text-sm text-gray-600 mb-4 text-center">
                Shipping calculated at checkout
              </p>

              <div className="space-y-3">
                <Link
                  href="/checkout"
                  onClick={onClose}
                  className="block w-full py-4 bg-gold-600 text-white text-center rounded-lg font-semibold hover:bg-gold-700 transition-colors whitespace-nowrap cursor-pointer"
                >
                  Proceed to Checkout
                </Link>
                <Link
                  href="/cart"
                  onClick={onClose}
                  className="block w-full py-4 border-2 border-gray-900 text-gray-900 text-center rounded-lg font-semibold hover:bg-gray-50 transition-colors whitespace-nowrap cursor-pointer"
                >
                  View Cart
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
