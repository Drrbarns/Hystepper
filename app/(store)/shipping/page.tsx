import Link from 'next/link';

export default function ShippingPage() {
  const deliveryOptions = [
    {
      type: 'Accra Delivery',
      time: '1-2 Business Days',
      cost: 'Calculated at checkout',
      description: 'Fast and reliable delivery within Accra and Tema.',
      icon: 'ri-motorbike-line'
    },
    {
      type: 'Regional Delivery',
      time: '2-4 Business Days',
      cost: 'Calculated at checkout',
      description: 'Delivery to other regions across Ghana via courier partners.',
      icon: 'ri-truck-line'
    }
  ];

  return (
    <div className="min-h-screen bg-white">
      <div className="bg-gradient-to-br from-emerald-50 via-white to-amber-50 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-serif font-bold text-gray-900 mb-6">Shipping & Delivery</h1>
            <p className="text-xl text-gray-600 leading-relaxed">
              Fast, reliable delivery across Ghana. Get your favorites delivered to your doorstep.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        
        {/* Delivery Options Grid */}
        <div className="mb-20">
          <h2 className="text-3xl font-bold text-gray-900 mb-10 text-center">Delivery Options</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {deliveryOptions.map((option, index) => (
              <div key={index} className="bg-white border border-gray-200 p-8 rounded-2xl hover:border-emerald-500 hover:shadow-lg transition-all group">
                <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mb-6 group-hover:bg-emerald-100 transition-colors">
                  <i className={`${option.icon} text-3xl text-emerald-700`}></i>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">{option.type}</h3>
                <div className="text-emerald-700 font-bold text-lg mb-2">{option.cost}</div>
                <div className="text-gray-500 font-medium mb-4 flex items-center gap-2">
                  <i className="ri-time-line"></i>
                  {option.time}
                </div>
                <p className="text-gray-600 leading-relaxed">{option.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-12 mb-20">
          {/* How It Works */}
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-8">How It Works</h2>
            <div className="space-y-8">
              <div className="flex gap-6">
                <div className="flex-shrink-0 w-12 h-12 bg-gray-900 text-white rounded-full flex items-center justify-center font-bold text-xl shadow-md">
                  1
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Order Processing</h3>
                  <p className="text-gray-600 leading-relaxed">
                    Orders placed before 10am are typically processed the same day. We verify your items and pack them securely.
                  </p>
                </div>
              </div>

              <div className="flex gap-6">
                <div className="flex-shrink-0 w-12 h-12 bg-gray-900 text-white rounded-full flex items-center justify-center font-bold text-xl shadow-md">
                  2
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Dispatch & Tracking</h3>
                  <p className="text-gray-600 leading-relaxed">
                    Once dispatched to our delivery partner, you'll receive a confirmation. You can track your order status in your account.
                  </p>
                </div>
              </div>

              <div className="flex gap-6">
                <div className="flex-shrink-0 w-12 h-12 bg-gray-900 text-white rounded-full flex items-center justify-center font-bold text-xl shadow-md">
                  3
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Delivery</h3>
                  <p className="text-gray-600 leading-relaxed">
                    Our rider or courier partner will contact you to coordinate the drop-off. Please ensure your phone line is active. We do not deliver on Sundays.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Important Policy Info */}
          <div className="bg-gray-50 rounded-3xl p-8 md:p-10">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
              <i className="ri-information-fill text-emerald-700"></i>
              Important Information
            </h2>
            <div className="space-y-6">
              <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
                <h3 className="font-bold text-gray-900 mb-2 text-lg">Delivery Fees</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Delivery fees are calculated based on your location. Please note that <strong>delivery fees are non-refundable</strong> once the delivery has been completed or the rider has been dispatched.
                </p>
              </div>

              <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
                <h3 className="font-bold text-gray-900 mb-2 text-lg">Exchange Delivery</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  If you need to exchange an item due to a size issue or personal preference, you will be responsible for the delivery fee for the exchange. We cover the cost only if the item is faulty or incorrect.
                </p>
              </div>

              <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
                <h3 className="font-bold text-gray-900 mb-2 text-lg">Failed Deliveries</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Our riders will attempt to contact you upon arrival. If you are unavailable, we may need to reschedule, which could incur an additional fee.
                </p>
              </div>

              <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
                <h3 className="font-bold text-gray-900 mb-2 text-lg">Delivery Days</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Deliveries run Monday–Saturday. There are no deliveries on Sundays.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* CTA Section */}
        <div className="bg-gray-900 rounded-3xl p-10 md:p-16 text-center text-white relative overflow-hidden">
          <div className="relative z-10">
            <h2 className="text-3xl md:text-4xl font-serif font-bold mb-6">Ready to Shop?</h2>
            <p className="text-gray-300 mb-10 max-w-2xl mx-auto text-lg">
              Explore our latest collection and get it delivered straight to your door.
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <Link
                href="/shop"
                className="inline-flex items-center gap-2 bg-white text-gray-900 px-8 py-4 rounded-full font-bold hover:bg-emerald-50 transition-colors shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all"
              >
                Start Shopping
                <i className="ri-arrow-right-line"></i>
              </Link>
              <Link
                href="/account?tab=orders"
                className="inline-flex items-center gap-2 bg-transparent border-2 border-white text-white px-8 py-4 rounded-full font-bold hover:bg-white/10 transition-colors"
              >
                Track Order
              </Link>
            </div>
          </div>
          
          {/* Decorative background elements */}
          <div className="absolute top-0 left-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"></div>
          <div className="absolute bottom-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl translate-x-1/2 translate-y-1/2"></div>
        </div>

      </div>
    </div>
  );
}
