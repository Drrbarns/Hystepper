import { StoreContactEmail, StoreContactPhone } from '@/components/StoreContact';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="bg-gradient-to-br from-emerald-50 via-white to-amber-50 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center animate-fade-in-up">
            <h1 className="text-5xl font-bold text-gray-900 mb-6">Privacy Policy</h1>
            <p className="text-xl text-gray-600 leading-relaxed">
              Your privacy matters to us. Learn how we collect, use, and protect your personal information.
            </p>
            <p className="text-sm text-gray-500 mt-4">Last updated: December 2024</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="prose prose-lg max-w-none animate-fade-in-up delay-100">
          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">1. Information We Collect</h2>
            
            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">1.1 Information You Provide</h3>
            <p className="text-gray-600 leading-relaxed mb-4">
              When you create an account, place an order, or contact us, we collect:
            </p>
            <ul className="space-y-2 text-gray-600 mb-6">
              <li className="flex items-start gap-2">
                <i className="ri-checkbox-circle-line text-emerald-700 mt-1"></i>
                <span><strong>Personal Details:</strong> Name, email address, phone number, date of birth</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-checkbox-circle-line text-emerald-700 mt-1"></i>
                <span><strong>Delivery Information:</strong> Shipping and billing addresses</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-checkbox-circle-line text-emerald-700 mt-1"></i>
                <span><strong>Payment Details:</strong> Payment method information (securely processed by third-party providers)</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-checkbox-circle-line text-emerald-700 mt-1"></i>
                <span><strong>Communications:</strong> Messages, reviews, and feedback you submit</span>
              </li>
            </ul>

            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">1.2 Information Collected Automatically</h3>
            <p className="text-gray-600 leading-relaxed mb-4">
              When you visit our website, we automatically collect:
            </p>
            <ul className="space-y-2 text-gray-600 mb-6">
              <li className="flex items-start gap-2">
                <i className="ri-checkbox-circle-line text-emerald-700 mt-1"></i>
                <span><strong>Device Information:</strong> IP address, browser type, operating system, device identifiers</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-checkbox-circle-line text-emerald-700 mt-1"></i>
                <span><strong>Usage Data:</strong> Pages viewed, products browsed, search queries, time spent on site</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-checkbox-circle-line text-emerald-700 mt-1"></i>
                <span><strong>Cookies:</strong> Small data files stored on your device to improve your experience</span>
              </li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">2. How We Use Your Information</h2>
            <p className="text-gray-600 leading-relaxed mb-6">
              We use your personal information for the following purposes:
            </p>
            
            <div className="space-y-6">
              <div className="bg-gray-50 p-6 rounded-xl">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <i className="ri-shopping-bag-line text-emerald-700"></i>
                  Order Processing & Fulfilment
                </h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Process your orders, arrange delivery, send order confirmations and updates, handle returns and refunds, and provide customer support.
                </p>
              </div>

              <div className="bg-gray-50 p-6 rounded-xl">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <i className="ri-line-chart-line text-emerald-700"></i>
                  Service Improvement
                </h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Analyse website usage to improve our products, services, and user experience. Conduct research and development for new features and offerings.
                </p>
              </div>

              <div className="bg-gray-50 p-6 rounded-xl">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <i className="ri-mail-line text-emerald-700"></i>
                  Marketing & Communication
                </h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Send promotional emails, special offers, and product recommendations (only if you've opted in). Share relevant updates about your orders and our services.
                </p>
              </div>

              <div className="bg-gray-50 p-6 rounded-xl">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <i className="ri-shield-check-line text-emerald-700"></i>
                  Security & Fraud Prevention
                </h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Protect against fraudulent transactions, unauthorised access, and other security threats. Verify your identity for high-value purchases.
                </p>
              </div>

              <div className="bg-gray-50 p-6 rounded-xl">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <i className="ri-scales-line text-emerald-700"></i>
                  Legal Compliance
                </h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Comply with legal obligations, respond to lawful requests from authorities, enforce our terms and conditions, and resolve disputes.
                </p>
              </div>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">3. Information Sharing & Disclosure</h2>
            <p className="text-gray-600 leading-relaxed mb-6">
              We do not sell your personal information. We may share your data with:
            </p>

            <div className="space-y-4">
              <div className="border-l-4 border-emerald-700 pl-6">
                <h3 className="font-bold text-gray-900 mb-2">Service Providers</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Trusted third parties who help us operate our business (payment processors, delivery partners, email service providers, analytics tools). They are contractually bound to protect your data.
                </p>
              </div>

              <div className="border-l-4 border-emerald-700 pl-6">
                <h3 className="font-bold text-gray-900 mb-2">Business Transfers</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  If we merge with or are acquired by another company, your information may be transferred as part of the transaction. We will notify you of any such change.
                </p>
              </div>

              <div className="border-l-4 border-emerald-700 pl-6">
                <h3 className="font-bold text-gray-900 mb-2">Legal Requirements</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  When required by law or to protect our rights, property, or safety, or that of our customers or others.
                </p>
              </div>

              <div className="border-l-4 border-emerald-700 pl-6">
                <h3 className="font-bold text-gray-900 mb-2">With Your Consent</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Any other disclosures will be made only with your explicit consent.
                </p>
              </div>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">4. Data Security</h2>
            <p className="text-gray-600 leading-relaxed mb-6">
              We implement robust security measures to protect your personal information:
            </p>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-xl">
                <div className="w-10 h-10 bg-emerald-700 rounded-full flex items-center justify-center mb-4">
                  <i className="ri-lock-line text-white text-lg"></i>
                </div>
                <h3 className="font-bold text-gray-900 mb-2">Encryption</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  All data transmitted between your browser and our servers is encrypted using SSL/TLS technology.
                </p>
              </div>

              <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-xl">
                <div className="w-10 h-10 bg-emerald-700 rounded-full flex items-center justify-center mb-4">
                  <i className="ri-shield-check-line text-white text-lg"></i>
                </div>
                <h3 className="font-bold text-gray-900 mb-2">Secure Storage</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Your data is stored on secure servers with restricted access and regular security audits.
                </p>
              </div>

              <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-xl">
                <div className="w-10 h-10 bg-emerald-700 rounded-full flex items-center justify-center mb-4">
                  <i className="ri-bank-card-line text-white text-lg"></i>
                </div>
                <h3 className="font-bold text-gray-900 mb-2">Payment Security</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  We never store your full payment card details. All payments are processed by PCI-DSS compliant providers.
                </p>
              </div>

              <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-xl">
                <div className="w-10 h-10 bg-emerald-700 rounded-full flex items-center justify-center mb-4">
                  <i className="ri-user-lock-line text-white text-lg"></i>
                </div>
                <h3 className="font-bold text-gray-900 mb-2">Access Controls</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Only authorised personnel have access to personal data, and they are bound by strict confidentiality obligations.
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 p-6 rounded-xl mt-6">
              <p className="text-sm text-gray-600 leading-relaxed">
                <strong className="text-gray-900">Important:</strong> While we implement strong security measures, no method of transmission or storage is 100% secure. We cannot guarantee absolute security but continually work to protect your information.
              </p>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">5. Your Rights & Choices</h2>
            <p className="text-gray-600 leading-relaxed mb-6">
              You have the following rights regarding your personal information:
            </p>

            <div className="space-y-4 mb-6">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <i className="ri-eye-line text-emerald-700"></i>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 mb-1">Access</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">Request a copy of the personal information we hold about you.</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <i className="ri-pencil-line text-emerald-700"></i>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 mb-1">Correction</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">Update or correct inaccurate or incomplete information.</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <i className="ri-delete-bin-line text-emerald-700"></i>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 mb-1">Deletion</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">Request deletion of your personal information (subject to legal retention requirements).</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <i className="ri-mail-close-line text-emerald-700"></i>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 mb-1">Marketing Opt-Out</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">Unsubscribe from marketing emails at any time using the link in our emails or your account settings.</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <i className="ri-download-line text-emerald-700"></i>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 mb-1">Data Portability</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">Receive your data in a structured, commonly used format.</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <i className="ri-hand-coin-line text-emerald-700"></i>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 mb-1">Object to Processing</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">Object to certain types of data processing, such as direct marketing.</p>
                </div>
              </div>
            </div>

            <p className="text-gray-600 leading-relaxed">
              To exercise any of these rights, please contact us at <StoreContactEmail className="text-emerald-700 font-medium hover:underline" /> or through your account settings. We will respond within 30 days.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">6. Cookies & Tracking</h2>
            <p className="text-gray-600 leading-relaxed mb-6">
              We use cookies and similar technologies to enhance your browsing experience:
            </p>

            <div className="space-y-4">
              <div className="bg-white border border-gray-200 p-6 rounded-xl">
                <h3 className="font-bold text-gray-900 mb-2">Essential Cookies</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Required for the website to function properly (e.g., shopping cart, login sessions). These cannot be disabled.
                </p>
              </div>

              <div className="bg-white border border-gray-200 p-6 rounded-xl">
                <h3 className="font-bold text-gray-900 mb-2">Analytics Cookies</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Help us understand how visitors use our website so we can improve it. These collect anonymous usage data.
                </p>
              </div>

              <div className="bg-white border border-gray-200 p-6 rounded-xl">
                <h3 className="font-bold text-gray-900 mb-2">Marketing Cookies</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Used to show you relevant advertisements based on your interests. You can opt out of these through your browser settings.
                </p>
              </div>

              <div className="bg-white border border-gray-200 p-6 rounded-xl">
                <h3 className="font-bold text-gray-900 mb-2">Preference Cookies</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Remember your preferences and settings (e.g., language, region) to provide a personalised experience.
                </p>
              </div>
            </div>

            <p className="text-gray-600 leading-relaxed mt-6">
              You can control cookie preferences through your browser settings. However, disabling certain cookies may affect website functionality.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">7. Children's Privacy</h2>
            <p className="text-gray-600 leading-relaxed">
              Our website is not intended for children under 16 years of age. We do not knowingly collect personal information from children. If you believe we have inadvertently collected information from a child, please contact us immediately and we will delete it.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">8. International Data Transfers</h2>
            <p className="text-gray-600 leading-relaxed">
              Your information may be transferred to and processed in countries outside Ghana, including countries that may have different data protection laws. We ensure appropriate safeguards are in place to protect your information in accordance with this privacy policy.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">9. Data Retention</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              We retain your personal information only for as long as necessary to fulfil the purposes outlined in this policy:
            </p>
            <ul className="space-y-2 text-gray-600">
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span><strong>Account Information:</strong> Until you request deletion or close your account</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span><strong>Order History:</strong> 7 years for tax and accounting purposes</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span><strong>Marketing Data:</strong> Until you unsubscribe or request deletion</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span><strong>Analytics Data:</strong> Typically 26 months</span>
              </li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">10. Changes to This Policy</h2>
            <p className="text-gray-600 leading-relaxed">
              We may update this privacy policy from time to time to reflect changes in our practices or for legal, operational, or regulatory reasons. We will notify you of significant changes by email or through a prominent notice on our website. The "Last updated" date at the top indicates when the policy was last revised.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">11. Contact Us</h2>
            <p className="text-gray-600 leading-relaxed mb-6">
              If you have any questions, concerns, or requests regarding this privacy policy or our data practices, please contact us:
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
        </div>
      </div>
    </div>
  );
}
