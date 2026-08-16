import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAccessToken } from '@/server/auth';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import {
  applyDeliveryFeeAdjustments,
  isDeliveryDiscountEligible,
  loyaltyDiscountAmount,
  parsePromotions,
  pointsToRedeemForDiscount,
  storewideDiscountAmount,
  type StorePromotions,
} from '@/lib/promotions';

type CheckoutItem = {
  productId: string;
  variantId?: string | null;
  quantity: number;
};

type CheckoutShipping = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  region?: string;
  regionType?: 'greater_accra' | 'other_regions' | string;
};

function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  return bearer || null;
}

async function loadPromotions(): Promise<StorePromotions> {
  const { data, error } = await supabaseAdmin
    .from('store_settings')
    .select('key, value')
    .in('key', [
      'storewide_sale_enabled',
      'storewide_sale_percent',
      'storewide_sale_name',
      'global_delivery_discount_percent',
      'free_delivery_min_items',
      'loyalty_enabled',
      'loyalty_points_per_item',
      'loyalty_min_redeem',
      'loyalty_expiry_months',
      'loyalty_point_value_ghs',
    ]);

  if (error) {
    console.error('[checkout] promotions load failed:', error.message);
    return parsePromotions(null);
  }
  return parsePromotions(data);
}

export async function POST(request: Request) {
  try {
    const clientId = getClientIdentifier(request);
    const rl = checkRateLimit(`checkout:${clientId}`, RATE_LIMITS.default);
    if (!rl.success) {
      return NextResponse.json(
        { error: 'Too many checkout attempts. Please wait a moment.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const {
      items,
      shipping,
      paymentMethod,
      paymentOption = 'full_payment',
      couponCode,
      pointsToRedeem,
      deliveryNotes,
      deliveryZoneId,
      shippingMethodName,
    } = body as {
      items: CheckoutItem[];
      shipping: CheckoutShipping;
      paymentMethod: 'paystack' | 'moolre';
      paymentOption?: 'full_payment' | 'item_only';
      couponCode?: string;
      pointsToRedeem?: number;
      deliveryNotes?: string;
      deliveryZoneId?: string;
      shippingMethodName?: string;
    };

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }
    if (!shipping?.phone) {
      return NextResponse.json({ error: 'Phone is required' }, { status: 400 });
    }
    if (!paymentMethod || !['paystack', 'moolre'].includes(paymentMethod)) {
      return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 });
    }

    const token = extractBearerToken(request);
    const verified = token ? await verifyAccessToken(token) : null;
    const userId = verified?.sub || null;

    const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))];
    const variantIds = [...new Set(items.map((i) => i.variantId).filter(Boolean))] as string[];

    const [productsRes, variantsRes, promotions] = await Promise.all([
      supabaseAdmin.from('products').select('id, name, slug, price, status, quantity, sku').in('id', productIds),
      variantIds.length > 0
        ? supabaseAdmin.from('product_variants').select('id, product_id, price, quantity, sku, name, size, color').in('id', variantIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      loadPromotions(),
    ]);

    if (productsRes.error) {
      return NextResponse.json({ error: productsRes.error.message }, { status: 400 });
    }
    if (variantsRes.error) {
      return NextResponse.json({ error: variantsRes.error.message }, { status: 400 });
    }

    const productMap = new Map<string, any>((productsRes.data || []).map((p: any) => [p.id, p]));
    const variantMap = new Map<string, any>((variantsRes.data || []).map((v: any) => [v.id, v]));

    let subtotal = 0;
    const orderLineItems: any[] = [];

    for (const item of items) {
      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
      const product = productMap.get(item.productId);
      if (!product || product.status !== 'active') {
        return NextResponse.json({ error: `Product unavailable: ${item.productId}` }, { status: 400 });
      }

      const variant = item.variantId ? variantMap.get(item.variantId) : null;
      if (item.variantId && (!variant || variant.product_id !== product.id)) {
        return NextResponse.json({ error: 'Invalid product variant' }, { status: 400 });
      }

      const unitPrice =
        variant && Number(variant.price) > 0
          ? Number(variant.price)
          : Number(product.price) || 0;

      const available = variant ? Number(variant.quantity) || 0 : Number(product.quantity) || 0;
      if (available < qty) {
        return NextResponse.json(
          { error: `Insufficient stock for ${product.name}` },
          { status: 400 }
        );
      }

      const lineTotal = unitPrice * qty;
      subtotal += lineTotal;

      orderLineItems.push({
        product_id: product.id,
        variant_id: variant?.id || null,
        product_name: product.name,
        variant_name: variant?.name || null,
        sku: variant?.sku || product.sku || null,
        quantity: qty,
        unit_price: unitPrice,
        total_price: lineTotal,
        metadata: {
          slug: product.slug,
          variant_id: variant?.id || null,
          size: variant?.size || null,
          color: variant?.color || null,
        },
      });
    }

    const totalItems = orderLineItems.reduce((sum, li) => sum + li.quantity, 0);
    const storewideDiscount = storewideDiscountAmount(subtotal, promotions);
    const merchandiseAfterSale = Math.max(0, subtotal - storewideDiscount);

    let couponApplied: any = null;
    let couponDiscount = 0;

    if (couponCode?.trim()) {
      const { data: coupon, error: couponError } = await supabaseAdmin
        .from('coupons')
        .select('*')
        .eq('code', couponCode.trim().toUpperCase())
        .eq('is_active', true)
        .maybeSingle();

      if (couponError || !coupon) {
        return NextResponse.json({ error: 'Invalid or expired coupon code' }, { status: 400 });
      }
      if (coupon.start_date && new Date(coupon.start_date) > new Date()) {
        return NextResponse.json({ error: 'This coupon is not yet active' }, { status: 400 });
      }
      if (coupon.end_date && new Date(coupon.end_date) < new Date()) {
        return NextResponse.json({ error: 'This coupon has expired' }, { status: 400 });
      }
      if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) {
        return NextResponse.json({ error: 'This coupon has reached its usage limit' }, { status: 400 });
      }
      if (coupon.minimum_purchase && merchandiseAfterSale < coupon.minimum_purchase) {
        return NextResponse.json(
          { error: `Minimum purchase of GH₵ ${coupon.minimum_purchase} required` },
          { status: 400 }
        );
      }

      if (coupon.type === 'percentage') {
        couponDiscount = (merchandiseAfterSale * coupon.value) / 100;
        if (coupon.maximum_discount) {
          couponDiscount = Math.min(couponDiscount, coupon.maximum_discount);
        }
      } else if (coupon.type === 'fixed_amount') {
        couponDiscount = Math.min(coupon.value, merchandiseAfterSale);
      } else if (coupon.type !== 'free_shipping') {
        couponDiscount = Math.min(coupon.value, merchandiseAfterSale);
      }

      couponApplied = coupon;
    }

    let loyaltyBalance = 0;
    if (userId) {
      const { data: pointsRow } = await supabaseAdmin
        .from('loyalty_points')
        .select('points')
        .eq('user_id', userId)
        .maybeSingle();
      loyaltyBalance = Number(pointsRow?.points) || 0;
    }

    const redeemRequested = Number(pointsToRedeem) > 0;
    const pointsDiscount =
      redeemRequested && !couponApplied && userId
        ? loyaltyDiscountAmount(loyaltyBalance, true, merchandiseAfterSale, promotions)
        : 0;
    const pointsToDeduct =
      pointsDiscount > 0 ? pointsToRedeemForDiscount(pointsDiscount, promotions) : 0;

    const totalDiscount = storewideDiscount + (couponApplied ? couponDiscount : pointsDiscount);

    const deliveryDiscountEligible = isDeliveryDiscountEligible({
      hasCoupon: !!couponApplied,
      hasLoyaltyRedeem: pointsDiscount > 0,
      hasStorewideSale: storewideDiscount > 0,
    });

    let activeZone: any = null;
    if (deliveryZoneId) {
      const { data: zone } = await supabaseAdmin
        .from('delivery_zones')
        .select('*')
        .eq('id', deliveryZoneId)
        .eq('is_active', true)
        .maybeSingle();
      activeZone = zone;
    } else if (shipping.region) {
      const { data: zone } = await supabaseAdmin
        .from('delivery_zones')
        .select('*')
        .eq('name', shipping.region)
        .eq('is_active', true)
        .maybeSingle();
      activeZone = zone;
    }

    const isAccra = shipping.regionType === 'greater_accra' || !!activeZone?.is_accra;
    const zoneMethods: any[] = Array.isArray(activeZone?.methods)
      ? activeZone.methods.filter((m: any) => m && m.name && m.active !== false)
      : [];
    const hasMethods = zoneMethods.length > 0;
    const selectedMethod = shippingMethodName
      ? zoneMethods.find((m: any) => m.name === shippingMethodName) || null
      : null;

    if (hasMethods && !selectedMethod) {
      return NextResponse.json({ error: 'Please choose a delivery method' }, { status: 400 });
    }

    const baseFee = Number(activeZone?.base_fee) || 0;
    const perItemFee = Number(activeZone?.per_item_fee) || 0;
    const outsideAccraTooManyItems = !isAccra && activeZone && totalItems >= 3 && !hasMethods;
    if (outsideAccraTooManyItems) {
      return NextResponse.json(
        { error: 'Contact us for delivery quote (3+ items outside Accra)' },
        { status: 400 }
      );
    }

    const zoneFee = hasMethods
      ? Number(selectedMethod?.fee) || 0
      : isAccra
        ? baseFee
        : totalItems <= 1
          ? baseFee
          : totalItems === 2
            ? baseFee + perItemFee
            : 0;

    const zoneDiscountPercent = Math.min(100, Math.max(0, Number(activeZone?.discount_percent) || 0));
    const zoneFreeDelivery = !!activeZone?.free_delivery;
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

    const shippingCost = applyZoneFeeAdjustments(
      couponApplied?.type === 'free_shipping' ? 0 : zoneFee
    );

    const effectivePaymentOption =
      !isAccra && paymentOption === 'item_only' ? 'full_payment' : paymentOption;

    const tax = 0;
    const totalBeforeSplit = Math.max(0, subtotal + shippingCost + tax - totalDiscount);
    const deliveryFeeToPayLater = effectivePaymentOption === 'item_only' ? shippingCost : 0;
    const payableNow = Math.max(0, totalBeforeSplit - deliveryFeeToPayLater);
    const total = totalBeforeSplit;

    const deliveryPromoBlocked =
      !deliveryDiscountEligible &&
      (zoneFreeDelivery ||
        (promotions.freeDeliveryMinItems > 0 && totalItems >= promotions.freeDeliveryMinItems) ||
        zoneDiscountPercent > 0 ||
        promotions.globalDeliveryDiscountPercent > 0) &&
      couponApplied?.type !== 'free_shipping';

    const cleanedPhoneForEmail = (shipping.phone || '').replace(/\D/g, '') || 'unknown';
    const orderEmail =
      shipping.email && shipping.email.includes('@')
        ? shipping.email
        : `guest-${cleanedPhoneForEmail}@hystepper.local`;

    const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const shippingAddress = {
      firstName: shipping.firstName || '',
      lastName: shipping.lastName || '',
      email: shipping.email || '',
      phone: shipping.phone || '',
      address: shipping.address || '',
      city: shipping.city || '',
      region: shipping.region || activeZone?.name || '',
    };

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        order_number: orderNumber,
        user_id: userId,
        email: orderEmail,
        phone: shipping.phone,
        status: 'pending',
        payment_status: 'pending',
        currency: 'GHS',
        subtotal,
        tax_total: tax,
        shipping_total: shippingCost,
        discount_total: totalDiscount,
        total,
        shipping_method: selectedMethod?.name || shippingMethodName || 'standard',
        payment_method: paymentMethod,
        payment_option: effectivePaymentOption,
        delivery_notes: deliveryNotes || '',
        points_redeemed: pointsToDeduct > 0 ? pointsToDeduct : 0,
        points_discount: pointsDiscount,
        shipping_address: shippingAddress,
        billing_address: shippingAddress,
        metadata: {
          guest_checkout: !userId,
          first_name: shipping.firstName,
          last_name: shipping.lastName,
          region: shipping.region || activeZone?.name || null,
          delivery_zone_id: activeZone?.id || deliveryZoneId || null,
          delivery_method: selectedMethod?.name || shippingMethodName || null,
          delivery_fee_waived: deliveryDiscountEligible && (zoneFreeDelivery || freeByItemCount) ? true : undefined,
          delivery_fee_discount_percent:
            deliveryDiscountEligible && zoneDiscountPercent > 0 ? zoneDiscountPercent : undefined,
          global_delivery_discount_percent:
            deliveryDiscountEligible && promotions.globalDeliveryDiscountPercent > 0
              ? promotions.globalDeliveryDiscountPercent
              : undefined,
          free_delivery_min_items:
            deliveryDiscountEligible && freeByItemCount ? promotions.freeDeliveryMinItems : undefined,
          delivery_discount_blocked: deliveryPromoBlocked || undefined,
          storewide_sale_percent: storewideDiscount > 0 ? promotions.storewideSalePercent : undefined,
          storewide_sale_discount: storewideDiscount > 0 ? storewideDiscount : undefined,
          storewide_sale_name: storewideDiscount > 0 ? promotions.storewideSaleName || null : undefined,
          payable_now: payableNow,
          delivery_fee_due: deliveryFeeToPayLater,
          coupon_code: couponApplied?.code || null,
          coupon_discount: couponDiscount || 0,
        },
      })
      .select()
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: orderError?.message || 'Failed to create order' }, { status: 400 });
    }

    const orderItemsPayload = orderLineItems.map((li) => ({
      ...li,
      order_id: order.id,
    }));

    const { error: itemsError } = await supabaseAdmin.from('order_items').insert(orderItemsPayload);
    if (itemsError) {
      await supabaseAdmin.from('orders').delete().eq('id', order.id);
      return NextResponse.json({ error: itemsError.message }, { status: 400 });
    }

    if (couponApplied?.id) {
      const { error: couponRpcError } = await supabaseAdmin.rpc('increment_coupon_usage', {
        coupon_id: couponApplied.id,
      });
      if (couponRpcError) {
        console.error('[checkout] increment_coupon_usage failed:', couponRpcError.message);
      }
    }

    if (pointsToDeduct > 0 && userId) {
      const { error: redeemError } = await supabaseAdmin.rpc('redeem_loyalty_points', {
        p_user_id: userId,
        p_points: pointsToDeduct,
        p_order_id: order.id,
      });
      if (redeemError) {
        console.error('[checkout] redeem_loyalty_points failed:', redeemError.message);
        await supabaseAdmin.from('order_items').delete().eq('order_id', order.id);
        await supabaseAdmin.from('orders').delete().eq('id', order.id);
        return NextResponse.json({ error: 'Could not redeem loyalty points' }, { status: 400 });
      }
    }

    if (payableNow <= 0) {
      await supabaseAdmin
        .from('orders')
        .update({ payment_status: 'paid', status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', order.id);

      const { error: stockError } = await supabaseAdmin.rpc('decrement_order_stock', {
        order_ref: order.id,
      });
      if (stockError) {
        console.error('[checkout] decrement_order_stock failed:', stockError.message);
      }
    }

    return NextResponse.json({
      order: {
        ...order,
        order_number: orderNumber,
        payment_status: payableNow <= 0 ? 'paid' : order.payment_status,
        status: payableNow <= 0 ? 'processing' : order.status,
      },
      payableNow,
    });
  } catch (err: any) {
    console.error('[checkout/create-order] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
