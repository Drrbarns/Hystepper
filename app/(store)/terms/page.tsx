import Link from 'next/link';
import { StoreContactEmail, StoreContactPhone } from '@/components/StoreContact';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="bg-gradient-to-br from-emerald-50 via-white to-amber-50 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center animate-fade-in-up">
            <h1 className="text-5xl font-bold text-gray-900 mb-6">Terms & Conditions</h1>
            <p className="text-xl text-gray-600 leading-relaxed">
              Please read these terms carefully before using our website and services.
            </p>
            <p className="text-sm text-gray-500 mt-4">Last updated: February 2026</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="prose prose-lg max-w-none animate-fade-in-up delay-100">
          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">1. Agreement to Terms</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              By accessing and using this website (Hy-Stepper), you accept and agree to be bound by these Terms and Conditions. If you do not agree with any part of these terms, you must not use our website or services.
            </p>
            <p className="text-gray-600 leading-relaxed">
              These terms apply to all visitors, users, and customers who access or use our service. We reserve the right to update or modify these terms at any time without prior notice. Your continued use of the website following any changes indicates your acceptance of the new terms.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">2. Use of Website</h2>
            
            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">2.1 Permitted Use</h3>
            <p className="text-gray-600 leading-relaxed mb-4">
              You may use our website for lawful purposes only. You agree not to:
            </p>
            <ul className="space-y-2 text-gray-600 mb-6">
              <li className="flex items-start gap-2">
                <i className="ri-close-circle-line text-red-500 mt-1"></i>
                <span>Violate any local, national, or international law or regulation</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-close-circle-line text-red-500 mt-1"></i>
                <span>Transmit any harmful code, viruses, or malicious software</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-close-circle-line text-red-500 mt-1"></i>
                <span>Attempt to gain unauthorised access to our systems or networks</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-close-circle-line text-red-500 mt-1"></i>
                <span>Use the website for fraudulent purposes or in connection with any criminal activity</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-close-circle-line text-red-500 mt-1"></i>
                <span>Impersonate any person or entity or misrepresent your affiliation</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-close-circle-line text-red-500 mt-1"></i>
                <span>Interfere with or disrupt the website or servers</span>
              </li>
            </ul>

            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">2.2 Account Responsibility</h3>
            <p className="text-gray-600 leading-relaxed">
              If you create an account, you are responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account. You must notify us immediately of any unauthorised use of your account or any other security breach.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">3. Products & Pricing</h2>
            
            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">3.1 Product Information</h3>
            <p className="text-gray-600 leading-relaxed mb-4">
              We make every effort to display our products accurately, including colours, descriptions, and specifications. However, we cannot guarantee that your device's display will accurately reflect product colours or that product descriptions are error-free.
            </p>

            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">3.2 Pricing</h3>
            <p className="text-gray-600 leading-relaxed mb-4">
              All prices are listed in Ghana Cedis (GHS) and include VAT where applicable. We reserve the right to:
            </p>
            <ul className="space-y-2 text-gray-600 mb-6">
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span>Modify prices at any time without notice</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span>Correct pricing errors, even after an order is placed</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span>Limit quantities available for purchase</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span>Discontinue products at any time</span>
              </li>
            </ul>
            <p className="text-gray-600 leading-relaxed">
              If a product is listed at an incorrect price due to an error, we will contact you before processing your order. You may choose to cancel the order or proceed at the correct price.
            </p>

            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">3.3 Availability</h3>
            <p className="text-gray-600 leading-relaxed">
              Product availability is subject to change without notice. If an ordered item becomes unavailable, we will notify you and offer a refund or replacement option.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">4. Orders & Payment</h2>
            
            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">4.1 Order Acceptance</h3>
            <p className="text-gray-600 leading-relaxed mb-4">
              Placing an order does not guarantee acceptance. We reserve the right to refuse or cancel any order for reasons including:
            </p>
            <ul className="space-y-2 text-gray-600 mb-6">
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span>Product unavailability or pricing errors</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span>Suspected fraudulent or unauthorised transactions</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span>Inaccuracies in product or pricing information</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span>Failure to meet age or eligibility requirements</span>
              </li>
            </ul>

            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">4.2 Payment</h3>
            <p className="text-gray-600 leading-relaxed mb-4">
              We accept the following payment methods:
            </p>
            <div className="bg-gray-50 p-6 rounded-xl mb-6">
              <ul className="space-y-2 text-gray-600">
                <li className="flex items-center gap-2">
                  <i className="ri-smartphone-line text-emerald-700"></i>
                  <span>Mobile Money (MTN, Vodafone, AirtelTigo)</span>
                </li>
                <li className="flex items-center gap-2">
                  <i className="ri-bank-card-line text-emerald-700"></i>
                  <span>Credit/Debit Cards (Visa, Mastercard)</span>
                </li>
              </ul>
            </div>
            <p className="text-gray-600 leading-relaxed">
              Payment must be received in full before order dispatch. By providing payment information, you confirm that you are authorised to use the payment method and that there are sufficient funds available.
            </p>

            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">4.3 Order Modifications</h3>
            <p className="text-gray-600 leading-relaxed">
              Orders cannot be cancelled by customers on the website. Only our admin team can process cancellations. If you need to request a cancellation, please contact us immediately via WhatsApp or Instagram. If a cancellation is approved, a refund will be processed to your original payment method.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">5. Shipping & Delivery</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              We offer delivery across Ghana. Typical delivery times are:
            </p>
            <ul className="space-y-2 text-gray-600 mb-6">
              <li className="flex items-start gap-2">
                <i className="ri-motorbike-line text-emerald-700 mt-1"></i>
                <span><strong>Accra Delivery:</strong> 1-2 Business Days</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-truck-line text-emerald-700 mt-1"></i>
                <span><strong>Regional Delivery:</strong> 2-4 Business Days</span>
              </li>
            </ul>
            <p className="text-gray-600 leading-relaxed mb-4">
              Delivery fees are calculated at checkout based on your location. <strong>Delivery fees are non-refundable</strong> once the delivery has been completed or the rider has been dispatched.
            </p>
            <p className="text-gray-600 leading-relaxed">
              You must provide accurate and complete delivery information. We are not responsible for delivery failures due to incorrect addresses. If you are unavailable for delivery, rescheduling may incur an additional fee.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">6. Exchange & Refunds</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              We want you to be happy with your purchase. Our policy is as follows:
            </p>
            <ul className="space-y-2 text-gray-600 mb-6">
              <li className="flex items-start gap-2">
                <i className="ri-time-line text-emerald-700 mt-1"></i>
                <span><strong>Faulty Items:</strong> Must be reported within 48 hours of delivery for exchange.</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-time-line text-emerald-700 mt-1"></i>
                <span><strong>Other Issues (Size/Preference):</strong> Must be reported within 24 hours of delivery.</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-money-dollar-circle-line text-emerald-700 mt-1"></i>
                <span><strong>Delivery Fees:</strong> Customers are responsible for delivery fees for exchanges due to size or personal preference. We cover delivery fees only for faulty or wrong items.</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-refund-line text-emerald-700 mt-1"></i>
                <span><strong>Refunds:</strong> Only available for faulty items if an exchange is not possible. We do not offer refunds for change of mind.</span>
              </li>
            </ul>
            <p className="text-gray-600 leading-relaxed">
              Items must be returned unused, unworn, and with all original packaging intact. See our <Link href="/policy" className="text-emerald-700 underline">Exchange & Refund Policy</Link> for full details.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">7. Intellectual Property</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              All content on this website, including text, graphics, logos, images, videos, and software, is the property of Hy-Stepper or its content suppliers and is protected by copyright, trademark, and other intellectual property laws.
            </p>
            <p className="text-gray-600 leading-relaxed mb-4">
              You may not reproduce, distribute, modify, create derivative works of, publicly display, or otherwise use any content from this website without our express written permission.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">8. Limitation of Liability</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              To the fullest extent permitted by law, Hy-Stepper shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the website or services.
            </p>
            <p className="text-gray-600 leading-relaxed">
              Our total liability for any claim arising from your use of the website or purchase of products shall not exceed the amount you paid for the product or service in question.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">9. Governing Law</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              These terms are governed by the laws of Ghana. Any disputes arising from these terms or your use of the website shall be subject to the exclusive jurisdiction of the courts of Ghana.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">10. Contact Information</h2>
            <p className="text-gray-600 leading-relaxed mb-6">
              For questions about these Terms and Conditions, please contact us:
            </p>

            <div className="bg-gray-50 border border-gray-200 p-8 rounded-xl">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <i className="ri-mail-line text-emerald-700 text-xl mt-1"></i>
                  <div>
                    <p className="font-medium text-gray-900">Email</p>
                    <StoreContactEmail className="text-emerald-700 hover:underline" />
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <i className="ri-phone-line text-emerald-700 text-xl mt-1"></i>
                  <div>
                    <p className="font-medium text-gray-900">Phone</p>
                    <StoreContactPhone className="text-emerald-700 hover:underline" />
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <i className="ri-map-pin-line text-emerald-700 text-xl mt-1"></i>
                  <div>
                    <p className="font-medium text-gray-900">Location</p>
                    <p className="text-gray-600">Accra, Ghana</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="bg-emerald-50 border-2 border-emerald-200 p-8 rounded-xl text-center">
            <i className="ri-checkbox-circle-line text-4xl text-emerald-700 mb-4"></i>
            <p className="text-gray-600 leading-relaxed">
              By using our website, you acknowledge that you have read, understood, and agree to be bound by these Terms and Conditions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
