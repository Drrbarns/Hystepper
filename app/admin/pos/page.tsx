'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { adminAuthHeaders } from '@/lib/admin-auth-headers';
import { compareSizes } from '@/lib/sort-sizes';
import LazyImage from '@/components/LazyImage';

interface Variant {
    id: string;
    name: string;
    sku: string | null;
    price: number;
    quantity: number;
    option1: string | null;
    option2: string | null;
    image_url: string | null;
}

interface Product {
    id: string;
    name: string;
    price: number;
    quantity: number;
    category: string;
    image: string;
    sku: string;
    variants: Variant[];
}

interface CartItem {
    // Composite key: productId if no variant, else `${productId}:${variantId}`.
    key: string;
    productId: string;
    variantId: string | null;
    name: string;        // Product name
    variantLabel: string | null; // Human label like "UK 9 / Black"
    price: number;
    image: string;
    sku: string | null;
    stock: number;       // available stock for this line
    cartQuantity: number;
}

interface Customer {
    id: string;
    full_name: string;
    email: string;
    phone?: string;
}

export default function POSPage() {
    const [products, setProducts] = useState<Product[]>([]);
    const [categories, setCategories] = useState<string[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [activeCategory, setActiveCategory] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);

    // Variant picker modal
    const [variantProduct, setVariantProduct] = useState<Product | null>(null);

    // Store contact info — printed on receipts.
    const [storeContact, setStoreContact] = useState<{ phone: string; address: string }>({
        phone: '',
        address: '',
    });

    // Checkout State
    const [showCheckoutModal, setShowCheckoutModal] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [paymentMethod, setPaymentMethod] = useState('cash');
    const [amountTendered, setAmountTendered] = useState<string>('');
    const [processing, setProcessing] = useState(false);
    const [completedOrder, setCompletedOrder] = useState<any>(null);
    const [orderType, setOrderType] = useState<'walk_in' | 'delivery'>('walk_in');
    // Delivery zones — same source the public checkout uses, so prices stay in sync.
    const [deliveryZones, setDeliveryZones] = useState<any[]>([]);
    const [regionType, setRegionType] = useState<'' | 'greater_accra' | 'other_regions'>('');
    const [selectedZoneId, setSelectedZoneId] = useState<string>('');
    // Search-as-you-type combobox for delivery areas (the list can be 60+ zones).
    const [zoneSearch, setZoneSearch] = useState<string>('');
    const [showZoneDropdown, setShowZoneDropdown] = useState<boolean>(false);
    const zoneComboRef = useRef<HTMLDivElement | null>(null);
    // Manual fee override — only used when item count rules block automatic pricing
    // (3+ items outside Accra). Public site asks customers to contact support; in
    // the POS we let the admin type a quoted price so the sale can still close.
    const [manualDeliveryFee, setManualDeliveryFee] = useState<string>('');
    const [guestDetails, setGuestDetails] = useState({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        city: '',
        region: '',
        notes: '',
    });

    useEffect(() => {
        fetchData();
    }, []);

    // Close the area combobox when clicking outside it.
    useEffect(() => {
        if (!showZoneDropdown) return;
        const onDocClick = (e: MouseEvent) => {
            if (!zoneComboRef.current) return;
            if (!zoneComboRef.current.contains(e.target as Node)) setShowZoneDropdown(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [showZoneDropdown]);

    const fetchData = async () => {
        try {
            setLoading(true);
            const { data: prodData } = await supabase
                .from('products')
                .select(`
                    id, name, price, quantity, sku,
                    categories(name),
                    product_images(url, position),
                    product_variants(id, name, sku, price, quantity, option1, option2, image_url)
                `)
                .order('name');

            if (prodData) {
                const formatted: Product[] = prodData.map((p: any) => {
                    // Collapse duplicate size/colour rows (common after re-saves) by
                    // summing stock and keeping the row with the most inventory.
                    const rawVariants = (p.product_variants || []).map((v: any) => ({
                        id: v.id,
                        name: v.name,
                        sku: v.sku,
                        price: Number(v.price) > 0 ? Number(v.price) : Number(p.price) || 0,
                        quantity: Number(v.quantity) || 0,
                        option1: v.option1,
                        option2: v.option2,
                        image_url: v.image_url,
                    }));
                    const merged = new Map<string, typeof rawVariants[number]>();
                    for (const v of rawVariants) {
                        const built = [v.option1, v.option2].filter(Boolean).join(' / ').trim();
                        const nm = (v.name || '').trim();
                        const label = (nm.includes('/') ? nm : (built || nm)).toLowerCase();
                        const key = label || v.id;
                        const prev = merged.get(key);
                        if (!prev) {
                            merged.set(key, { ...v });
                            continue;
                        }
                        const qty = prev.quantity + v.quantity;
                        // Prefer the id that still has stock so POS decrements the live row.
                        const keep = v.quantity >= prev.quantity ? v : prev;
                        merged.set(key, { ...keep, quantity: qty, price: keep.price || prev.price || Number(p.price) || 0 });
                    }
                    return {
                    id: p.id,
                    name: p.name,
                    price: Number(p.price) || 0,
                    quantity: p.quantity,
                    category: p.categories?.name || 'Uncategorized',
                    // First non-video gallery image, else first colour-variant photo
                    image: (p.product_images || [])
                        .filter((img: any) => img?.url && !/\.(mp4|webm|ogg|mov)$/i.test(img.url) && !img.url.startsWith('data:video'))
                        .sort((a: any, b: any) => (a.position ?? 99) - (b.position ?? 99))[0]?.url
                        || (p.product_variants || []).find((v: any) => v?.image_url && !/\.(mp4|webm|ogg|mov)$/i.test(v.image_url))?.image_url
                        || '/placeholder-product.png',
                    sku: p.sku,
                    variants: Array.from(merged.values()),
                    };
                });
                setProducts(formatted);
                const cats = Array.from(new Set(formatted.map(p => p.category))).sort();
                setCategories(['All', ...cats]);
            }

            const { data: custData } = await supabase
                .from('profiles')
                .select('id, full_name, email, phone')
                .limit(50);

            if (custData) setCustomers(custData);

            // Pull the store's public contact info for the receipt footer.
            const { data: settingRows } = await supabase
                .from('store_settings')
                .select('key, value')
                .in('key', ['contact_phone', 'contact_address']);

            if (settingRows) {
                const map: Record<string, any> = {};
                settingRows.forEach(r => { map[r.key] = r.value; });
                setStoreContact({
                    phone: typeof map.contact_phone === 'string' ? map.contact_phone : '',
                    address: typeof map.contact_address === 'string' ? map.contact_address : '',
                });
            }

            // Active delivery zones (same data source as the public checkout).
            const { data: zonesData } = await supabase
                .from('delivery_zones')
                .select('*')
                .eq('is_active', true)
                .order('name');

            if (zonesData) setDeliveryZones(zonesData);

        } catch (error) {
            console.error('Error fetching POS data:', error);
        } finally {
            setLoading(false);
        }
    };

    // Cart helpers
    const addVariantToCart = (product: Product, variant: Variant) => {
        // variant.name holds the canonical "Size / Colour" (e.g. "37 / Coffee").
        // option1 (size) is often null in our data while option2 carries the
        // colour, so building purely from options drops the size. Prefer the
        // full name when it already contains both parts.
        const built = [variant.option1, variant.option2].filter(Boolean).join(' / ').trim();
        const nm = (variant.name || '').trim();
        const label = nm.includes('/') ? nm : (built || nm);
        const key = `${product.id}:${variant.id}`;
        setCart(prev => {
            const existing = prev.find(it => it.key === key);
            if (existing) {
                if (existing.cartQuantity >= existing.stock) return prev;
                return prev.map(it =>
                    it.key === key ? { ...it, cartQuantity: it.cartQuantity + 1 } : it
                );
            }
            return [
                ...prev,
                {
                    key,
                    productId: product.id,
                    variantId: variant.id,
                    name: product.name,
                    variantLabel: label,
                    // Match pre-logo POS pricing: use the variant price when set,
                    // otherwise fall back to the product price.
                    price: Number(variant.price) > 0 ? Number(variant.price) : Number(product.price) || 0,
                    image: variant.image_url || product.image,
                    sku: variant.sku,
                    stock: variant.quantity,
                    cartQuantity: 1,
                },
            ];
        });
    };

    const addPlainToCart = (product: Product) => {
        const key = product.id;
        setCart(prev => {
            const existing = prev.find(it => it.key === key);
            if (existing) {
                if (existing.cartQuantity >= existing.stock) return prev;
                return prev.map(it =>
                    it.key === key ? { ...it, cartQuantity: it.cartQuantity + 1 } : it
                );
            }
            return [
                ...prev,
                {
                    key,
                    productId: product.id,
                    variantId: null,
                    name: product.name,
                    variantLabel: null,
                    price: product.price,
                    image: product.image,
                    sku: product.sku,
                    stock: product.quantity,
                    cartQuantity: 1,
                },
            ];
        });
    };

    const handleProductClick = (product: Product) => {
        if (product.variants && product.variants.length > 0) {
            setVariantProduct(product);
        } else {
            addPlainToCart(product);
        }
    };

    const removeFromCart = (key: string) => {
        setCart(prev => prev.filter(it => it.key !== key));
    };

    const updateQuantity = (key: string, delta: number) => {
        setCart(prev => prev.map(it => {
            if (it.key !== key) return it;
            const newQty = it.cartQuantity + delta;
            if (newQty < 1) return it;
            if (newQty > it.stock) return it;
            return { ...it, cartQuantity: newQty };
        }));
    };

    const emptyCart = () => setCart([]);

    const filteredProducts = useMemo(() => {
        return products.filter(p => {
            const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                p.sku?.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesCat = activeCategory === 'All' || p.category === activeCategory;
            return matchesSearch && matchesCat;
        });
    }, [products, searchQuery, activeCategory]);

    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.cartQuantity), 0);

    // Delivery zone helpers — mirror public checkout pricing.
    const accraZones = useMemo(
        () => deliveryZones.filter((z: any) => z.is_accra).sort((a: any, b: any) => a.name.localeCompare(b.name)),
        [deliveryZones]
    );
    const outsideZones = useMemo(
        () => deliveryZones.filter((z: any) => !z.is_accra).sort((a: any, b: any) => a.name.localeCompare(b.name)),
        [deliveryZones]
    );
    const selectedZone = useMemo(
        () => deliveryZones.find((z: any) => z.id === selectedZoneId) || null,
        [deliveryZones, selectedZoneId]
    );
    const totalCartItems = cart.reduce((sum, item) => sum + item.cartQuantity, 0);
    const isAccraSelected = !!selectedZone?.is_accra;
    // Mirror the public site's outside-Accra rule: 3+ items needs a manual quote.
    const outsideAccraTooManyItems = !!selectedZone && !selectedZone.is_accra && totalCartItems >= 3;

    const computedZoneFee = (() => {
        if (!selectedZone) return 0;
        const baseFee = Number(selectedZone.base_fee) || 0;
        const perItem = Number(selectedZone.per_item_fee) || 0;
        let fee: number;
        if (selectedZone.is_accra) fee = baseFee;
        else if (totalCartItems <= 1) fee = baseFee;
        else if (totalCartItems === 2) fee = baseFee + perItem;
        else return 0; // 3+ items outside Accra → manual quote required

        // Zone-level waivers/discounts from Admin → Settings → Delivery.
        if (selectedZone.free_delivery) return 0;
        const discount = Math.min(100, Math.max(0, Number(selectedZone.discount_percent) || 0));
        if (discount > 0) fee = Math.max(0, fee * (1 - discount / 100));
        return fee;
    })();

    const parsedManualFee = Math.max(0, Number.parseFloat(manualDeliveryFee || '0') || 0);
    const appliedDeliveryFee = orderType === 'delivery'
        ? (outsideAccraTooManyItems ? parsedManualFee : computedZoneFee)
        : 0;
    const grandTotal = cartTotal + appliedDeliveryFee;
    const changeDue = amountTendered ? (parseFloat(amountTendered) - grandTotal) : 0;

    const handleCheckout = async () => {
        if (cart.length === 0) return;

        // Resolve names/phones from either the selected customer or the guest form.
        const resolvedFirstName = (selectedCustomer
            ? (selectedCustomer.full_name || '').split(' ')[0]
            : guestDetails.firstName
        ) || '';
        const resolvedLastName = (selectedCustomer
            ? (selectedCustomer.full_name || '').split(' ').slice(1).join(' ')
            : guestDetails.lastName
        ) || '';
        const resolvedFullName = `${resolvedFirstName} ${resolvedLastName}`.trim();
        const resolvedEmail = (guestDetails.email || selectedCustomer?.email || '').trim();
        const resolvedPhone = (guestDetails.phone || selectedCustomer?.phone || '').trim();

        // Delivery orders require a phone + address so we can actually deliver.
        if (orderType === 'delivery') {
            if (!resolvedPhone.trim()) {
                alert('Delivery orders require a customer phone number.');
                return;
            }
            if (!selectedZone) {
                alert('Please select a delivery area so the fee can be applied.');
                return;
            }
            if (outsideAccraTooManyItems && parsedManualFee <= 0) {
                alert('3+ items outside Accra require a manual delivery quote. Please enter the agreed delivery fee.');
                return;
            }
        }

        setProcessing(true);

        try {
            // Build a shipping_address using the same shape as online orders so the
            // admin order details screen renders correctly (address_line1, city, etc.)
            // The zone is the primary destination; the optional "landmark" input is
            // used to add specifics (e.g. "near the post office"), and any rider
            // notes are appended so the rider sees them in their app.
            const zoneName = selectedZone?.name || '';
            const landmark = guestDetails.city.trim();
            const composedLine = [landmark, zoneName].filter(Boolean).join(', ');
            const deliveryAddress = {
                full_name: resolvedFullName || 'Walk-in Customer',
                first_name: resolvedFirstName,
                last_name: resolvedLastName,
                email: resolvedEmail,
                phone: resolvedPhone,
                address_line1: composedLine || zoneName,
                city: landmark || zoneName,
                state: zoneName,
                region: zoneName,
                country: 'Ghana',
                notes: guestDetails.notes,
                delivery_zone_id: selectedZone?.id || null,
                delivery_zone_name: zoneName,
            };
            const walkInAddress = {
                full_name: resolvedFullName || 'Walk-in Customer',
                phone: resolvedPhone,
                note: 'POS in-store sale',
            };
            const addressData = orderType === 'delivery' ? deliveryAddress : walkInAddress;

            // Pay on delivery is only valid for delivery orders. The cashier
            // hasn't collected cash yet — the rider will at the doorstep.
            const isPayOnDelivery = paymentMethod === 'pay_on_delivery' && orderType === 'delivery';
            const resolvedPaymentStatus = isPayOnDelivery ? 'pending' : 'paid';

            const orderMeta: any = {
                pos_sale: true,
                pos_order_type: orderType,
                stock_reduced: true,
            };
            if (isPayOnDelivery) {
                orderMeta.pay_on_delivery = true;
            }
            if (!selectedCustomer) {
                orderMeta.guest_checkout = true;
                orderMeta.first_name = resolvedFirstName;
                orderMeta.last_name = resolvedLastName;
                orderMeta.phone = resolvedPhone;
                orderMeta.email = resolvedEmail;
            }

            // Flag stock_reduced: true up-front so the Moolre/Paystack webhook's
            // mark_order_paid RPC never attempts to re-reduce stock for POS sales.
            const { data: order, error: orderError } = await supabase
                .from('orders')
                .insert({
                    order_number: `POS-${Date.now()}`,
                    user_id: selectedCustomer?.id || null,
                    email: resolvedEmail || 'pos@store.local',
                    phone: resolvedPhone || null,
                    total: grandTotal,
                    subtotal: cartTotal,
                    shipping_total: appliedDeliveryFee,
                    // Walk-in sales are completed instantly; deliveries start in
                    // processing so they flow through the normal fulfilment queue.
                    status: orderType === 'delivery' ? 'processing' : 'delivered',
                    payment_status: resolvedPaymentStatus,
                    payment_method: paymentMethod,
                    payment_provider: 'pos',
                    shipping_address: addressData,
                    billing_address: addressData,
                    metadata: orderMeta,
                })
                .select()
                .single();

            if (orderError) throw orderError;

            const orderItems = cart.map(item => {
                // variantLabel is shaped like "Size" or "Size / Colour";
                // split it so the admin order detail can show Size and
                // Colour as their own dedicated pills.
                const labelParts = (item.variantLabel || '')
                    .split('/')
                    .map((part: string) => part.trim())
                    .filter(Boolean);
                const sizePart = labelParts[0] || null;
                const colorPart = labelParts[1] || null;
                return {
                    order_id: order.id,
                    product_id: item.productId,
                    variant_id: item.variantId,
                    product_name: item.name,
                    variant_name: item.variantLabel,
                    sku: item.sku,
                    quantity: item.cartQuantity,
                    unit_price: item.price,
                    total_price: item.price * item.cartQuantity,
                    metadata: {
                        size: sizePart,
                        color: colorPart,
                        variant_id: item.variantId,
                    },
                };
            });

            const { error: itemsError } = await supabase
                .from('order_items')
                .insert(orderItems);

            if (itemsError) throw itemsError;

            // Reduce stock per line. When a variant is present we decrement the
            // variant row; otherwise we decrement the parent product row.
            await Promise.all(
                cart.map(async (item) => {
                    if (item.variantId) {
                        const { data: v } = await supabase
                            .from('product_variants')
                            .select('quantity')
                            .eq('id', item.variantId)
                            .single();
                        if (v) {
                            const next = Math.max(0, Number(v.quantity) - item.cartQuantity);
                            await supabase
                                .from('product_variants')
                                .update({ quantity: next })
                                .eq('id', item.variantId);
                        }
                    } else {
                        const { data: p } = await supabase
                            .from('products')
                            .select('quantity')
                            .eq('id', item.productId)
                            .single();
                        if (p) {
                            const next = Math.max(0, Number(p.quantity) - item.cartQuantity);
                            await supabase
                                .from('products')
                                .update({ quantity: next })
                                .eq('id', item.productId);
                        }
                    }
                })
            );

            const customerNameForReceipt = selectedCustomer
                ? (selectedCustomer.full_name || selectedCustomer.email || 'Customer')
                : (guestDetails.firstName || guestDetails.lastName
                    ? `${guestDetails.firstName} ${guestDetails.lastName}`.trim()
                    : 'Walk-in Customer');

            setCompletedOrder({
                id: order.id,
                order_number: order.order_number,
                total: grandTotal,
                subtotal: cartTotal,
                deliveryFee: appliedDeliveryFee,
                orderType,
                items: cart,
                paymentMethod,
                amountTendered: paymentMethod === 'cash' ? parseFloat(amountTendered || '0') : grandTotal,
                changeDue: paymentMethod === 'cash' ? Math.max(0, parseFloat(amountTendered || '0') - grandTotal) : 0,
                customerName: customerNameForReceipt,
                createdAt: order.created_at || new Date().toISOString(),
            });
            setCart([]);

            // Refresh product stock so the grid reflects the sale immediately.
            fetchData();

            // Notify the customer (email + SMS) when we have real contact
            // details. We override the saved `pos@store.local` placeholder so
            // sendOrderConfirmation never emails that fake address.
            const customerHasContact = Boolean(resolvedEmail || resolvedPhone);
            const notifyHeaders = await adminAuthHeaders();
            if (customerHasContact) {
                fetch('/api/notifications', {
                    method: 'POST',
                    headers: notifyHeaders,
                    body: JSON.stringify({
                        type: 'order_created',
                        payload: {
                            ...order,
                            email: resolvedEmail || '',
                            phone: resolvedPhone || '',
                        },
                    }),
                }).catch((err) => console.error('POS customer notification error:', err));
            }

            fetch('/api/notifications', {
                method: 'POST',
                headers: notifyHeaders,
                body: JSON.stringify({
                    type: 'pos_admin_alert',
                    payload: {
                        orderId: order.id,
                        orderNumber: order.order_number,
                        total: grandTotal,
                        orderType,
                        paymentMethod,
                        customerName: resolvedFullName || 'Walk-in Customer',
                        customerPhone: resolvedPhone || '',
                    },
                }),
            }).catch((err) => console.error('POS admin alert error:', err));

        } catch (error: any) {
            console.error('Checkout failed:', error);
            alert('Checkout failed: ' + error.message);
        } finally {
            setProcessing(false);
        }
    };

    const printReceipt = () => {
        if (!completedOrder) return;

        const esc = (s: string) =>
            String(s ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

        const fmtMoney = (n: number) => `GH₵${Number(n || 0).toFixed(2)}`;
        const dt = new Date(completedOrder.createdAt || Date.now());
        const dateStr = dt.toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });

        const storeName = 'Hy-Stepper';
        const storeTagline = 'Point of Sale Receipt';

        // Store contact block — each line only renders if a value exists in
        // admin Settings → Contact & Social. Address preserves its newlines.
        const addressLines = (storeContact.address || '')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
        const contactHtml = [
            ...addressLines.map(line => `<div class="contact">${esc(line)}</div>`),
            storeContact.phone ? `<div class="contact">Tel: ${esc(storeContact.phone)}</div>` : '',
        ]
            .filter(Boolean)
            .join('');

        const itemsHtml = (completedOrder.items || [])
            .map((item: CartItem) => {
                const lineTotal = item.price * item.cartQuantity;
                // Show SKU on the receipt. Fall back to a short product-id
                // code if a SKU isn't set so nothing ever prints blank.
                const codeDisplay =
                    item.sku && item.sku.trim().length > 0
                        ? item.sku
                        : `ITEM-${String(item.productId).slice(0, 6).toUpperCase()}`;
                const variantLine = item.variantLabel
                    ? `<div class="variant">${esc(item.variantLabel)}</div>`
                    : '';
                return `
                <tr class="item-row">
                    <td class="name">
                        <div class="title">${esc(codeDisplay)}</div>
                        ${variantLine}
                        <div class="qty-line">${item.cartQuantity} × ${fmtMoney(item.price)}</div>
                    </td>
                    <td class="amt">${fmtMoney(lineTotal)}</td>
                </tr>`;
            })
            .join('');

        const paymentLabel =
            completedOrder.paymentMethod === 'cash'
                ? 'Cash'
                : completedOrder.paymentMethod === 'mobile_money' || completedOrder.paymentMethod === 'momo'
                ? 'Mobile Money'
                : completedOrder.paymentMethod === 'card'
                ? 'Card'
                : completedOrder.paymentMethod === 'pay_on_delivery'
                ? 'Pay on Delivery (UNPAID)'
                : String(completedOrder.paymentMethod || 'Paid');

        const receiptRef = completedOrder.order_number || completedOrder.id.slice(0, 8);

        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt ${esc(receiptRef)}</title>
<style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    body {
        font-family: 'Courier New', ui-monospace, monospace;
        font-size: 12px;
        color: #000;
        font-weight: 600;
        margin: 0;
        padding: 12px 10px;
        width: 80mm;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: 800; }
    .muted { color: #000; }
    .store { font-size: 18px; font-weight: 800; letter-spacing: 0.5px; }
    .tagline { font-size: 11px; margin-top: 2px; }
    .contact { font-size: 11px; margin-top: 2px; color: #000; line-height: 1.35; }
    .divider { border-top: 1px dashed #000; margin: 8px 0; }
    .meta { font-size: 11px; line-height: 1.5; }
    .meta .row { display: flex; justify-content: space-between; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 4px 0; vertical-align: top; }
    .item-row .name { padding-right: 6px; }
    .item-row .name .title { font-weight: 800; }
    .item-row .name .variant { font-size: 11px; color: #000; font-weight: 600; }
    .item-row .name .qty-line { font-size: 11px; color: #000; font-weight: 600; margin-top: 2px; }
    .item-row .amt { text-align: right; white-space: nowrap; font-weight: 800; }
    .totals .row { display: flex; justify-content: space-between; padding: 2px 0; }
    .totals .grand { font-size: 15px; font-weight: 800; padding-top: 4px; }
    .footer { text-align: center; font-size: 11px; margin-top: 12px; line-height: 1.5; }
    .thanks { font-weight: 800; font-size: 13px; margin-top: 4px; }
    @media screen {
        body {
            background: #f3f4f6;
            padding: 24px;
            width: auto;
        }
        .sheet {
            background: #fff;
            width: 80mm;
            margin: 0 auto;
            padding: 16px 14px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.08);
        }
    }
    @media print {
        body { background: #fff; padding: 0; font-weight: 700; }
        /* Thermal heads can't render grey — force every glyph to solid black. */
        * { color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .sheet { box-shadow: none; padding: 0; width: 80mm; }
    }
</style>
</head>
<body>
<div class="sheet">
    <div class="center">
        <div class="store">${esc(storeName)}</div>
        <div class="tagline muted">${esc(storeTagline)}</div>
        ${contactHtml}
    </div>

    <div class="divider"></div>

    <div class="meta">
        <div class="row"><span>Receipt</span><span class="bold">#${esc(receiptRef)}</span></div>
        <div class="row"><span>Date</span><span>${esc(dateStr)}</span></div>
        <div class="row"><span>Customer</span><span>${esc(completedOrder.customerName)}</span></div>
        <div class="row"><span>Payment</span><span>${esc(paymentLabel)}</span></div>
    </div>

    <div class="divider"></div>

    <table>
        <tbody>
            ${itemsHtml}
        </tbody>
    </table>

    <div class="divider"></div>

    <div class="totals">
        <div class="row"><span>Subtotal</span><span>${fmtMoney(completedOrder.subtotal ?? completedOrder.total)}</span></div>
        ${completedOrder.deliveryFee && completedOrder.deliveryFee > 0
            ? `<div class="row"><span>Delivery fee</span><span>${fmtMoney(completedOrder.deliveryFee)}</span></div>`
            : ''}
        <div class="row grand"><span>TOTAL</span><span>${fmtMoney(completedOrder.total)}</span></div>
        ${
            completedOrder.paymentMethod === 'cash'
                ? `
        <div class="row"><span>Tendered</span><span>${fmtMoney(completedOrder.amountTendered)}</span></div>
        <div class="row"><span>Change</span><span>${fmtMoney(completedOrder.changeDue)}</span></div>`
                : ''
        }
    </div>

    <div class="divider"></div>

    <div class="footer">
        <div class="thanks">Thank you for shopping with us!</div>
        <div class="muted">Faulty items: report within 48 hours of delivery.</div>
        <div class="muted">Other issues: report within 24 hours.</div>
        <div class="muted">Items must be unused, unworn and in original packaging.</div>
        <div class="muted">Full policy: hystepper.com/policy</div>
    </div>
</div>
<script>
    window.addEventListener('load', function () {
        setTimeout(function () {
            window.focus();
            window.print();
        }, 150);
    });
    window.addEventListener('afterprint', function () {
        window.close();
    });
</script>
</body>
</html>`;

        const win = window.open('', '_blank', 'width=400,height=640');
        if (!win) {
            alert('Please allow pop-ups to print the receipt.');
            return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
    };

    const resetCheckout = () => {
        setShowCheckoutModal(false);
        setCompletedOrder(null);
        setAmountTendered('');
        setSelectedCustomer(null);
        setOrderType('walk_in');
        setRegionType('');
        setSelectedZoneId('');
        setZoneSearch('');
        setShowZoneDropdown(false);
        setManualDeliveryFee('');
        setGuestDetails({
            firstName: '',
            lastName: '',
            email: '',
            phone: '',
            city: '',
            region: '',
            notes: '',
        });
    };

    return (
        <div
            className="flex flex-col lg:flex-row h-[calc(100vh-90px)] -m-4 lg:-m-6 overflow-hidden bg-gray-100 relative"
            style={{ height: 'calc(100dvh - 90px)' }}
        >

            {/* LEFT: Product Grid */}
            <div className={`flex-1 flex flex-col h-full min-w-0 ${isMobileCartOpen ? 'hidden lg:flex' : 'flex'}`}>
                <div className="bg-white p-4 border-b border-gray-200 flex items-center justify-between space-x-4 shrink-0">
                    <div className="relative flex-1 max-w-lg">
                        <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                        <input
                            type="text"
                            placeholder="Search products..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 text-sm"
                            autoFocus
                        />
                    </div>
                    <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar">
                        {categories.map(cat => (
                            <button
                                key={cat}
                                onClick={() => setActiveCategory(cat)}
                                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${activeCategory === cat
                                    ? 'bg-emerald-700 text-white shadow-md'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 content-start">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-gray-500">Loading products...</div>
                    ) : filteredProducts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500">
                            <i className="ri-inbox-line text-4xl mb-2"></i>
                            <p>No products found</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-4">
                            {filteredProducts.map(product => {
                                const hasVariants = product.variants.length > 0;
                                const totalStock = hasVariants
                                    ? product.variants.reduce((s, v) => s + v.quantity, 0)
                                    : product.quantity;
                                return (
                                    <div
                                        key={product.id}
                                        onClick={() => handleProductClick(product)}
                                        className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow cursor-pointer overflow-hidden border border-gray-100 group flex flex-col h-full"
                                    >
                                        <div className="aspect-square relative bg-gray-50 shrink-0">
                                            <LazyImage
                                                src={product.image}
                                                alt={product.name}
                                                fill
                                                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                                                className="w-full h-full group-hover:scale-105 transition-transform duration-300"
                                            />
                                            <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full backdrop-blur-sm">
                                                Qty: {totalStock}
                                            </div>
                                            {hasVariants && (
                                                <div className="absolute top-2 left-2 bg-emerald-600 text-white text-[10px] px-2 py-1 rounded-full font-semibold shadow">
                                                    {product.variants.length} sizes
                                                </div>
                                            )}
                                        </div>
                                        <div className="p-3 flex flex-col flex-1">
                                            <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 mb-auto">{product.name}</h3>
                                            <div className="flex items-center justify-between mt-2 pt-2">
                                                <span className="text-emerald-700 font-bold">GH₵{product.price.toFixed(2)}</span>
                                                <button className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center group-hover:bg-emerald-700 group-hover:text-white transition-colors">
                                                    <i className={hasVariants ? 'ri-ruler-line' : 'ri-add-line'}></i>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {cart.length > 0 && (
                    <div className="lg:hidden shrink-0 p-4 border-t border-gray-200 bg-white z-30 shadow-2xl safe-area-bottom">
                        <button
                            onClick={() => setIsMobileCartOpen(true)}
                            className="w-full py-3 bg-emerald-700 text-white rounded-xl font-bold flex justify-between px-6 shadow-lg active:scale-95 transition-transform"
                        >
                            <span className="flex items-center text-sm">
                                <span className="bg-white/20 px-2 py-0.5 rounded mr-2">{cart.reduce((a, b) => a + b.cartQuantity, 0)}</span>
                                Items
                            </span>
                            <span>View Cart</span>
                            <span>GH₵{grandTotal.toFixed(2)}</span>
                        </button>
                    </div>
                )}
            </div>

            {/* RIGHT: Cart Panel */}
            <div className={`w-full lg:w-96 bg-white border-l border-gray-200 flex flex-col h-full shadow-lg z-20 absolute inset-0 lg:relative ${isMobileCartOpen ? 'flex' : 'hidden lg:flex'}`}>
                <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gray-50 shrink-0">
                    <div className="flex items-center">
                        <button onClick={() => setIsMobileCartOpen(false)} className="lg:hidden mr-3 p-2 -ml-2 text-gray-600 hover:bg-gray-200 rounded-full transition-colors">
                            <i className="ri-arrow-left-line text-xl"></i>
                        </button>
                        <h2 className="text-lg font-bold text-gray-900 flex items-center">
                            <i className="ri-shopping-basket-2-line mr-2"></i>
                            Current Order
                        </h2>
                    </div>
                    <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2 py-1 rounded-full">
                        {cart.reduce((a, b) => a + b.cartQuantity, 0)} Items
                    </span>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {cart.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
                            <i className="ri-shopping-cart-line text-5xl opacity-20"></i>
                            <p className="text-sm">Cart is empty</p>
                            <button onClick={() => setIsMobileCartOpen(false)} className="lg:hidden text-emerald-600 font-medium hover:underline">
                                Start Adding Products
                            </button>
                        </div>
                    ) : (
                        cart.map(item => (
                            <div key={item.key} className="flex gap-3 p-3 bg-gray-50 rounded-lg group hover:bg-gray-100 transition-colors">
                                <div className="w-16 h-16 bg-white rounded-md overflow-hidden flex-shrink-0 border border-gray-200">
                                    <img src={item.image} className="w-full h-full object-cover" alt="" />
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col justify-between">
                                    <div className="flex justify-between items-start">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-gray-900 line-clamp-1">{item.name}</p>
                                            {item.variantLabel && (
                                                <p className="text-[11px] text-emerald-700 font-medium mt-0.5 truncate">{item.variantLabel}</p>
                                            )}
                                        </div>
                                        <button onClick={() => removeFromCart(item.key)} className="text-gray-400 hover:text-red-500 shrink-0 ml-2">
                                            <i className="ri-delete-bin-line"></i>
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between mt-2">
                                        <div className="flex items-center space-x-2 bg-white rounded border border-gray-200 px-1 py-0.5">
                                            <button onClick={() => updateQuantity(item.key, -1)} className="w-6 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded">
                                                <i className="ri-subtract-line text-xs"></i>
                                            </button>
                                            <span className="text-sm font-semibold w-6 text-center">{item.cartQuantity}</span>
                                            <button
                                                onClick={() => updateQuantity(item.key, 1)}
                                                disabled={item.cartQuantity >= item.stock}
                                                className="w-6 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                            >
                                                <i className="ri-add-line text-xs"></i>
                                            </button>
                                        </div>
                                        <p className="text-sm font-bold text-gray-900">GH₵{(item.price * item.cartQuantity).toFixed(2)}</p>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-4 bg-gray-50 border-t border-gray-200 space-y-4 shrink-0 safe-area-bottom">
                    <div className="space-y-1 text-sm">
                        <div className="flex justify-between text-gray-600">
                            <span>Subtotal</span>
                            <span>GH₵{cartTotal.toFixed(2)}</span>
                        </div>
                        {appliedDeliveryFee > 0 && (
                            <div className="flex justify-between text-gray-600">
                                <span>Delivery fee</span>
                                <span>GH₵{appliedDeliveryFee.toFixed(2)}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-gray-600">
                            <span>Tax (0%)</span>
                            <span>GH₵0.00</span>
                        </div>
                        <div className="flex justify-between text-xl font-bold text-gray-900 pt-2 border-t border-gray-200 mt-2">
                            <span>Total</span>
                            <span>GH₵{grandTotal.toFixed(2)}</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={emptyCart}
                            disabled={cart.length === 0}
                            className="px-4 py-3 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Clear
                        </button>
                        <button
                            onClick={() => setShowCheckoutModal(true)}
                            disabled={cart.length === 0}
                            className="px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-bold text-sm shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Charge GH₵{grandTotal.toFixed(2)}
                        </button>
                    </div>
                </div>
            </div>

            {/* Variant Picker Modal */}
            {variantProduct && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                <img src={variantProduct.image} alt="" className="w-12 h-12 rounded-lg object-cover border border-gray-200 shrink-0" />
                                <div className="min-w-0">
                                    <h3 className="text-base font-bold text-gray-900 truncate">{variantProduct.name}</h3>
                                    <p className="text-xs text-gray-500">Tap to add — pick as many sizes / colours as you need</p>
                                </div>
                            </div>
                            <button onClick={() => setVariantProduct(null)} className="w-8 h-8 rounded-full hover:bg-gray-200 flex items-center justify-center text-gray-500 shrink-0">
                                <i className="ri-close-line text-xl"></i>
                            </button>
                        </div>

                        <div className="p-5 overflow-y-auto">
                            <div className="grid grid-cols-3 gap-2">
                                {[...variantProduct.variants]
                                    .sort((a, b) => compareSizes(
                                        (a.option1 || a.name || '').toString(),
                                        (b.option1 || b.name || '').toString(),
                                    ))
                                    .map(v => {
                                    const key = `${variantProduct.id}:${v.id}`;
                                    const inCart = cart.find(c => c.key === key);
                                    const outOfStock = v.quantity <= 0;
                                    const atMax = !!inCart && inCart.cartQuantity >= v.quantity;
                                    // Tapping anywhere on an available tile adds one and KEEPS the
                                    // picker open, so the cashier can stack up several sizes/colours
                                    // (and quantities) in one go before pressing Done.
                                    const addOne = () => {
                                        if (outOfStock || atMax) return;
                                        addVariantToCart(variantProduct, v);
                                    };
                                    // option1 (size) is often null while name holds "Size / Colour",
                                    // so derive a clean size label and colour for display.
                                    const nameParts = (v.name || '').split('/').map((p: string) => p.trim()).filter(Boolean);
                                    const sizeText = (v.option1 || (nameParts.length > 1 ? nameParts[0] : v.name) || '').toString().trim();
                                    const colorText = (v.option2 || (nameParts.length > 1 ? nameParts[1] : '') || '').toString().trim();
                                    return (
                                        <div
                                            key={v.id}
                                            onClick={addOne}
                                            role="button"
                                            tabIndex={outOfStock ? -1 : 0}
                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addOne(); } }}
                                            className={`relative p-3 rounded-lg border text-center transition-all select-none ${
                                                outOfStock
                                                    ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                                                    : inCart
                                                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-200 cursor-pointer'
                                                        : 'border-gray-200 hover:border-emerald-400 hover:bg-emerald-50/40 text-gray-900 cursor-pointer'
                                            }`}
                                        >
                                            <p className="text-sm font-bold leading-tight">
                                                {sizeText}
                                            </p>
                                            {colorText && (
                                                <p className="text-[10px] text-gray-500 mt-0.5 leading-none truncate">{colorText}</p>
                                            )}
                                            <p className={`text-[11px] mt-1.5 font-medium ${outOfStock ? 'text-red-500' : 'text-gray-500'}`}>
                                                {outOfStock ? 'Out of stock' : `Stock: ${v.quantity}`}
                                            </p>
                                            {v.price !== variantProduct.price && (
                                                <p className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                                                    GH₵{v.price.toFixed(2)}
                                                </p>
                                            )}
                                            {!outOfStock && inCart && (
                                                <div
                                                    className="mt-2 flex items-center justify-center gap-1"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => inCart.cartQuantity <= 1 ? removeFromCart(key) : updateQuantity(key, -1)}
                                                        className="w-6 h-6 rounded-md bg-white border border-emerald-300 text-emerald-700 flex items-center justify-center hover:bg-emerald-100"
                                                        aria-label="Decrease"
                                                    >
                                                        <i className="ri-subtract-line text-sm"></i>
                                                    </button>
                                                    <span className="text-sm font-bold w-5 text-center">{inCart.cartQuantity}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateQuantity(key, 1)}
                                                        disabled={atMax}
                                                        className="w-6 h-6 rounded-md bg-white border border-emerald-300 text-emerald-700 flex items-center justify-center hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed"
                                                        aria-label="Increase"
                                                    >
                                                        <i className="ri-add-line text-sm"></i>
                                                    </button>
                                                </div>
                                            )}
                                            {inCart && (
                                                <span className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-600 text-white text-[10px] rounded-full flex items-center justify-center font-bold shadow">
                                                    {inCart.cartQuantity}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="p-4 border-t border-gray-100 bg-gray-50 shrink-0">
                            {(() => {
                                const selectedForProduct = cart
                                    .filter(c => c.productId === variantProduct.id)
                                    .reduce((sum, c) => sum + c.cartQuantity, 0);
                                return (
                                    <button
                                        onClick={() => setVariantProduct(null)}
                                        className="w-full py-3 bg-gray-900 text-white rounded-xl font-semibold text-sm hover:bg-gray-800"
                                    >
                                        {selectedForProduct > 0
                                            ? `Done · ${selectedForProduct} added to cart`
                                            : 'Done'}
                                    </button>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {/* Checkout Modal */}
            {showCheckoutModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        {completedOrder ? (
                            <div className="p-8 text-center flex flex-col items-center justify-center space-y-6 overflow-y-auto">
                                {completedOrder.paymentMethod === 'pay_on_delivery' ? (
                                    <>
                                        <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center">
                                            <i className="ri-time-line text-5xl text-amber-600"></i>
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-gray-900">Order Saved — Payment Pending</h2>
                                            <p className="text-gray-500 mt-1">Order #{completedOrder.order_number || completedOrder.id.slice(0, 8)} is awaiting payment.</p>
                                            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
                                                Cash will be collected at the door. Once the rider confirms delivery, this order will be marked paid automatically.
                                            </p>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center">
                                            <i className="ri-checkbox-circle-fill text-5xl text-emerald-600"></i>
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-gray-900">Payment Successful!</h2>
                                            <p className="text-gray-500 mt-1">Order #{completedOrder.order_number || completedOrder.id.slice(0, 8)} completed.</p>
                                            {completedOrder.paymentMethod === 'cash' && (
                                                <p className="text-lg font-semibold text-gray-900 mt-2">
                                                    Change Due: GH₵{(completedOrder.changeDue || 0).toFixed(2)}
                                                </p>
                                            )}
                                        </div>
                                    </>
                                )}
                                <div className="grid grid-cols-2 gap-4 w-full">
                                    <button onClick={printReceipt} className="py-3 px-4 border border-gray-300 rounded-xl font-semibold hover:bg-gray-50">
                                        Print Receipt
                                    </button>
                                    <button onClick={resetCheckout} className="py-3 px-4 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700">
                                        New Order
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
                                    <h3 className="text-xl font-bold text-gray-900">Finalize Payment</h3>
                                    <button onClick={() => setShowCheckoutModal(false)} className="w-8 h-8 rounded-full hover:bg-gray-200 flex items-center justify-center text-gray-500">
                                        <i className="ri-close-line text-xl"></i>
                                    </button>
                                </div>

                                <div className="p-6 space-y-6 overflow-y-auto">
                                    <div className="text-center py-4 bg-emerald-50 rounded-xl border border-emerald-100">
                                        <p className="text-sm text-emerald-800 uppercase tracking-wide font-semibold">Amount to Pay</p>
                                        <p className="text-4xl font-extrabold text-emerald-700 mt-1">GH₵{grandTotal.toFixed(2)}</p>
                                        {appliedDeliveryFee > 0 && (
                                            <p className="text-xs text-emerald-800 mt-1">
                                                Items GH₵{cartTotal.toFixed(2)} + Delivery GH₵{appliedDeliveryFee.toFixed(2)}
                                            </p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">Order Type</label>
                                        <div className="grid grid-cols-2 gap-3">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setOrderType('walk_in');
                                                    if (paymentMethod === 'pay_on_delivery') setPaymentMethod('cash');
                                                }}
                                                className={`py-3 rounded-lg font-medium border transition-all flex items-center justify-center space-x-2 ${
                                                    orderType === 'walk_in'
                                                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600'
                                                        : 'border-gray-200 hover:border-gray-300 text-gray-600'
                                                }`}
                                            >
                                                <i className="ri-store-2-line"></i>
                                                <span>Walk-in</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setOrderType('delivery');
                                                    // Default delivery sales to "Pay on delivery" so the
                                                    // cashier can't accidentally mark a doorstep-cash order
                                                    // as already paid. They can still flip back to
                                                    // Cash/Card/Momo if they actually collected at the
                                                    // counter.
                                                    if (paymentMethod === 'cash' && !amountTendered) {
                                                        setPaymentMethod('pay_on_delivery');
                                                    }
                                                }}
                                                className={`py-3 rounded-lg font-medium border transition-all flex items-center justify-center space-x-2 ${
                                                    orderType === 'delivery'
                                                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600'
                                                        : 'border-gray-200 hover:border-gray-300 text-gray-600'
                                                }`}
                                            >
                                                <i className="ri-truck-line"></i>
                                                <span>Delivery</span>
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">Customer (Optional)</label>
                                        <select
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none mb-4"
                                            onChange={(e) => setSelectedCustomer(customers.find(c => c.id === e.target.value) || null)}
                                            value={selectedCustomer?.id || ''}
                                        >
                                            <option value="">Walk-in Customer / Guest</option>
                                            {customers.map(c => (
                                                <option key={c.id} value={c.id}>{c.full_name || c.email} ({c.email})</option>
                                            ))}
                                        </select>

                                        {!selectedCustomer && (
                                            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mt-2 space-y-3 animate-in fade-in slide-in-from-top-2">
                                                <h4 className="text-sm font-bold text-gray-900 border-b border-gray-200 pb-2 mb-2">Guest Details</h4>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <input
                                                        type="text"
                                                        placeholder="First Name"
                                                        value={guestDetails.firstName}
                                                        onChange={e => setGuestDetails({ ...guestDetails, firstName: e.target.value })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-500 text-sm"
                                                    />
                                                    <input
                                                        type="text"
                                                        placeholder="Last Name"
                                                        value={guestDetails.lastName}
                                                        onChange={e => setGuestDetails({ ...guestDetails, lastName: e.target.value })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-500 text-sm"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <input
                                                        type="email"
                                                        placeholder="Email (Optional)"
                                                        value={guestDetails.email}
                                                        onChange={e => setGuestDetails({ ...guestDetails, email: e.target.value })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-500 text-sm"
                                                    />
                                                    <input
                                                        type="tel"
                                                        placeholder={orderType === 'delivery' ? 'Phone (Required)' : 'Phone (Optional)'}
                                                        value={guestDetails.phone}
                                                        onChange={e => setGuestDetails({ ...guestDetails, phone: e.target.value })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-500 text-sm"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {orderType === 'delivery' && (
                                        <div className="bg-amber-50 p-4 rounded-lg border border-amber-200 space-y-3 animate-in fade-in slide-in-from-top-2">
                                            <h4 className="text-sm font-bold text-amber-900 border-b border-amber-200 pb-2 mb-2 flex items-center">
                                                <i className="ri-truck-line mr-2"></i>
                                                Delivery Details
                                            </h4>
                                            {selectedCustomer && (
                                                <p className="text-xs text-amber-800 mb-2">
                                                    Confirm the delivery phone and address below. Leave blank fields for this customer will fall back to their account.
                                                </p>
                                            )}
                                            {selectedCustomer && (
                                                <input
                                                    type="tel"
                                                    placeholder="Delivery Phone (Required)"
                                                    value={guestDetails.phone}
                                                    onChange={(e) => setGuestDetails({ ...guestDetails, phone: e.target.value })}
                                                    className="w-full px-3 py-2 border border-amber-300 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500 text-sm bg-white"
                                                />
                                            )}
                                            {/* Region + Zone — same source as the public checkout */}
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-xs font-semibold text-amber-900 mb-1 uppercase tracking-wide">
                                                        Region *
                                                    </label>
                                                    <select
                                                        value={regionType}
                                                        onChange={(e) => {
                                                            const next = e.target.value as '' | 'greater_accra' | 'other_regions';
                                                            setRegionType(next);
                                                            setSelectedZoneId('');
                                                            setZoneSearch('');
                                                            setShowZoneDropdown(false);
                                                            setManualDeliveryFee('');
                                                        }}
                                                        className="w-full px-3 py-2 border border-amber-300 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500 text-sm bg-white"
                                                    >
                                                        <option value="">Select region</option>
                                                        <option value="greater_accra">Greater Accra</option>
                                                        <option value="other_regions">Other Regions</option>
                                                    </select>
                                                </div>
                                                <div ref={zoneComboRef} className="relative">
                                                    <label className="block text-xs font-semibold text-amber-900 mb-1 uppercase tracking-wide">
                                                        {regionType === 'other_regions' ? 'City *' : 'Delivery Area *'}
                                                    </label>
                                                    {(() => {
                                                        const zonesForType = regionType === 'greater_accra'
                                                            ? accraZones
                                                            : regionType === 'other_regions'
                                                                ? outsideZones
                                                                : [];
                                                        const inputValue = selectedZone
                                                            ? `${selectedZone.name} — GH₵${Number(selectedZone.base_fee || 0).toFixed(0)}`
                                                            : zoneSearch;
                                                        const search = zoneSearch.trim().toLowerCase();
                                                        const filtered = search
                                                            ? zonesForType.filter((z: any) =>
                                                                String(z.name || '').toLowerCase().includes(search)
                                                            )
                                                            : zonesForType;
                                                        return (
                                                            <>
                                                                <div className="relative">
                                                                    <input
                                                                        type="text"
                                                                        value={inputValue}
                                                                        readOnly={!!selectedZone}
                                                                        disabled={!regionType}
                                                                        placeholder={
                                                                            regionType
                                                                                ? regionType === 'other_regions'
                                                                                    ? 'Search city…'
                                                                                    : 'Search area…'
                                                                                : 'Pick a region first'
                                                                        }
                                                                        onChange={(e) => {
                                                                            setZoneSearch(e.target.value);
                                                                            setShowZoneDropdown(true);
                                                                        }}
                                                                        onFocus={() => {
                                                                            if (regionType && !selectedZone) setShowZoneDropdown(true);
                                                                        }}
                                                                        onClick={() => {
                                                                            if (regionType && !selectedZone) setShowZoneDropdown(true);
                                                                        }}
                                                                        className="w-full pl-9 pr-9 py-2 border border-amber-300 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500 text-sm bg-white disabled:bg-amber-50 disabled:cursor-not-allowed"
                                                                    />
                                                                    <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-amber-700 text-sm"></i>
                                                                    {selectedZone ? (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setSelectedZoneId('');
                                                                                setZoneSearch('');
                                                                                setManualDeliveryFee('');
                                                                                setShowZoneDropdown(true);
                                                                            }}
                                                                            className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-amber-700 hover:text-amber-900"
                                                                            title="Change area"
                                                                        >
                                                                            <i className="ri-close-line"></i>
                                                                        </button>
                                                                    ) : (
                                                                        <i className="ri-arrow-down-s-line absolute right-3 top-1/2 -translate-y-1/2 text-amber-700"></i>
                                                                    )}
                                                                </div>
                                                                {showZoneDropdown && regionType && !selectedZone && (
                                                                    <div className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto bg-white border border-amber-300 rounded-md shadow-lg">
                                                                        {filtered.length === 0 ? (
                                                                            <div className="px-3 py-3 text-xs text-amber-700">
                                                                                No areas match &ldquo;{zoneSearch}&rdquo;.
                                                                            </div>
                                                                        ) : (
                                                                            filtered.map((z: any) => (
                                                                                <button
                                                                                    key={z.id}
                                                                                    type="button"
                                                                                    onClick={() => {
                                                                                        setSelectedZoneId(z.id);
                                                                                        setZoneSearch('');
                                                                                        setManualDeliveryFee('');
                                                                                        setShowZoneDropdown(false);
                                                                                    }}
                                                                                    className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-amber-50"
                                                                                >
                                                                                    <span className="text-gray-900">{z.name}</span>
                                                                                    <span className="text-amber-800 font-semibold">
                                                                                        GH₵{Number(z.base_fee || 0).toFixed(0)}
                                                                                    </span>
                                                                                </button>
                                                                            ))
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </>
                                                        );
                                                    })()}
                                                </div>
                                            </div>

                                            <input
                                                type="text"
                                                placeholder="Landmark / Specific area (optional)"
                                                value={guestDetails.city}
                                                onChange={(e) => setGuestDetails({ ...guestDetails, city: e.target.value })}
                                                className="w-full px-3 py-2 border border-amber-300 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500 text-sm bg-white"
                                            />

                                            <textarea
                                                placeholder="Delivery Notes (Optional) — landmarks, rider instructions"
                                                value={guestDetails.notes}
                                                onChange={(e) => setGuestDetails({ ...guestDetails, notes: e.target.value })}
                                                rows={2}
                                                className="w-full px-3 py-2 border border-amber-300 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500 text-sm bg-white"
                                            />

                                            {/* Delivery fee summary */}
                                            {selectedZone && !outsideAccraTooManyItems && (
                                                <div className="flex items-center justify-between bg-white border border-amber-300 rounded-md px-3 py-2">
                                                    <div className="text-xs text-amber-900">
                                                        <p className="font-semibold uppercase tracking-wide">Delivery fee</p>
                                                        <p className="text-[11px] text-amber-700">
                                                            {selectedZone.name}
                                                            {!isAccraSelected && totalCartItems === 2 ? ' · 2-item rate' : ''}
                                                        </p>
                                                    </div>
                                                    <p className="text-base font-extrabold text-amber-900">
                                                        GH₵{computedZoneFee.toFixed(2)}
                                                    </p>
                                                </div>
                                            )}

                                            {/* Outside Accra: 3+ items needs a quoted price */}
                                            {selectedZone && outsideAccraTooManyItems && (
                                                <div className="space-y-2 bg-white border-2 border-amber-400 rounded-md p-3">
                                                    <div className="flex items-start gap-2">
                                                        <i className="ri-information-line text-amber-700 mt-0.5"></i>
                                                        <p className="text-xs text-amber-900">
                                                            <strong>Manual quote needed.</strong> 3+ items outside Accra are
                                                            priced individually. Enter the agreed delivery fee below.
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-semibold text-amber-900 mb-1 uppercase tracking-wide">
                                                            Quoted delivery fee
                                                        </label>
                                                        <div className="relative">
                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-700 font-semibold text-sm">
                                                                GH₵
                                                            </span>
                                                            <input
                                                                type="number"
                                                                inputMode="decimal"
                                                                min="0"
                                                                step="0.01"
                                                                placeholder="0.00"
                                                                value={manualDeliveryFee}
                                                                onChange={(e) => setManualDeliveryFee(e.target.value)}
                                                                className="w-full pl-12 pr-3 py-2 border border-amber-300 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500 text-sm bg-white font-semibold"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Method</label>
                                        <div className="grid grid-cols-3 gap-3">
                                            {['Cash', 'Card', 'Momo'].map(method => (
                                                <button
                                                    key={method}
                                                    onClick={() => setPaymentMethod(method.toLowerCase())}
                                                    className={`py-3 rounded-lg font-medium border transition-all ${paymentMethod === method.toLowerCase()
                                                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600'
                                                        : 'border-gray-200 hover:border-gray-300 text-gray-600'
                                                        }`}
                                                >
                                                    {method}
                                                </button>
                                            ))}
                                        </div>
                                        {orderType === 'delivery' && (
                                            <button
                                                type="button"
                                                onClick={() => setPaymentMethod('pay_on_delivery')}
                                                className={`mt-3 w-full py-3 rounded-lg font-medium border transition-all flex items-center justify-center gap-2 ${
                                                    paymentMethod === 'pay_on_delivery'
                                                        ? 'border-amber-600 bg-amber-50 text-amber-800 ring-1 ring-amber-600'
                                                        : 'border-dashed border-gray-300 hover:border-amber-400 text-gray-600'
                                                }`}
                                            >
                                                <i className="ri-time-line"></i>
                                                <span>Pay on delivery (collect cash at door)</span>
                                            </button>
                                        )}
                                        {paymentMethod === 'pay_on_delivery' && (
                                            <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                                The order will be saved as <strong>Awaiting payment</strong>. The rider will mark it paid automatically when they confirm delivery.
                                            </p>
                                        )}
                                        {orderType === 'delivery' && paymentMethod !== 'pay_on_delivery' && (
                                            <p className="mt-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                                                <i className="ri-information-line mr-1"></i>
                                                Only choose <strong>{paymentMethod === 'cash' ? 'Cash' : paymentMethod === 'card' ? 'Card' : 'Momo'}</strong> if you have actually collected the money <strong>now</strong>. Otherwise tap <strong>Pay on delivery</strong> above.
                                            </p>
                                        )}
                                    </div>

                                    {paymentMethod === 'cash' && (
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">Amount Tendered</label>
                                            <div className="relative">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">GH₵</span>
                                                <input
                                                    type="number"
                                                    value={amountTendered}
                                                    onChange={(e) => setAmountTendered(e.target.value)}
                                                    className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none font-bold text-lg"
                                                    placeholder="0.00"
                                                    autoFocus
                                                />
                                            </div>
                                            {changeDue > 0 && (
                                                <p className="text-right text-emerald-600 font-bold mt-2">Change: GH₵{changeDue.toFixed(2)}</p>
                                            )}
                                            {changeDue < 0 && amountTendered && (
                                                <p className="text-right text-red-500 font-medium mt-2">Insufficient amount</p>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="p-6 border-t border-gray-100 bg-gray-50 shrink-0">
                                    <button
                                        onClick={handleCheckout}
                                        disabled={
                                            processing ||
                                            (paymentMethod === 'cash' && parseFloat(amountTendered || '0') < grandTotal) ||
                                            (orderType === 'delivery' && (
                                                !((guestDetails.phone || selectedCustomer?.phone || '').trim()) ||
                                                !selectedZone ||
                                                (outsideAccraTooManyItems && parsedManualFee <= 0)
                                            ))
                                        }
                                        className="w-full py-4 bg-gray-900 text-white rounded-xl font-bold text-lg shadow-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center space-x-2"
                                    >
                                        {processing ? (
                                            <>
                                                <i className="ri-loader-4-line animate-spin"></i>
                                                <span>Processing...</span>
                                            </>
                                        ) : (
                                            <>
                                                <i className="ri-secure-payment-line"></i>
                                                <span>Complete Payment</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
