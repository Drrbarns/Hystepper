'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import OrderSummary from '@/components/OrderSummary';
import { useCart } from '@/context/CartContext';
import { useCMS } from '@/context/CMSContext';
import { supabase } from '@/lib/supabase';
import DeliveryAreaPicker from '@/components/DeliveryAreaPicker';
import {
  DEFAULT_PROMOTIONS,
  applyDeliveryFeeAdjustments,
  deliveryDiscountBadge,
  effectiveDeliveryDiscountPercent,
  fetchStorePromotions,
  isDeliveryDiscountEligible,
  loyaltyDiscountAmount,
  pointsToRedeemForDiscount,
  storewideDiscountAmount,
  type StorePromotions,
} from '@/lib/promotions';

export default function CheckoutPage() {
  const router = useRouter();
  const { cart, subtotal: cartSubtotal, clearCart, revalidateCart } = useCart();
  const { getSetting } = useCMS();

  // Re-check stock + product status the moment the customer lands on
  // /checkout. The cart provider already does this on app load + window
  // focus, but this catches the "added at noon, came back to checkout
  // at 3pm" case where the page never lost focus in between.
  useEffect(() => {
    void revalidateCart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Contact us for a quote" fallback links — sourced from admin
  // settings so the merchant can update them in one place.
  const contactWhatsappNumber = (getSetting('whatsapp_number') || '233276558163').replace(/\D/g, '');
  const contactWhatsappUrl = contactWhatsappNumber
    ? `https://wa.me/${contactWhatsappNumber}`
    : '';
  const contactInstagramUrl = getSetting('social_instagram') || '';

  const [isLoading, setIsLoading] = useState(false);
  const [checkoutType, setCheckoutType] = useState<'guest' | 'account'>('guest');
  const [user, setUser] = useState<any>(null);

  const [shippingData, setShippingData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    region: '',
  });

  const [regions, setRegions] = useState<any[]>([]);
  const [selectedRegionType, setSelectedRegionType] = useState<string>('');

  // Saved address book (signed-in customers): selectable at checkout.
  const [savedAddresses, setSavedAddresses] = useState<any[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>('');
  // Skips the "clear region on region-type change" effect while a saved
  // address is being applied, so its zone isn't immediately wiped.
  const applyingAddressRef = useRef(false);
  const [accraZones, setAccraZones] = useState<any[]>([]);
  const [outsideZones, setOutsideZones] = useState<any[]>([]);

  const [paymentOption, setPaymentOption] = useState<'full_payment' | 'item_only'>('full_payment');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [policyError, setPolicyError] = useState(false);
  const [showValidationBanner, setShowValidationBanner] = useState(false);
  const [errors, setErrors] = useState<any>({});

  // Auto-dismiss the top banner once the customer has resolved every issue,
  // so it doesn't linger after they fix things without re-clicking submit.
  useEffect(() => {
    if (!showValidationBanner) return;
    const stillHasErrors = Object.values(errors).some(Boolean) || (policyError && !acceptedPolicy);
    if (!stillHasErrors) setShowValidationBanner(false);
  }, [errors, acceptedPolicy, policyError, showValidationBanner]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  // Coupon
  const [couponCode, setCouponCode] = useState('');
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponApplied, setCouponApplied] = useState<any>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState('');

  // Loyalty
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [redeemPoints, setRedeemPoints] = useState(false);

  // Settings
  const [settings, setSettings] = useState({
    sameDayDelivery: false,
    nextDayDelivery: false,
    deliveryUnavailable: false
  });
  const [promotions, setPromotions] = useState<StorePromotions>({ ...DEFAULT_PROMOTIONS });

  const activeZone = regions.find(r => r.name === shippingData.region);
  const isAccra = selectedRegionType === 'greater_accra';

  // Per-zone delivery methods (configured in Admin → Settings → Delivery).
  // When a zone has methods, the customer must pick one and its fee replaces
  // the base/per-item formula.
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const zoneMethods: any[] = Array.isArray(activeZone?.methods)
    ? activeZone.methods.filter((m: any) => m && m.name && m.active !== false)
    : [];
  const hasMethods = zoneMethods.length > 0;
  const selectedMethod = hasMethods
    ? zoneMethods.find((m: any) => String(m.id ?? m.name) === selectedMethodId) || null
    : null;

  // Zone-level fee adjustments (free delivery / % discount) set by the admin,
  // plus store-wide delivery promotions from Admin → Promotions.
  const zoneDiscountPercent = Math.min(100, Math.max(0, Number(activeZone?.discount_percent) || 0));
  const zoneFreeDelivery = !!activeZone?.free_delivery;

  // Reset the picked method whenever the delivery area changes.
  useEffect(() => {
    setSelectedMethodId('');
  }, [shippingData.region]);

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        setCheckoutType('account');
        const meta = session.user.user_metadata || {};
        setShippingData(prev => ({
          ...prev,
          email: session.user.email || prev.email,
          firstName: meta.first_name || prev.firstName,
          lastName: meta.last_name || prev.lastName,
          phone: meta.phone || prev.phone,
        }));

        const { data: pointsData } = await supabase
          .from('loyalty_points')
          .select('points')
          .eq('user_id', session.user.id)
          .single();

        if (pointsData) {
          setLoyaltyPoints(pointsData.points || 0);
        }

        const { data: addressData } = await supabase
          .from('addresses')
          .select('id, label, full_name, phone, address_line1, city, state, is_default')
          .eq('user_id', session.user.id)
          .order('is_default', { ascending: false })
          .order('created_at', { ascending: false });
        if (addressData) setSavedAddresses(addressData);
      }

      const { data: settingsData } = await supabase
        .from('store_settings')
        .select('key, value')
        .in('key', ['same_day_delivery_enabled', 'next_day_delivery_enabled', 'delivery_unavailable']);

      if (settingsData) {
        const sameDay = settingsData.find(s => s.key === 'same_day_delivery_enabled')?.value === true || settingsData.find(s => s.key === 'same_day_delivery_enabled')?.value === 'true';
        const nextDay = settingsData.find(s => s.key === 'next_day_delivery_enabled')?.value === true || settingsData.find(s => s.key === 'next_day_delivery_enabled')?.value === 'true';
        const unavailable = settingsData.find(s => s.key === 'delivery_unavailable')?.value === true || settingsData.find(s => s.key === 'delivery_unavailable')?.value === 'true';
        setSettings({ sameDayDelivery: sameDay, nextDayDelivery: nextDay, deliveryUnavailable: unavailable });
      }

      try {
        setPromotions(await fetchStorePromotions());
      } catch (err) {
        console.error('Failed to load promotions:', err);
      }

      const { data: zonesData } = await supabase
        .from('delivery_zones')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (zonesData) {
        setRegions(zonesData);
        setAccraZones(zonesData.filter((z: any) => z.is_accra).sort((a: any, b: any) => a.name.localeCompare(b.name)));
        setOutsideZones(zonesData.filter((z: any) => !z.is_accra).sort((a: any, b: any) => a.name.localeCompare(b.name)));
      }
    }
    init();
  }, []);

  useEffect(() => {
    if (!isAccra && paymentOption === 'item_only') {
      setPaymentOption('full_payment');
    }
  }, [isAccra, paymentOption]);

  useEffect(() => {
    if (applyingAddressRef.current) {
      applyingAddressRef.current = false;
      return;
    }
    if (selectedRegionType === 'other_regions') {
      setShippingData(prev => ({ ...prev, region: '', city: '' }));
    }
  }, [selectedRegionType]);

  // Calculate Totals
  const subtotal = cartSubtotal;
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Product / checkout promotions first — delivery fee discounts are exclusive of these.
  const storewideDiscount = storewideDiscountAmount(subtotal, promotions);
  const merchandiseAfterSale = Math.max(0, subtotal - storewideDiscount);
  const pointsDiscount = loyaltyDiscountAmount(
    loyaltyPoints,
    redeemPoints && !couponApplied,
    merchandiseAfterSale,
    promotions
  );
  const pointsToDeduct = pointsDiscount > 0 ? pointsToRedeemForDiscount(pointsDiscount, promotions) : 0;
  const totalDiscount = storewideDiscount + (couponApplied ? couponDiscount : pointsDiscount);

  // Delivery fee discounts (zone free/%, global %, free-by-item-count) cannot
  // stack with coupons, Sleek Points, or store-wide sale %. Sale-priced items
  // in the cart alone do not block delivery discounts.
  const deliveryDiscountEligible = isDeliveryDiscountEligible({
    hasCoupon: !!couponApplied,
    hasLoyaltyRedeem: pointsDiscount > 0,
    hasStorewideSale: storewideDiscount > 0,
  });

  const freeByItemCount =
    deliveryDiscountEligible &&
    promotions.freeDeliveryMinItems > 0 &&
    totalItems >= promotions.freeDeliveryMinItems;

  const applyZoneFeeAdjustments = (fee: number) =>
    applyDeliveryFeeAdjustments(fee, {
      zoneFreeDelivery,
      zoneDiscountPercent,
      globalDeliveryDiscountPercent: promotions.globalDeliveryDiscountPercent,
      freeDeliveryMinItems: promotions.freeDeliveryMinItems,
      totalItems,
      eligible: deliveryDiscountEligible,
    });

  /** Preview fee for a zone in the location picker (before it's selected). */
  const previewZoneFee = (zone: any) => {
    const methods = Array.isArray(zone?.methods)
      ? zone.methods.filter((m: any) => m && m.name && m.active !== false)
      : [];
    const rawCandidates = methods.length > 0
      ? methods.map((m: any) => Number(m.fee) || 0)
      : [Number(zone?.base_fee) || 0];
    const raw = Math.min(...rawCandidates);
    const final = applyDeliveryFeeAdjustments(raw, {
      zoneFreeDelivery: !!zone?.free_delivery,
      zoneDiscountPercent: Math.min(100, Math.max(0, Number(zone?.discount_percent) || 0)),
      globalDeliveryDiscountPercent: promotions.globalDeliveryDiscountPercent,
      freeDeliveryMinItems: promotions.freeDeliveryMinItems,
      totalItems,
      eligible: deliveryDiscountEligible,
    });
    const isFree =
      deliveryDiscountEligible &&
      final === 0 &&
      (raw > 0 || !!zone?.free_delivery || freeByItemCount);
    return {
      raw,
      final,
      discounted: final < raw,
      isFree,
      badge: deliveryDiscountBadge({
        eligible: deliveryDiscountEligible,
        isFree,
        rawFee: raw,
        finalFee: final,
      }),
      effectivePercent: effectiveDeliveryDiscountPercent(raw, final),
      isFrom: methods.length > 1,
    };
  };

  const baseFee = activeZone?.base_fee || 0;
  const perItemFee = activeZone?.per_item_fee || 0;
  // The "3+ items → manual quote" rule only applies to the legacy formula;
  // zones with explicit delivery methods always have a flat, known fee.
  const outsideAccraTooManyItems = !isAccra && activeZone && totalItems >= 3 && !hasMethods;
  const zoneFee = hasMethods
    ? (selectedMethod ? Number(selectedMethod.fee) || 0 : 0)
    : isAccra
      ? baseFee
      : totalItems <= 1
        ? baseFee
        : totalItems === 2
          ? baseFee + perItemFee
          : 0;
  // Free-shipping coupons still waive delivery; other coupons block zone/promo delivery discounts.
  const shippingCost = applyZoneFeeAdjustments(
    couponApplied?.type === 'free_shipping' ? 0 : zoneFee
  );

  const wouldHaveDeliveryPromo =
    zoneFreeDelivery ||
    (promotions.freeDeliveryMinItems > 0 && totalItems >= promotions.freeDeliveryMinItems) ||
    zoneDiscountPercent > 0 ||
    promotions.globalDeliveryDiscountPercent > 0;
  // Free-shipping coupons already waive the fee — don't show the "paused" notice for those.
  const deliveryPromoBlocked =
    !deliveryDiscountEligible &&
    wouldHaveDeliveryPromo &&
    couponApplied?.type !== 'free_shipping';

  const tax = 0;
  const totalBeforeSplit = Math.max(0, subtotal + shippingCost + tax - totalDiscount);

  const deliveryFeeToPayLater = paymentOption === 'item_only' ? shippingCost : 0;
  const payableNow = Math.max(0, totalBeforeSplit - deliveryFeeToPayLater);
  const total = totalBeforeSplit;

  const validateShipping = () => {
    const newErrors: any = {};
    if (!shippingData.firstName) newErrors.firstName = 'First name is required';
    if (!shippingData.lastName) newErrors.lastName = 'Last name is required';
    if (!shippingData.phone) {
      newErrors.phone = 'Phone is required';
    } else {
      const cleanPhone = shippingData.phone.replace(/[\s\-()]/g, '');
      if (!/^(\+233|0)\d{9}$/.test(cleanPhone)) {
        newErrors.phone = 'Enter a valid Ghanaian phone number (e.g. 0241234567)';
      }
    }
    if (!selectedRegionType) newErrors.region = 'Region is required';
    if (selectedRegionType === 'greater_accra' && !shippingData.region) newErrors.region = 'Please select your delivery area';
    if (selectedRegionType === 'other_regions' && !shippingData.region) newErrors.region = 'Please select your city';
    if (hasMethods && !selectedMethod && !settings.deliveryUnavailable) {
      newErrors.deliveryMethod = 'Please choose a delivery method';
    }

    // Email is optional — but validate format if provided
    if (shippingData.email && !/\S+@\S+\.\S+/.test(shippingData.email)) {
      newErrors.email = 'Invalid email format';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    setCouponError('');

    try {
      const { data: coupon, error } = await supabase
        .from('coupons')
        .select('*')
        .eq('code', couponCode.trim().toUpperCase())
        .eq('is_active', true)
        .single();

      if (error || !coupon) {
        setCouponError('Invalid or expired coupon code');
        setCouponLoading(false);
        return;
      }

      if (coupon.start_date && new Date(coupon.start_date) > new Date()) {
        setCouponError('This coupon is not yet active');
        setCouponLoading(false);
        return;
      }
      if (coupon.end_date && new Date(coupon.end_date) < new Date()) {
        setCouponError('This coupon has expired');
        setCouponLoading(false);
        return;
      }

      if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) {
        setCouponError('This coupon has reached its usage limit');
        setCouponLoading(false);
        return;
      }

      if (coupon.minimum_purchase && merchandiseAfterSale < coupon.minimum_purchase) {
        setCouponError(`Minimum purchase of GH₵ ${coupon.minimum_purchase} required`);
        setCouponLoading(false);
        return;
      }

      if (redeemPoints) {
        setRedeemPoints(false);
      }

      let discount = 0;
      if (coupon.type === 'percentage') {
        discount = (merchandiseAfterSale * coupon.value) / 100;
        if (coupon.maximum_discount) {
          discount = Math.min(discount, coupon.maximum_discount);
        }
      } else if (coupon.type === 'fixed_amount') {
        discount = Math.min(coupon.value, merchandiseAfterSale);
      } else if (coupon.type === 'free_shipping') {
        discount = 0;
        // Free shipping coupons: zero the fee via a flag — handled by setting
        // coupon type metadata; we still mark the coupon applied.
      } else {
        discount = Math.min(coupon.value, merchandiseAfterSale);
      }

      setCouponDiscount(discount);
      setCouponApplied(coupon);
    } catch (err) {
      setCouponError('Failed to apply coupon');
    } finally {
      setCouponLoading(false);
    }
  };

  const removeCoupon = () => {
    setCouponApplied(null);
    setCouponDiscount(0);
    setCouponCode('');
    setCouponError('');
  };

  const applySavedAddress = (a: any) => {
    const parts = String(a.full_name || '').trim().split(/\s+/);
    const firstName = parts.shift() || '';
    const lastName = parts.join(' ');
    const zone = regions.find((z: any) => z.name === a.state);

    applyingAddressRef.current = true;
    setSelectedRegionType(zone ? (zone.is_accra ? 'greater_accra' : 'other_regions') : '');
    setShippingData(prev => ({
      ...prev,
      firstName,
      lastName,
      phone: a.phone || '',
      address: a.address_line1 || '',
      city: a.city || '',
      region: zone ? zone.name : '',
    }));
    setSelectedAddressId(a.id);
    setErrors((prev: any) => ({
      ...prev, firstName: '', lastName: '', phone: '', address: '', city: '', region: '',
    }));
    if (!zone) {
      toast.error('The delivery area saved on this address is no longer offered — please pick your area below.');
    }
  };

  const handleProceedToPayment = () => {
    const shippingOk = validateShipping();
    const policyMissing = !acceptedPolicy;
    if (policyMissing) setPolicyError(true);

    if (!shippingOk || policyMissing) {
      // Surface a top-of-form summary so the customer knows what to fix
      // without having to spot the red borders themselves.
      setShowValidationBanner(true);
      requestAnimationFrame(() => {
        // Prefer scrolling to the first shipping field with an error so the
        // customer's cursor naturally lands there; fall back to the policy
        // box if shipping is fine but the policy wasn't accepted.
        const firstShippingError = document.querySelector<HTMLElement>('[data-shipping-error="true"]');
        if (firstShippingError) {
          firstShippingError.scrollIntoView({ behavior: 'smooth', block: 'center' });
          firstShippingError.querySelector<HTMLInputElement | HTMLSelectElement>('input, select, textarea')?.focus({ preventScroll: true });
          return;
        }
        if (policyMissing) {
          document.getElementById('policy-accept-box')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      return;
    }

    if (cart.length === 0) {
      toast.error('Your cart is empty');
      return;
    }

    setShowValidationBanner(false);
    setShowPaymentModal(true);
  };

  const handlePlaceOrder = async (gateway: 'paystack' | 'moolre') => {
    setIsLoading(true);
    setShowPaymentModal(false);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        authHeaders.Authorization = `Bearer ${session.access_token}`;
      }

      const checkoutRes = await fetch('/api/checkout/create-order', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          items: cart.map((item) => ({
            productId: item.id,
            variantId: item.variantId || null,
            quantity: item.quantity,
          })),
          shipping: {
            firstName: shippingData.firstName,
            lastName: shippingData.lastName,
            email: shippingData.email,
            phone: shippingData.phone,
            address: shippingData.address,
            city: shippingData.city,
            region: shippingData.region,
            regionType: selectedRegionType,
          },
          paymentMethod: gateway,
          paymentOption,
          couponCode: couponApplied?.code || couponCode.trim() || undefined,
          pointsToRedeem: redeemPoints && pointsToDeduct > 0 ? pointsToDeduct : undefined,
          deliveryNotes,
          deliveryZoneId: activeZone?.id || undefined,
          shippingMethodName: selectedMethod?.name || undefined,
        }),
      });

      const checkoutResult = await checkoutRes.json();
      if (!checkoutRes.ok) {
        throw new Error(checkoutResult.error || 'Failed to create order');
      }

      const order = checkoutResult.order;
      const orderNumber = order.order_number;
      const payableNowFromServer = Number(checkoutResult.payableNow);

      if (payableNowFromServer <= 0) {
        clearCart();
        router.push(`/order-success?order=${orderNumber}`);
        return;
      }

      const orderEmail =
        shippingData.email && shippingData.email.includes('@')
          ? shippingData.email
          : order.email;

      let redirectUrl = `/order-success?order=${orderNumber}`;

      if (gateway === 'moolre') {
        const paymentRes = await fetch('/api/payment/moolre', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: orderNumber,
            customerEmail: orderEmail,
          })
        });

        const paymentResult = await paymentRes.json();

        if (!paymentResult.success) {
          throw new Error(paymentResult.message || 'Payment initialization failed');
        }

        redirectUrl = paymentResult.url;
      } else if (gateway === 'paystack') {
        const paymentRes = await fetch('/api/payment/paystack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: orderNumber,
            customerEmail: orderEmail,
            customerPhone: shippingData.phone
          })
        });

        const paymentResult = await paymentRes.json();

        if (!paymentResult.success) {
          throw new Error(paymentResult.message || 'Payment initialization failed');
        }

        redirectUrl = paymentResult.url;
      }

      clearCart();
      window.location.href = redirectUrl;

    } catch (err: any) {
      console.error('Checkout error:', err);
      toast.error('Failed to place order: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };


  if (cart.length === 0 && !isLoading) {
    return (
      <main className="min-h-screen bg-gray-50 py-20">
        <div className="max-w-md mx-auto text-center px-4">
          <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
            <i className="ri-shopping-cart-line text-4xl text-gray-300"></i>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Your cart is empty</h1>
          <p className="text-gray-600 mb-8">Add some items to start the checkout process.</p>
          <Link href="/shop" className="inline-block bg-gold-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-gold-700 transition-colors">
            Return to Shop
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link href="/cart" className="text-gray-600 hover:text-gray-900 font-medium inline-flex items-center whitespace-nowrap">
            <i className="ri-arrow-left-line mr-2"></i>
            Back to Cart
          </Link>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-8">Checkout</h1>

        {/* Checkout Type Selection */}
        <div className="mb-6 bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Checkout As</h2>
          <div className="grid md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => !user && setCheckoutType('guest')}
              className={`p-4 rounded-xl border-2 transition-all text-left cursor-pointer ${checkoutType === 'guest'
                ? 'border-gold-500 bg-gold-50'
                : 'border-gray-200 hover:border-gray-300'
                } ${user ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={!!user}
            >
              <div className="flex items-center justify-between mb-2">
                <i className="ri-user-line text-2xl text-gold-600"></i>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${checkoutType === 'guest' ? 'border-gold-500 bg-gold-500' : 'border-gray-300'}`}>
                  {checkoutType === 'guest' && <i className="ri-check-line text-white text-xs"></i>}
                </div>
              </div>
              <h3 className="font-bold text-gray-900 mb-1">Guest Checkout</h3>
              <p className="text-xs text-gray-600">Quick checkout without an account</p>
              {user && <p className="text-xs text-gold-600 mt-1">You are logged in</p>}
            </button>

            {user ? (
              <div className="p-4 rounded-xl border-2 border-gold-500 bg-gold-50 text-left">
                <div className="flex items-center justify-between mb-2">
                  <i className="ri-account-circle-line text-2xl text-gold-600"></i>
                  <div className="w-5 h-5 rounded-full border-2 border-gold-500 bg-gold-500 flex items-center justify-center">
                    <i className="ri-check-line text-white text-xs"></i>
                  </div>
                </div>
                <h3 className="font-bold text-gray-900 mb-1">My Account</h3>
                <p className="text-xs text-gray-600">Logged in as {user.email}</p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => router.push('/auth/signup?redirect=/checkout')}
                className="p-4 rounded-xl border-2 border-gray-200 hover:border-gold-400 hover:bg-gold-50 transition-all text-left cursor-pointer"
              >
                <div className="flex items-center justify-between mb-2">
                  <i className="ri-account-circle-line text-2xl text-gold-600"></i>
                  <i className="ri-arrow-right-line text-xl text-gray-400"></i>
                </div>
                <h3 className="font-bold text-gray-900 mb-1">Create Account</h3>
                <p className="text-xs text-gray-600">
                  Sign up, then come back here to finish shipping &amp; earn loyalty points
                </p>
              </button>
            )}
          </div>

          {!user && (
            <div className="mt-4 pt-4 border-t border-gray-100 rounded-lg flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm text-gray-600">Already have an account?</p>
              <Link
                href="/auth/login?redirect=/checkout"
                className="text-sm font-bold text-gold-600 hover:text-gold-700 whitespace-nowrap"
              >
                Sign in <i className="ri-arrow-right-line align-middle"></i>
              </Link>
            </div>
          )}
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">

            {showValidationBanner && (Object.values(errors).some(Boolean) || (policyError && !acceptedPolicy)) && (
              <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 flex items-start gap-3">
                <i className="ri-error-warning-line text-red-600 text-xl mt-0.5"></i>
                <div>
                  <p className="font-semibold text-red-700">Almost there — a few things still need your attention</p>
                  <p className="text-sm text-red-600 mt-0.5">
                    The fields highlighted in red below are missing or invalid. Fix them and tap <span className="font-semibold">Proceed to Payment</span> again.
                  </p>
                </div>
              </div>
            )}

            {/* Shipping Information */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-5">Shipping Information</h2>

              {savedAddresses.length > 0 && (
                <div className="mb-6">
                  <p className="text-sm font-semibold text-gray-700 mb-2">
                    <i className="ri-map-pin-user-line mr-1 text-gold-600"></i>
                    Use a saved address
                  </p>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {savedAddresses.map((a: any) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => applySavedAddress(a)}
                        className={`text-left p-3 rounded-lg border-2 transition-all cursor-pointer ${selectedAddressId === a.id
                          ? 'border-gold-500 bg-gold-50'
                          : 'border-gray-200 hover:border-gray-300'
                          }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-gray-900 text-sm truncate">
                            {a.label || a.full_name}
                          </span>
                          {a.is_default && (
                            <span className="text-[10px] font-bold uppercase bg-gold-500 text-white px-1.5 py-0.5 rounded-full flex-shrink-0">Default</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 truncate mt-0.5">
                          {a.address_line1}, {a.city}{a.state ? ` — ${a.state}` : ''}
                        </p>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    Manage addresses in <Link href="/account?tab=addresses" className="underline hover:text-gray-600">your account</Link>.
                  </p>
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div data-shipping-error={errors.firstName ? 'true' : undefined} className="scroll-mt-24">
                    <label className="block text-sm font-semibold text-gray-900 mb-1.5">First Name *</label>
                    <input
                      type="text"
                      value={shippingData.firstName}
                      onChange={(e) => { setShippingData({ ...shippingData, firstName: e.target.value }); setErrors((prev: any) => ({ ...prev, firstName: '' })); }}
                      className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gold-300 focus:border-gold-400 ${errors.firstName ? 'border-red-500' : 'border-gray-300'}`}
                      placeholder="John"
                    />
                    {errors.firstName && <p className="text-sm text-red-600 mt-1 flex items-center gap-1"><i className="ri-error-warning-line"></i>{errors.firstName}</p>}
                  </div>
                  <div data-shipping-error={errors.lastName ? 'true' : undefined} className="scroll-mt-24">
                    <label className="block text-sm font-semibold text-gray-900 mb-1.5">Last Name *</label>
                    <input
                      type="text"
                      value={shippingData.lastName}
                      onChange={(e) => { setShippingData({ ...shippingData, lastName: e.target.value }); setErrors((prev: any) => ({ ...prev, lastName: '' })); }}
                      className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gold-300 focus:border-gold-400 ${errors.lastName ? 'border-red-500' : 'border-gray-300'}`}
                      placeholder="Doe"
                    />
                    {errors.lastName && <p className="text-sm text-red-600 mt-1 flex items-center gap-1"><i className="ri-error-warning-line"></i>{errors.lastName}</p>}
                  </div>
                </div>

                <div data-shipping-error={errors.email ? 'true' : undefined} className="scroll-mt-24">
                  <label className="block text-sm font-semibold text-gray-900 mb-1.5">
                    Email Address{' '}
                    {user
                      ? <span className="text-gray-400 font-normal">(from your account)</span>
                      : <span className="text-gray-400 font-normal">(optional)</span>}
                  </label>
                  <input
                    type="email"
                    value={shippingData.email}
                    readOnly={!!user}
                    onChange={(e) => { setShippingData({ ...shippingData, email: e.target.value }); setErrors((prev: any) => ({ ...prev, email: '' })); }}
                    className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gold-300 focus:border-gold-400 ${errors.email ? 'border-red-500' : 'border-gray-300'} ${user ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                    placeholder="you@example.com"
                  />
                  {errors.email && <p className="text-sm text-red-600 mt-1 flex items-center gap-1"><i className="ri-error-warning-line"></i>{errors.email}</p>}
                </div>

                <div data-shipping-error={errors.phone ? 'true' : undefined} className="scroll-mt-24">
                  <label className="block text-sm font-semibold text-gray-900 mb-1.5">Phone Number *</label>
                  <input
                    type="tel"
                    value={shippingData.phone}
                    onChange={(e) => { setShippingData({ ...shippingData, phone: e.target.value }); setErrors((prev: any) => ({ ...prev, phone: '' })); }}
                    className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gold-300 focus:border-gold-400 ${errors.phone ? 'border-red-500' : 'border-gray-300'}`}
                    placeholder="0241234567"
                  />
                  {errors.phone && <p className="text-sm text-red-600 mt-1 flex items-center gap-1"><i className="ri-error-warning-line"></i>{errors.phone}</p>}
                </div>


                <div data-shipping-error={errors.region && !selectedRegionType ? 'true' : undefined} className="scroll-mt-24">
                  <label className="block text-sm font-semibold text-gray-900 mb-1.5">Region *</label>
                  <select
                    value={selectedRegionType}
                    onChange={(e) => {
                      setSelectedRegionType(e.target.value);
                      setShippingData({ ...shippingData, region: '', city: '' });
                      setErrors((prev: any) => ({ ...prev, region: '', city: '' }));
                    }}
                    className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gold-300 focus:border-gold-400 ${errors.region && !selectedRegionType ? 'border-red-500' : 'border-gray-300'} bg-white`}
                  >
                    <option value="">Select Region</option>
                    <option value="greater_accra">Greater Accra</option>
                    <option value="other_regions">Other Regions</option>
                  </select>
                  {errors.region && !selectedRegionType && <p className="text-sm text-red-600 mt-1 flex items-center gap-1"><i className="ri-error-warning-line"></i>{errors.region}</p>}
                </div>

                {selectedRegionType === 'greater_accra' && (
                  <div data-shipping-error={errors.region && selectedRegionType === 'greater_accra' ? 'true' : undefined} className="relative scroll-mt-24">
                    <label className="block text-sm font-semibold text-gray-900 mb-1.5">Delivery Area *</label>
                    <DeliveryAreaPicker
                      zones={accraZones}
                      value={shippingData.region}
                      groupByRegion={false}
                      error={!!errors.region}
                      placeholder="Type to search your area…"
                      onChange={(name) => {
                        setShippingData({ ...shippingData, region: name });
                        setErrors((prev: any) => ({ ...prev, region: '' }));
                      }}
                      formatSelected={(z) => {
                        const p = previewZoneFee(z);
                        if (p.isFree) return `${z.name} — FREE`;
                        if (p.discounted) return `${z.name} — GH₵${p.final.toFixed(0)} (was GH₵${p.raw.toFixed(0)})`;
                        return `${z.name} — GH₵${p.final.toFixed(0)}`;
                      }}
                      renderOptionRight={(z) => {
                        const p = previewZoneFee(z);
                        return (
                          <span className="flex items-center gap-2 shrink-0">
                            {p.badge && (
                              <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                                {p.badge}
                              </span>
                            )}
                            {p.discounted && !p.isFree && (
                              <span className="text-xs text-gray-400 line-through">
                                GH₵{p.raw.toFixed(0)}
                              </span>
                            )}
                            <span className={`text-sm font-semibold ${p.isFree || p.discounted ? 'text-emerald-700' : 'text-gold-700'}`}>
                              {p.isFree ? 'FREE' : `${p.isFrom ? 'from ' : ''}GH₵${p.final.toFixed(0)}`}
                            </span>
                          </span>
                        );
                      }}
                    />
                    {errors.region && <p className="text-sm text-red-600 mt-1">{errors.region}</p>}
                  </div>
                )}

                {selectedRegionType === 'other_regions' && (
                  <div data-shipping-error={errors.region && selectedRegionType === 'other_regions' ? 'true' : undefined} className="relative scroll-mt-24">
                    <label className="block text-sm font-semibold text-gray-900 mb-1.5">City *</label>
                    <DeliveryAreaPicker
                      zones={outsideZones}
                      value={shippingData.region}
                      groupByRegion={false}
                      error={!!errors.region}
                      placeholder="Type to search your city…"
                      onChange={(name) => {
                        setShippingData({ ...shippingData, region: name });
                        setErrors((prev: any) => ({ ...prev, region: '' }));
                      }}
                      formatSelected={(z) => {
                        const p = previewZoneFee(z);
                        if (p.isFree) return `${z.name} — FREE`;
                        if (p.discounted) return `${z.name} — GH₵${p.final.toFixed(0)} (was GH₵${p.raw.toFixed(0)})`;
                        return `${z.name} — GH₵${p.final.toFixed(0)}`;
                      }}
                      renderOptionRight={(z) => {
                        const p = previewZoneFee(z);
                        return (
                          <span className="flex items-center gap-2 shrink-0">
                            {p.badge && (
                              <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                                {p.badge}
                              </span>
                            )}
                            {p.discounted && !p.isFree && (
                              <span className="text-xs text-gray-400 line-through">
                                GH₵{p.raw.toFixed(0)}
                              </span>
                            )}
                            <span className={`text-sm font-semibold ${p.isFree || p.discounted ? 'text-emerald-700' : 'text-gray-900'}`}>
                              {p.isFree ? 'FREE' : `${p.isFrom ? 'from ' : ''}GH₵${p.final.toFixed(0)}`}
                            </span>
                          </span>
                        );
                      }}
                    />
                    {errors.region && <p className="text-sm text-red-600 mt-2">{errors.region}</p>}
                  </div>
                )}

              </div>
            </div>

            {/* Delivery Info */}
            {shippingData.region && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-4">Delivery</h2>

                {settings.deliveryUnavailable ? (
                  <div className="p-5 bg-red-50 border border-red-200 rounded-xl text-center">
                    <i className="ri-truck-line text-3xl text-red-400 mb-2 block"></i>
                    <h3 className="text-lg font-bold text-red-900 mb-1">Delivery Unavailable Today</h3>
                    <p className="text-sm text-red-700">We are not dispatching deliveries at this time. Please check back later.</p>
                  </div>
                ) : (
                  <>
                    {outsideAccraTooManyItems ? (
                      <div className="p-5 bg-amber-50 border-2 border-amber-300 rounded-xl text-center">
                        <i className="ri-customer-service-2-line text-3xl text-amber-500 mb-2 block"></i>
                        <h3 className="text-lg font-bold text-amber-900 mb-1">Contact Us for Delivery Quote</h3>
                        <p className="text-sm text-amber-700 mb-3">
                          For 3 or more items outside Accra, delivery fees are quoted individually. Please reach out to us for a price.
                        </p>
                        <div className="flex items-center justify-center gap-4 text-sm font-semibold flex-wrap">
                          {contactWhatsappUrl && (
                            <a href={contactWhatsappUrl} target="_blank" rel="noopener noreferrer" className="text-green-700 hover:underline flex items-center gap-1">
                              <i className="ri-whatsapp-line"></i> WhatsApp
                            </a>
                          )}
                          {contactWhatsappUrl && contactInstagramUrl && (
                            <span className="text-gray-300">|</span>
                          )}
                          {contactInstagramUrl && (
                            <a href={contactInstagramUrl} target="_blank" rel="noopener noreferrer" className="text-pink-700 hover:underline flex items-center gap-1">
                              <i className="ri-instagram-line"></i> Instagram
                            </a>
                          )}
                        </div>
                      </div>
                    ) : hasMethods ? (
                      <div data-shipping-error={errors.deliveryMethod ? 'true' : undefined} className="scroll-mt-24">
                        <p className="text-sm font-semibold text-gray-900 mb-2">Choose a delivery method *</p>
                        <div className="space-y-3">
                          {zoneMethods.map((m: any) => {
                            const methodKey = String(m.id ?? m.name);
                            const rawFee = Number(m.fee) || 0;
                            const finalFee = applyZoneFeeAdjustments(rawFee);
                            const isSelected = selectedMethodId === methodKey;
                            return (
                              <label
                                key={methodKey}
                                className={`flex items-center justify-between p-4 border-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'border-gold-500 bg-gold-50' : errors.deliveryMethod ? 'border-red-300' : 'border-gray-200 hover:border-gray-300'}`}
                              >
                                <div className="flex items-center">
                                  <input
                                    type="radio"
                                    name="delivery_method"
                                    checked={isSelected}
                                    onChange={() => {
                                      setSelectedMethodId(methodKey);
                                      setErrors((prev: any) => ({ ...prev, deliveryMethod: '' }));
                                    }}
                                    className="w-5 h-5 text-gold-600 mr-3"
                                  />
                                  <div>
                                    <p className="font-semibold text-gray-900">{m.name}</p>
                                    {m.description && <p className="text-sm text-gray-600">{m.description}</p>}
                                  </div>
                                </div>
                                <div className="text-right">
                                  {finalFee < rawFee && (
                                    <p className="text-xs text-gray-400 line-through">GH₵ {rawFee.toFixed(2)}</p>
                                  )}
                                  <p className="font-bold text-gray-900">
                                    {finalFee === 0 ? 'FREE' : `GH₵ ${finalFee.toFixed(2)}`}
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                        {errors.deliveryMethod && <p className="text-sm text-red-600 mt-2">{errors.deliveryMethod}</p>}
                        {deliveryPromoBlocked && (
                          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 flex items-start gap-2">
                            <i className="ri-information-line mt-0.5"></i>
                            <span>
                              Delivery discounts can&apos;t be combined with coupons, Sleek Points, or other promotions — full delivery fee applies.
                              Sale items in your cart are fine and do not block delivery discounts.
                            </span>
                          </p>
                        )}
                        {deliveryDiscountEligible && freeByItemCount && (
                          <p className="text-sm text-emerald-700 font-medium mt-2 flex items-center gap-1">
                            <i className="ri-gift-line"></i> Free delivery — you have {totalItems}+ items in your cart!
                          </p>
                        )}
                        {deliveryDiscountEligible && !freeByItemCount && zoneFreeDelivery && (
                          <p className="text-sm text-emerald-700 font-medium mt-2 flex items-center gap-1">
                            <i className="ri-gift-line"></i> Free delivery to {activeZone?.name} right now!
                          </p>
                        )}
                        {deliveryDiscountEligible && !freeByItemCount && !zoneFreeDelivery && zoneFee > shippingCost && (
                          <p className="text-sm text-emerald-700 font-medium mt-2 flex items-center gap-1">
                            <i className="ri-percent-line"></i>
                            {effectiveDeliveryDiscountPercent(zoneFee, shippingCost)}% off delivery to {activeZone?.name} applied
                            {(zoneDiscountPercent > 0 && promotions.globalDeliveryDiscountPercent > 0)
                              ? ` (area ${zoneDiscountPercent}% + store-wide ${promotions.globalDeliveryDiscountPercent}%)`
                              : ''}
                          </p>
                        )}
                        {deliveryDiscountEligible && !freeByItemCount && promotions.freeDeliveryMinItems > 0 && totalItems < promotions.freeDeliveryMinItems && (
                          <p className="text-sm text-gray-600 mt-2 flex items-center gap-1">
                            <i className="ri-information-line"></i> Add {promotions.freeDeliveryMinItems - totalItems} more item{promotions.freeDeliveryMinItems - totalItems === 1 ? '' : 's'} for free delivery
                          </p>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="p-4 border-2 border-gold-300 bg-gold-50 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-semibold text-gray-900">
                                {settings.sameDayDelivery ? 'Same-Day Delivery' : settings.nextDayDelivery ? 'Next-Day Delivery' : 'Standard Delivery'}
                              </p>
                              <p className="text-sm text-gray-600">
                                {settings.sameDayDelivery
                                  ? 'All orders placed today will be delivered today.'
                                  : settings.nextDayDelivery
                                    ? 'All orders placed today will be delivered tomorrow.'
                                    : `Within ${isAccra ? '1-2' : '3-5'} business days`
                                }
                              </p>
                            </div>
                            <div className="text-right">
                              {deliveryDiscountEligible && (zoneFreeDelivery || freeByItemCount || zoneDiscountPercent > 0 || promotions.globalDeliveryDiscountPercent > 0) && zoneFee > shippingCost && (
                                <p className="text-xs text-gray-400 line-through">GH₵ {zoneFee.toFixed(2)}</p>
                              )}
                              <p className="font-bold text-gray-900">
                                {shippingCost === 0 && deliveryDiscountEligible && (zoneFreeDelivery || freeByItemCount) ? 'FREE' : `GH₵ ${shippingCost.toFixed(2)}`}
                              </p>
                            </div>
                          </div>
                        </div>

                        {deliveryPromoBlocked && (
                          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3 flex items-start gap-2">
                            <i className="ri-information-line mt-0.5"></i>
                            <span>
                              Delivery discounts can&apos;t be combined with coupons, Sleek Points, or other promotions — full delivery fee applies.
                            </span>
                          </p>
                        )}

                        {!isAccra && activeZone?.transport_service && (
                          <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-start gap-2">
                            <i className="ri-bus-line text-gray-600 mt-0.5"></i>
                            <p className="text-sm text-gray-700">
                              Delivery to <strong>{activeZone.name}</strong> via <strong>{activeZone.transport_service}</strong>.
                              {totalItems === 2 && (
                                <span className="block mt-1 text-gray-500">
                                  Fee: GH₵ {baseFee.toFixed(2)} + GH₵ {perItemFee.toFixed(2)} (2nd item) = GH₵ {shippingCost.toFixed(2)}
                                </span>
                              )}
                            </p>
                          </div>
                        )}
                      </>
                    )}

                    <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                      <i className="ri-map-pin-line text-amber-600 mt-0.5"></i>
                      <p className="text-sm text-amber-800">
                        Don&apos;t see your location? Contact us on <strong>WhatsApp</strong> or <strong>Instagram</strong>.
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Payment Breakdown for Accra */}
            {isAccra && shippingData.region && !settings.deliveryUnavailable && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-4">Payment Option</h2>
                <div className="space-y-3">
                  <label className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors ${paymentOption === 'full_payment' ? 'border-gold-500 bg-gold-50' : 'border-gray-200'}`}>
                    <input type="radio" name="payment_option" value="full_payment" checked={paymentOption === 'full_payment'} onChange={() => setPaymentOption('full_payment')} className="w-5 h-5 text-gold-600 mt-0.5 mr-3" />
                    <div>
                      <p className="font-semibold text-gray-900">Pay Full Amount Now</p>
                      <p className="text-sm text-gray-600">Item cost + Delivery Fee</p>
                    </div>
                  </label>
                  <label className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors ${paymentOption === 'item_only' ? 'border-gold-500 bg-gold-50' : 'border-gray-200'}`}>
                    <input type="radio" name="payment_option" value="item_only" checked={paymentOption === 'item_only'} onChange={() => setPaymentOption('item_only')} className="w-5 h-5 text-gold-600 mt-0.5 mr-3" />
                    <div>
                      <p className="font-semibold text-gray-900">Pay Item Cost Only</p>
                      <p className="text-sm text-gray-600">Pay delivery fee upon delivery</p>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {!isAccra && shippingData.region && !settings.deliveryUnavailable && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold block mb-1">Note for deliveries outside Accra:</span>
                    Full payment (Item + Delivery) is required before shipping.
                  </p>
                </div>
              </div>
            )}

            {/* Coupon */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-3">Have a promo code?</h3>
              {couponApplied ? (
                <div className="flex items-center justify-between p-3 bg-gold-50 border border-gold-200 rounded-lg">
                  <div>
                    <p className="font-semibold text-gold-800 flex items-center gap-2">
                      <i className="ri-coupon-3-line"></i>
                      {couponApplied.code}
                    </p>
                    <p className="text-sm text-gold-600">
                      {couponApplied.type === 'percentage' ? `${couponApplied.value}% off` : couponApplied.type === 'free_shipping' ? 'Free shipping' : `GH₵ ${couponApplied.value} off`}
                      {couponApplied.type !== 'free_shipping' && <>{' '}&bull; Saving GH₵ {couponDiscount.toFixed(2)}</>}
                    </p>
                    {couponApplied.type !== 'free_shipping' && wouldHaveDeliveryPromo && (
                      <p className="text-xs text-amber-700 mt-1">
                        Delivery discounts are paused while a coupon is applied.
                      </p>
                    )}
                  </div>
                  <button onClick={removeCoupon} className="text-red-500 hover:text-red-700 cursor-pointer p-1">
                    <i className="ri-close-circle-line text-xl"></i>
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                      className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-300 focus:border-gold-400 uppercase"
                      placeholder="Enter promo code"
                    />
                    <button
                      onClick={handleApplyCoupon}
                      disabled={couponLoading || !couponCode.trim()}
                      className="px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      {couponLoading ? 'Applying...' : 'Apply'}
                    </button>
                  </div>
                  {couponError && (
                    <p className="text-sm text-red-600 mt-2 flex items-center gap-1">
                      <i className="ri-error-warning-line"></i> {couponError}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Loyalty Points */}
            {user && promotions.loyaltyEnabled && loyaltyPoints >= promotions.loyaltyMinRedeem && !couponApplied && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex items-start">
                  <div className="flex-1">
                    <h3 className="font-bold text-gold-900 flex items-center gap-2">
                      <i className="ri-award-line"></i> Loyalty Reward Available
                    </h3>
                    <p className="text-sm text-gold-700 mt-1">
                      You have <b>{loyaltyPoints} points</b> (1 point = GH₵ {promotions.loyaltyPointValueGhs} discount).
                      {redeemPoints && <span className="block mt-1">Applying <b>GH₵ {pointsDiscount.toFixed(2)}</b> discount.</span>}
                      {redeemPoints && wouldHaveDeliveryPromo && (
                        <span className="block mt-1 text-amber-700 text-xs">
                          Delivery discounts are paused while Sleek Points are redeemed.
                        </span>
                      )}
                    </p>
                  </div>
                  <label className="flex items-center space-x-2 cursor-pointer mt-1">
                    <div className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out ${redeemPoints ? 'bg-gold-500' : 'bg-gray-300'}`}>
                      <div className={`bg-white w-4 h-4 rounded-full shadow-md transform duration-200 ease-in-out ${redeemPoints ? 'translate-x-6' : 'translate-x-0'}`}></div>
                    </div>
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={redeemPoints}
                      onChange={(e) => setRedeemPoints(e.target.checked)}
                    />
                  </label>
                </div>
              </div>
            )}

            {/* Delivery Notes */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <label className="block text-sm font-semibold text-gray-900 mb-2">Delivery Notes (Optional)</label>
              <textarea
                value={deliveryNotes}
                onChange={(e) => setDeliveryNotes(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-300 focus:border-gold-400"
                placeholder="Kindly note that not all requests can be accommodated"
                rows={3}
              ></textarea>
            </div>

            {/* Exchange & Refund Policy */}
            <div id="policy-accept-box" className="bg-white rounded-xl shadow-sm p-6 scroll-mt-24">
              <div className={`p-5 rounded-lg border-2 transition-colors ${policyError && !acceptedPolicy ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-200'}`}>
                <label className="flex items-start space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptedPolicy}
                    onChange={(e) => { setAcceptedPolicy(e.target.checked); if (e.target.checked) setPolicyError(false); }}
                    className="w-5 h-5 text-gold-600 rounded border-gray-300 focus:ring-gold-400 mt-0.5"
                  />
                  <div className={`text-sm font-medium ${policyError && !acceptedPolicy ? 'text-red-700' : 'text-gray-900'}`}>
                    I have read and agree to the <Link href="/policy" target="_blank" className="text-gold-600 underline hover:text-gold-700">Exchange & Refund Policy</Link>
                  </div>
                </label>
                {policyError && !acceptedPolicy && (
                  <p className="mt-2 ml-8 text-sm text-red-600 flex items-center gap-1">
                    <i className="ri-error-warning-line"></i>
                    Please tick this box to confirm you&apos;ve read the policy.
                  </p>
                )}
              </div>
            </div>

            {/* Place Order Button */}
            <button
              onClick={handleProceedToPayment}
              disabled={isLoading || !acceptedPolicy || settings.deliveryUnavailable || outsideAccraTooManyItems}
              className="w-full bg-gold-600 hover:bg-gold-700 text-white py-4 rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer flex items-center justify-center text-lg shadow-lg"
            >
              {isLoading ? (
                <>
                  <i className="ri-loader-4-line animate-spin mr-2"></i>
                  Processing...
                </>
              ) : (
                <>
                  Proceed to Payment — GH₵ {payableNow.toFixed(2)}
                  <i className="ri-arrow-right-line ml-2"></i>
                </>
              )}
            </button>

          </div>

          <div className="lg:col-span-1">
            <OrderSummary
              items={cart}
              subtotal={subtotal}
              shipping={shippingCost}
              tax={tax}
              discount={totalDiscount}
              total={total}
              payableNow={payableNow}
              payLater={deliveryFeeToPayLater}
            />
          </div>
        </div>
      </div>

      {/* Payment Method Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 text-center border-b border-gray-100">
              <div className="w-14 h-14 bg-gold-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <i className="ri-bank-card-line text-2xl text-gold-600"></i>
              </div>
              <h3 className="text-xl font-bold text-gray-900">Choose Payment Method</h3>
              <p className="text-sm text-gray-500 mt-1">How would you like to pay?</p>
            </div>

            <div className="p-6 space-y-3">
              {/* Pay by Card (Paystack) */}
              <button
                onClick={() => handlePlaceOrder('paystack')}
                disabled={isLoading}
                className="w-full flex items-center gap-4 p-4 border-2 border-gray-200 rounded-xl hover:border-gold-400 hover:bg-gold-50 transition-all cursor-pointer group disabled:opacity-50"
              >
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center group-hover:bg-blue-100 transition-colors flex-shrink-0">
                  <i className="ri-bank-card-2-line text-2xl text-blue-600"></i>
                </div>
                <div className="text-left flex-1">
                  <p className="font-bold text-gray-900">Pay by Card</p>
                  <p className="text-xs text-gray-500">Visa, Mastercard & more via Paystack</p>
                </div>
                <i className="ri-arrow-right-s-line text-xl text-gray-400 group-hover:text-gold-500 transition-colors"></i>
              </button>

              {/* Pay by MoMo (Moolre) */}
              <button
                onClick={() => handlePlaceOrder('moolre')}
                disabled={isLoading}
                className="w-full flex items-center gap-4 p-4 border-2 border-gray-200 rounded-xl hover:border-gold-400 hover:bg-gold-50 transition-all cursor-pointer group disabled:opacity-50"
              >
                <div className="w-12 h-12 bg-yellow-50 rounded-xl flex items-center justify-center group-hover:bg-yellow-100 transition-colors flex-shrink-0">
                  <i className="ri-smartphone-line text-2xl text-yellow-600"></i>
                </div>
                <div className="text-left flex-1">
                  <p className="font-bold text-gray-900">Pay by Mobile Money</p>
                  <p className="text-xs text-gray-500">MTN MoMo, Vodafone Cash & more</p>
                </div>
                <i className="ri-arrow-right-s-line text-xl text-gray-400 group-hover:text-gold-500 transition-colors"></i>
              </button>
            </div>

            <div className="px-6 pb-6">
              <button
                onClick={() => setShowPaymentModal(false)}
                className="w-full py-3 border-2 border-gray-200 rounded-xl text-gray-600 font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>

            <div className="bg-gray-50 px-6 py-3 text-center">
              <p className="text-xs text-gray-400 flex items-center justify-center gap-1">
                <i className="ri-shield-check-line"></i>
                Your payment is secure and encrypted
              </p>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
