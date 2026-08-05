import { productImageSrc } from '@/lib/media-url';

interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
  variant?: string;
}

interface OrderSummaryProps {
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  payableNow?: number;
  payLater?: number;
  discount?: number;
}

export default function OrderSummary({ items, subtotal, shipping, tax, total, payableNow, payLater, discount = 0 }: OrderSummaryProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6 sticky top-4">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Order Summary</h2>

      <div className="space-y-4 mb-6 max-h-96 overflow-y-auto pr-2">
        {items.map((item) => (
          <div key={`${item.id}-${item.variant || 'novar'}`} className="flex space-x-4">
            <div className="relative w-20 h-20 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
              <img
                src={productImageSrc(item.image || '/placeholder-product.png', { width: 160 })}
                alt={item.name || 'Product'}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
              />
              <div className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center bg-gold-600 text-white text-xs font-bold rounded-full">
                {item.quantity}
              </div>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 text-sm line-clamp-2">{item.name}</h3>
              {item.variant && <p className="text-xs text-gray-500 mt-0.5">{item.variant}</p>}
              <p className="text-gold-700 font-bold mt-1">GH₵ {(Number(item.price) || 0).toFixed(2)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 pt-4 space-y-3">
        <div className="flex justify-between text-gray-700">
          <span>Subtotal</span>
          <span className="font-semibold">GH₵ {subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-gray-700">
          <span>Shipping</span>
          <span className="font-semibold">GH₵ {shipping.toFixed(2)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-gold-600">
            <span>Discount (Points)</span>
            <span className="font-semibold">- GH₵ {discount.toFixed(2)}</span>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 mt-4 pt-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-lg font-bold text-gray-900">Total</span>
          <span className="text-2xl font-bold text-gold-700">GH₵ {total.toFixed(2)}</span>
        </div>

        {(payableNow !== undefined && payLater !== undefined && payLater > 0) && (
          <div className="mt-4 pt-4 border-t border-dashed border-gray-300">
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-gray-900">Pay Now</span>
              <span className="font-bold text-gray-900">GH₵ {payableNow.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-500">
              <span>Pay on Delivery</span>
              <span>GH₵ {payLater.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 p-4 bg-gold-50 border border-gold-200 rounded-lg">
        <div className="flex items-center space-x-2 text-gold-800">
          <i className="ri-shield-check-line text-xl"></i>
          <p className="text-sm font-semibold">Secure Checkout</p>
        </div>
      </div>
    </div>
  );
}
