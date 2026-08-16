'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { trackAddToCart } from '@/components/TrackingScripts';

export type CartItem = {
    id: string;
    name: string;
    price: number;
    image: string;
    quantity: number;
    variant?: string;
    slug: string;
    maxStock: number;
    // Carried through to order_items so warehouse/POS can pack the right
    // size/colour. Variant SKU wins over product SKU when present.
    sku?: string;
    variantId?: string;
    // Picked option values, kept separate from `variant` (which is the joined
    // display string like "38 / Black") so the admin/order screens can render
    // them as their own prominent pills.
    size?: string;
    color?: string;
};

type CartContextType = {
    cart: CartItem[];
    addToCart: (item: CartItem) => void;
    removeFromCart: (itemId: string, variant?: string) => void;
    updateQuantity: (itemId: string, quantity: number, variant?: string) => void;
    clearCart: () => void;
    revalidateCart: () => Promise<void>;
    cartCount: number;
    subtotal: number;
    isCartOpen: boolean;
    setIsCartOpen: (isOpen: boolean) => void;
};

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
    const [cart, setCart] = useState<CartItem[]>([]);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    // Stable ref so revalidateCart sees the latest cart without forcing
    // every consumer to re-render when the callback identity would change.
    const cartRef = useRef<CartItem[]>([]);
    useEffect(() => { cartRef.current = cart; }, [cart]);
    // Guards revalidateCart against concurrent/rapid-fire runs (focus +
    // visibilitychange both fire when returning to the app on mobile).
    const revalidateStateRef = useRef({ inFlight: false, lastRun: 0 });

    // Load cart from localStorage on mount (sanitize so no invalid data causes crashes)
    useEffect(() => {
        const savedCart = localStorage.getItem('cart');
        if (savedCart) {
            try {
                const parsed = JSON.parse(savedCart);
                if (Array.isArray(parsed)) {
                    const safe = parsed.map((item: any) => {
                        const maxStock = Number(item?.maxStock) > 0 ? Number(item.maxStock) : 999;
                        const qty = Number(item?.quantity) || 1;
                        return {
                            id: item?.id ?? '',
                            name: item?.name ?? 'Product',
                            price: Number(item?.price) || 0,
                            image: typeof item?.image === 'string' ? item.image : 'https://via.placeholder.com/400x400?text=Product',
                            quantity: Math.max(1, Math.min(qty, maxStock)),
                            variant: item?.variant,
                            slug: item?.slug ?? item?.id ?? '',
                            maxStock,
                            sku: typeof item?.sku === 'string' ? item.sku : undefined,
                            variantId: typeof item?.variantId === 'string' ? item.variantId : undefined,
                            size: typeof item?.size === 'string' ? item.size : undefined,
                            color: typeof item?.color === 'string' ? item.color : undefined,
                        };
                    }).filter((item: any) => item.id);
                    setCart(safe);
                }
            } catch (e) {
                console.error('Failed to parse cart:', e);
            }
        }
        setIsInitialized(true);
    }, []);

    // Save cart to localStorage whenever it changes
    useEffect(() => {
        if (isInitialized) {
            localStorage.setItem('cart', JSON.stringify(cart));
            window.dispatchEvent(new Event('cartUpdated')); // Keep compatibility with legacy listeners if any
        }
    }, [cart, isInitialized]);

    const addToCart = (newItem: CartItem) => {
        setCart((prevCart) => {
            const existingItemIndex = prevCart.findIndex(
                (item) => item.id === newItem.id && item.variant === newItem.variant
            );

            if (existingItemIndex > -1) {
                const newCart = [...prevCart];
                const existingItem = newCart[existingItemIndex];
                const latestMaxStock = Number(newItem.maxStock) > 0 ? Number(newItem.maxStock) : Number(existingItem.maxStock);
                const cap = Number.isNaN(latestMaxStock) || latestMaxStock <= 0 ? 999 : latestMaxStock;
                const newQuantity = Math.min(
                    existingItem.quantity + newItem.quantity,
                    cap
                );
                newCart[existingItemIndex] = { ...existingItem, quantity: newQuantity, maxStock: cap };
                return newCart;
            } else {
                const maxStock = Number(newItem.maxStock) > 0 ? Number(newItem.maxStock) : 999;
                const requestedQty = Math.max(1, Number(newItem.quantity) || 1);
                const safeItem = {
                    ...newItem,
                    maxStock,
                    price: Number(newItem.price) || 0,
                    quantity: Math.min(requestedQty, maxStock),
                    image: newItem.image ?? 'https://via.placeholder.com/400x400?text=Product'
                };
                return [...prevCart, safeItem];
            }
        });

        setIsCartOpen(true); // Open cart when item is added

        trackAddToCart({
            id: newItem.id,
            name: newItem.name,
            price: Number(newItem.price) || 0,
            quantity: Math.max(1, Number(newItem.quantity) || 1),
        });
    };

    const removeFromCart = (itemId: string, variant?: string) => {
        setCart((prevCart) =>
            prevCart.filter((item) => !(item.id === itemId && item.variant === variant))
        );
    };

    const updateQuantity = (itemId: string, quantity: number, variant?: string) => {
        if (quantity < 1) {
            removeFromCart(itemId, variant);
            return;
        }

        const cap = (item: CartItem) => (Number(item.maxStock) > 0 ? Number(item.maxStock) : 999);
        setCart((prevCart) =>
            prevCart.map((item) =>
                item.id === itemId && item.variant === variant
                    ? { ...item, quantity: Math.min(quantity, cap(item)) }
                    : item
            )
        );
    };

    const clearCart = () => {
        setCart([]);
    };

    // Re-check every line item against the live catalogue. Anything that's
    // been deleted, deactivated, or sold out gets removed; stock-capped
    // quantities are clamped to whatever is actually available now. Runs
    // on mount, when the cart drawer opens, and on window focus so the cart
    // never lingers with stale items.
    const revalidateCart = async () => {
        const current = cartRef.current;
        if (current.length === 0) return;

        // Returning to the app fires `focus` and `visibilitychange` together —
        // run one revalidation, not two, and never overlap an in-flight one.
        const now = Date.now();
        if (revalidateStateRef.current.inFlight || now - revalidateStateRef.current.lastRun < 3000) return;
        revalidateStateRef.current = { inFlight: true, lastRun: now };

        const productIds = Array.from(new Set(current.map(i => i.id).filter(Boolean)));
        const variantIds = Array.from(
            new Set(current.map(i => i.variantId).filter((v): v is string => typeof v === 'string' && v.length > 0))
        );

        try {
            const [productsRes, variantsRes] = await Promise.all([
                productIds.length > 0
                    ? supabase.from('products').select('id, status, quantity').in('id', productIds)
                    : Promise.resolve({ data: [] as any[], error: null }),
                variantIds.length > 0
                    ? supabase.from('product_variants').select('id, quantity').in('id', variantIds)
                    : Promise.resolve({ data: [] as any[], error: null }),
            ]);

            // Bail on errors rather than wiping the cart — better to keep
            // a possibly-stale line than lose the customer's selections.
            if (productsRes.error || variantsRes.error) {
                console.warn('Cart revalidation skipped:', productsRes.error || variantsRes.error);
                return;
            }

            const productMap = new Map(
                (productsRes.data || []).map((p: any) => [p.id, { status: p.status, quantity: Number(p.quantity) || 0 }])
            );
            const variantMap = new Map(
                (variantsRes.data || []).map((v: any) => [v.id, Number(v.quantity) || 0])
            );

            let removedCount = 0;
            let clampedCount = 0;
            const removedNames: string[] = [];

            const next = current.flatMap(item => {
                const product = productMap.get(item.id);

                // Product deleted or deactivated → drop the line entirely.
                if (!product || product.status !== 'active') {
                    removedCount++;
                    if (item.name) removedNames.push(item.name);
                    return [];
                }

                let availableStock: number;
                if (item.variantId) {
                    const variantQty = variantMap.get(item.variantId);
                    if (variantQty == null) {
                        // Variant no longer exists.
                        removedCount++;
                        if (item.name) removedNames.push(`${item.name}${item.variant ? ` (${item.variant})` : ''}`);
                        return [];
                    }
                    availableStock = variantQty;
                } else {
                    availableStock = product.quantity;
                }

                if (availableStock <= 0) {
                    removedCount++;
                    if (item.name) removedNames.push(`${item.name}${item.variant ? ` (${item.variant})` : ''}`);
                    return [];
                }

                const clampedQty = Math.min(Math.max(1, item.quantity), availableStock);
                if (clampedQty !== item.quantity || availableStock !== item.maxStock) {
                    if (clampedQty !== item.quantity) clampedCount++;
                    return [{ ...item, quantity: clampedQty, maxStock: availableStock }];
                }
                return [item];
            });

            if (removedCount > 0 || clampedCount > 0) {
                setCart(next);
            }

            if (removedCount > 0) {
                const summary = removedNames.slice(0, 2).join(', ');
                const more = removedNames.length > 2 ? ` +${removedNames.length - 2} more` : '';
                toast.info(
                    removedCount === 1
                        ? `Removed an item from your cart that's no longer available${summary ? `: ${summary}` : ''}.`
                        : `Removed ${removedCount} items from your cart that are no longer available: ${summary}${more}.`
                );
            } else if (clampedCount > 0) {
                toast.info(
                    clampedCount === 1
                        ? 'One cart item was low on stock — quantity adjusted to what we have available.'
                        : `${clampedCount} cart items were low on stock — quantities adjusted to what we have available.`
                );
            }
        } catch (err) {
            console.warn('Cart revalidation failed:', err);
        } finally {
            revalidateStateRef.current.inFlight = false;
        }
    };

    // Run once shortly after hydration. Wait a beat so we don't compete with
    // the initial page render for bandwidth.
    useEffect(() => {
        if (!isInitialized) return;
        const id = setTimeout(() => { void revalidateCart(); }, 600);
        return () => clearTimeout(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isInitialized]);

    // Re-check whenever the drawer is opened — covers the "left tab open
    // overnight, came back, item was deleted in admin" flow.
    useEffect(() => {
        if (isCartOpen && isInitialized) {
            void revalidateCart();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isCartOpen]);

    // And on window focus / tab visibility regaining focus.
    useEffect(() => {
        const onFocus = () => { void revalidateCart(); };
        const onVisibility = () => {
            if (document.visibilityState === 'visible') void revalidateCart();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibility);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const cartCount = cart.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    const subtotal = cart.reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.quantity) || 0)), 0);

    return (
        <CartContext.Provider value={{
            cart,
            addToCart,
            removeFromCart,
            updateQuantity,
            clearCart,
            revalidateCart,
            cartCount,
            subtotal,
            isCartOpen,
            setIsCartOpen
        }}>
            {children}
        </CartContext.Provider>
    );
}

export function useCart() {
    const context = useContext(CartContext);
    if (context === undefined) {
        throw new Error('useCart must be used within a CartProvider');
    }
    return context;
}
