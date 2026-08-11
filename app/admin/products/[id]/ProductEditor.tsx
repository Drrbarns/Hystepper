'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import LazyImage from '@/components/LazyImage';

type VariantMode = 'size_only' | 'size_color' | 'color_only';
const PRESET_SHOE_SIZES = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45'];

// Normalise free-text or auto-derived slugs into a safe URL segment.
function slugify(input: string): string {
  return (input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Look up existing slugs that collide with our base and pick the next available
// `-2`, `-3`, ... suffix. Excludes the current product so editing doesn't
// collide with itself. Race-safe enough for admin usage; if two saves still
// race, the DB unique constraint kicks in and handleSave retries.
async function findUniqueSlug(baseSlug: string, excludeProductId?: string | null): Promise<string> {
  const safeBase = slugify(baseSlug) || 'product';

  const { data, error } = await supabase
    .from('products')
    .select('id, slug')
    .or(`slug.eq.${safeBase},slug.ilike.${safeBase}-%`);

  if (error || !data) {
    // Can't pre-check — return the base and let the DB / retry guard catch it.
    return safeBase;
  }

  const taken = new Set(
    data
      .filter((p) => (excludeProductId ? p.id !== excludeProductId : true))
      .map((p) => p.slug as string)
  );

  if (!taken.has(safeBase)) return safeBase;

  for (let n = 2; n < 10000; n++) {
    const candidate = `${safeBase}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }

  // Astronomically unlikely fallback — append a short random suffix.
  return `${safeBase}-${Math.random().toString(36).slice(2, 6)}`;
}

// Reconcile the variant builder (size chips / colour list) into the concrete
// `variants` array that actually gets saved. This guarantees that sizes/colours
// the admin picked are persisted even if they never clicked "Generate Variants".
// Existing variants (and their stock/price/disabled state) are preserved when
// their size/colour is still in the builder; combinations whose size or colour
// was REMOVED from the builder are pruned so they also disappear from the
// storefront after save. Genuinely missing combinations are appended.
function mergeBuilderVariants(
  existing: any[],
  mode: VariantMode,
  sizesStr: string,
  colors: { id: string; name: string; hex: string; image_url: string | null }[],
  basePrice: number
): any[] {
  const sizes = [...new Set(sizesStr.split(',').map(s => s.trim()).filter(Boolean))];
  const activeColors = colors.filter(c => c.name.trim());

  const norm = (s: any) => String(s ?? '').trim().toLowerCase();
  const sizeSet = new Set(sizes.map(norm));
  const colorSet = new Set(activeColors.map(c => norm(c.name)));

  const variantSize = (v: any) =>
    norm(v._size || (typeof v.name === 'string' && v.name.includes(' / ') ? v.name.split(' / ')[0] : v.name));
  const variantColor = (v: any) => norm(v._color || v.option2);

  // Drop variants whose size/colour the admin removed from the builder.
  // Safety: only prune when the builder actually has entries for that
  // dimension — an empty builder (e.g. right after switching modes) must
  // never wipe existing variants.
  const canPruneBySize = sizeSet.size > 0;
  const canPruneByColor = colorSet.size > 0;
  const kept = existing.filter(v => {
    if (mode === 'size_color') {
      const sizeOk = !canPruneBySize || sizeSet.has(variantSize(v));
      const colorOk = !canPruneByColor || colorSet.has(variantColor(v));
      return sizeOk && colorOk;
    }
    if (mode === 'color_only') {
      return !canPruneByColor || colorSet.has(variantColor(v));
    }
    // size_only
    return !canPruneBySize || sizeSet.has(norm(v._size || v.name));
  });

  const byName = new Set(kept.map(v => v.name));
  const result = [...kept];
  let seq = 0;
  const ensure = (name: string, build: () => any) => {
    if (byName.has(name)) return;
    byName.add(name);
    result.push(build());
  };
  const tempId = () => `temp-${Date.now()}-${seq++}-${Math.random()}`;

  if (mode === 'size_color') {
    for (const size of sizes) {
      for (const color of activeColors) {
        const name = `${size} / ${color.name}`;
        ensure(name, () => ({
          id: tempId(), name, option1: size, option2: color.name,
          option3: color.image_url ? null : (color.hex || null),
          image_url: color.image_url || null, price: basePrice, quantity: 0,
          _size: size, _color: color.name, _disabled: false,
          _appearanceMode: color.image_url ? 'image' : 'color',
        }));
      }
    }
  } else if (mode === 'size_only') {
    for (const size of sizes) {
      ensure(size, () => ({
        id: tempId(), name: size, option1: size, option2: null, option3: null, image_url: null,
        price: basePrice, quantity: 0, _size: size, _disabled: false, _appearanceMode: 'color',
      }));
    }
  } else {
    for (const color of activeColors) {
      ensure(color.name, () => ({
        id: tempId(), name: color.name, option2: color.name,
        option3: color.image_url ? null : (color.hex || null),
        image_url: color.image_url || null, price: basePrice, quantity: 0,
        _color: color.name, _disabled: false,
        _appearanceMode: color.image_url ? 'image' : 'color',
      }));
    }
  }
  return result;
}

export default function ProductEditor({ productId }: { productId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  // Allow deep-linking to a specific editor tab, e.g. ?tab=history from the
  // inventory page's stock-history shortcut.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (!requested) return;
    const valid = ['general', 'pricing', 'variants', 'images', 'seo', 'history'];
    if (valid.includes(requested) && !(requested === 'history' && productId === 'new')) {
      setActiveTab(requested);
    }
  }, [productId]);

  // Product State
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('active');
  const [featured, setFeatured] = useState(false);
  const [onSale, setOnSale] = useState(false);
  const [isNewArrival, setIsNewArrival] = useState(false);
  const [description, setDescription] = useState('');

  // Pricing & Inventory
  const [price, setPrice] = useState('');
  // Base price as it was loaded from the DB — used on save to detect a price
  // change and carry it into variants that were never individually priced.
  const [loadedBasePrice, setLoadedBasePrice] = useState<number | null>(null);
  const [comparePrice, setComparePrice] = useState('');
  const [sku, setSku] = useState('');
  const [stock, setStock] = useState('0');
  const [lowStockThreshold, setLowStockThreshold] = useState('5');

  // New Footwear Fields
  const [productCode, setProductCode] = useState('');
  const [styleName, setStyleName] = useState('');
  const [material, setMaterial] = useState('');
  const [heelHeight, setHeelHeight] = useState('');
  const [sizingNotes, setSizingNotes] = useState('');

  // SEO
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [slug, setSlug] = useState('');
  const [keywords, setKeywords] = useState(''); // Mapping to 'tags' array

  // Collections Data (for dropdown)
  const [categories, setCategories] = useState<any[]>([]);

  // Images & Variants
  const [images, setImages] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);

  // Variant Builder
  const [variantMode, setVariantMode] = useState<VariantMode>('size_only');
  const [builderSizes, setBuilderSizes] = useState('');
  const [builderColors, setBuilderColors] = useState<{ id: string; name: string; hex: string; image_url: string | null }[]>([]);
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkStock, setBulkStock] = useState('');

  // Stock History
  const [stockMovements, setStockMovements] = useState<any[]>([]);
  const [stockHistoryLoading, setStockHistoryLoading] = useState(false);
  const [stockHistoryLoaded, setStockHistoryLoaded] = useState(false);

  // Delivery notice must be declared at top level (used in fetchInitialData + handleSave)
  const [deliveryNotice, setDeliveryNotice] = useState('none');

  // Initialize
  useEffect(() => {
    fetchInitialData();
  }, [productId]);

  async function fetchInitialData() {
    try {
      setLoading(true);

      // 1. Fetch Categories for dropdown
      const { data: cats } = await supabase.from('categories').select('id, name').eq('status', 'active');
      if (cats) setCategories(cats);

      if (productId === 'new') {
        setLoading(false);
        return;
      }

      // 2. Fetch Product Data
      const { data: product, error } = await supabase
        .from('products')
        .select(`
          *,
          product_images (*),
          product_variants (*)
        `)
        .eq('id', productId)
        .single();

      if (error) throw error;

      if (product) {
        setProductName(product.name || '');
        setCategory(product.category_id || ''); // This binds to category ID
        setStatus(product.status || 'active');
        setFeatured(product.featured || false);
        setOnSale(product.on_sale || false);
        setIsNewArrival(product.is_new_arrival || false);
        setDescription(product.description || '');

        setPrice(product.price?.toString() || '');
        setLoadedBasePrice(product.price != null ? Number(product.price) : null);
        setComparePrice(product.compare_at_price?.toString() || '');
        setSku(product.sku || '');
        setStock(product.quantity?.toString() || '0');

        // New Fields
        setProductCode(product.product_code || '');
        setStyleName(product.style_name || '');
        setMaterial(product.material || '');
        setHeelHeight(product.heel_height || '');
        setSizingNotes(product.sizing_notes || '');
        setDeliveryNotice(product.metadata?.delivery_notice || 'none');

        // SEO
        setSeoTitle(product.seo_title || '');
        setSeoDescription(product.seo_description || '');
        setSlug(product.slug || '');
        setKeywords(product.tags ? product.tags.join(', ') : '');

        // Images
        if (product.product_images) {
          setImages(product.product_images.sort((a: any, b: any) => a.position - b.position));
        }

        if (product.product_variants && product.product_variants.length > 0) {
          const pvs = product.product_variants;
          setVariants(pvs.map((v: any) => ({
            ...v,
            _appearanceMode: v.image_url ? 'image' : 'color',
            _size: v.name?.includes(' / ') ? v.name.split(' / ')[0] : (v.option2 ? null : v.name),
            _color: v.option2 || null,
            _disabled: false,
          })));

          // Reconstruct builder state from existing variants
          const hasCombo = pvs.some((v: any) => v.name?.includes(' / '));
          const hasColors = pvs.some((v: any) => v.option2);

          if (hasCombo) {
            setVariantMode('size_color');
            const sizes = [...new Set(pvs.map((v: any) => {
              const fromOpt = String(v.option1 || '').trim();
              if (fromOpt) return fromOpt;
              return v.name?.includes(' / ') ? v.name.split(' / ')[0].trim() : '';
            }).filter(Boolean))] as string[];
            setBuilderSizes(sizes.sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)).join(', '));
            const colorMap = new Map<string, { id: string; name: string; hex: string; image_url: string | null }>();
            pvs.forEach((v: any) => {
              if (v.option2 && !colorMap.has(v.option2)) {
                colorMap.set(v.option2, { id: `c-${Math.random()}`, name: v.option2, hex: v.option3 || '#000000', image_url: v.image_url || null });
              }
            });
            setBuilderColors([...colorMap.values()]);
          } else if (hasColors) {
            setVariantMode('color_only');
            const colorMap = new Map<string, { id: string; name: string; hex: string; image_url: string | null }>();
            pvs.forEach((v: any) => {
              if (v.option2 && !colorMap.has(v.option2)) {
                colorMap.set(v.option2, { id: `c-${Math.random()}`, name: v.option2, hex: v.option3 || '#000000', image_url: v.image_url || null });
              }
            });
            setBuilderColors([...colorMap.values()]);
          } else {
            setVariantMode('size_only');
            const sizes = pvs.map((v: any) => v.name).filter(Boolean) as string[];
            setBuilderSizes(sizes.join(', '));
          }
        }
      }

    } catch (err) {
      console.error('Error loading product:', err);
      toast.error('Failed to load product data');
    } finally {
      setLoading(false);
    }
  }

  // Update one builder color AND propagate the change to any already-generated
  // variants for that color. This lets admins change a color's image/swatch/name
  // and just hit Save — no need to click "Generate Variants" again (which used
  // to be required and wiped prices/stock).
  function updateBuilderColor(ci: number, patch: Partial<{ name: string; hex: string; image_url: string | null }>) {
    const oldColor = builderColors[ci];
    if (!oldColor) return;
    const oldName = oldColor.name;
    const next = { ...oldColor, ...patch };

    setBuilderColors(prev => prev.map((c, i) => (i === ci ? { ...c, ...patch } : c)));

    setVariants(prev => prev.map(v => {
      const vColor = v._color || v.option2;
      if (!oldName || vColor !== oldName) return v;

      const updated: any = { ...v };
      if (patch.name !== undefined && patch.name !== oldName) {
        updated.option2 = patch.name;
        updated._color = patch.name;
        updated.name = v._size ? `${v._size} / ${patch.name}` : patch.name;
      }
      updated.image_url = next.image_url || null;
      updated.option3 = next.image_url ? null : (next.hex || null);
      updated._appearanceMode = next.image_url ? 'image' : 'color';
      return updated;
    }));
  }

  function generateVariants() {
    const sizes = [...new Set(builderSizes.split(',').map(s => s.trim()).filter(Boolean))];
    const colors = builderColors.filter(c => c.name.trim());

    if (variantMode === 'size_only' && sizes.length === 0) {
      toast.error('Add at least one size to generate variants');
      return;
    }
    if (variantMode === 'color_only' && colors.length === 0) {
      toast.error('Add at least one color to generate variants');
      return;
    }
    if (variantMode === 'size_color' && (sizes.length === 0 || colors.length === 0)) {
      toast.error('Add at least one size and one color to generate variants');
      return;
    }

    const basePrice = parseFloat(price) || 0;
    const combinations: any[] = [];

    // Preserve existing price / stock / DB id for combinations that already
    // exist, so regenerating never wipes the admin's data.
    const existingByName = new Map<string, any>(variants.map(v => [v.name, v]));
    const carryOver = (name: string, fresh: any) => {
      const prev = existingByName.get(name);
      if (!prev) return fresh;
      return {
        ...fresh,
        id: prev.id,
        price: prev.price ?? fresh.price,
        quantity: prev.quantity ?? fresh.quantity,
        sku: prev.sku,
        _disabled: prev._disabled || false,
      };
    };

    if (variantMode === 'size_color') {
      for (const size of sizes) {
        for (const color of colors) {
          const name = `${size} / ${color.name}`;
          combinations.push(carryOver(name, {
            id: `temp-${Date.now()}-${Math.random()}`,
            name,
            option1: size,
            option2: color.name,
            option3: color.image_url ? null : (color.hex || null),
            image_url: color.image_url || null,
            price: basePrice,
            quantity: 0,
            _size: size,
            _color: color.name,
            _disabled: false,
            _appearanceMode: color.image_url ? 'image' : 'color',
          }));
        }
      }
    } else if (variantMode === 'size_only') {
      for (const size of sizes) {
        combinations.push(carryOver(size, {
          id: `temp-${Date.now()}-${Math.random()}`,
          name: size,
          option1: size,
          option2: null,
          option3: null,
          image_url: null,
          price: basePrice,
          quantity: 0,
          _size: size,
          _disabled: false,
          _appearanceMode: 'color',
        }));
      }
    } else {
      for (const color of colors) {
        combinations.push(carryOver(color.name, {
          id: `temp-${Date.now()}-${Math.random()}`,
          name: color.name,
          option2: color.name,
          option3: color.image_url ? null : (color.hex || null),
          image_url: color.image_url || null,
          price: basePrice,
          quantity: 0,
          _color: color.name,
          _disabled: false,
          _appearanceMode: color.image_url ? 'image' : 'color',
        }));
      }
    }

    setVariants(combinations);
    setBulkPrice('');
    setBulkStock('');
    toast.success(`Generated ${combinations.length} variant${combinations.length !== 1 ? 's' : ''} — existing prices & stock kept`);
  }

  // Lazy-load stock history the first time the tab is opened.
  useEffect(() => {
    if (activeTab !== 'history' || productId === 'new' || stockHistoryLoaded) return;
    let cancelled = false;
    (async () => {
      setStockHistoryLoading(true);
      try {
        const { data, error } = await supabase
          .from('stock_movements')
          .select('*')
          .eq('product_id', productId)
          .order('created_at', { ascending: false })
          .limit(200);
        if (error) throw error;
        if (!cancelled) {
          setStockMovements(data || []);
          setStockHistoryLoaded(true);
        }
      } catch (err) {
        console.error('Error loading stock history:', err);
        if (!cancelled) toast.error('Failed to load stock history');
      } finally {
        if (!cancelled) setStockHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, productId, stockHistoryLoaded]);

  async function handleSave() {
    try {
      setSaving(true);

      // Validation — early returns inside try still hit finally, so no need to call setSaving(false)
      if (!productName.trim()) {
        toast.error('Product Name is required');
        setActiveTab('general');
        return;
      }
      if (!category) {
        toast.error('Category is required');
        setActiveTab('general');
        return;
      }
      if (!price || parseFloat(price) <= 0) {
        toast.error('Valid Price is required');
        setActiveTab('pricing');
        return;
      }

      // Compute a guaranteed-unique slug before insert. If the user didn't
      // type one we fall back to a slugified product name; either way we run
      // it through findUniqueSlug to append `-2`, `-3`, etc. when needed.
      const requestedSlug = slug.trim() || productName;
      const excludeId = productId !== 'new' ? productId : null;
      let finalSlug = await findUniqueSlug(requestedSlug, excludeId);

      const buildProductData = (slugValue: string) => ({
        name: productName,
        category_id: category,
        status,
        featured,
        on_sale: onSale,
        is_new_arrival: isNewArrival,
        description,
        price: parseFloat(price) || 0,
        compare_at_price: comparePrice ? parseFloat(comparePrice) : null,
        sku,
        quantity: parseInt(stock) || 0,
        slug: slugValue,
        product_code: productCode,
        style_name: styleName,
        material: material,
        heel_height: heelHeight,
        sizing_notes: sizingNotes,
        seo_title: seoTitle,
        seo_description: seoDescription,
        tags: keywords.split(',').map(tag => tag.trim()).filter(tag => tag),
        metadata: { delivery_notice: deliveryNotice },
        updated_at: new Date().toISOString(),
      });

      let targetId: string = productId;

      // Single retry loop. The first attempt uses the pre-checked slug.
      // If the DB still rejects on the unique slug constraint (concurrent
      // save raced us, or our pre-check went stale), regenerate with a
      // short random suffix and try once more.
      const isSlugConflict = (err: any) =>
        err?.code === '23505' && /slug/i.test(err?.message || err?.details || '');

      let writeAttempts = 0;
      while (true) {
        writeAttempts++;
        const productData = buildProductData(finalSlug);
        let writeError: any = null;

        if (productId === 'new') {
          const { data, error: insertError } = await supabase
            .from('products')
            .insert(productData)
            .select('id')
            .single();
          if (insertError) writeError = insertError;
          else if (!data?.id) throw new Error('Product was not created — no ID returned. Please try again.');
          else targetId = data.id;
        } else {
          const { error: updateError } = await supabase
            .from('products')
            .update(productData)
            .eq('id', productId);
          if (updateError) writeError = updateError;
        }

        if (!writeError) break;

        if (isSlugConflict(writeError) && writeAttempts < 3) {
          // Re-derive against the latest DB state, then add a random suffix
          // so we don't immediately collide again on the same race.
          const recomputed = await findUniqueSlug(requestedSlug, excludeId);
          finalSlug = `${recomputed}-${Math.random().toString(36).slice(2, 5)}`;
          continue;
        }

        throw writeError;
      }

      // Reflect any adjustment back into the form so the admin sees the
      // slug that was actually saved (and any subsequent re-save is a no-op).
      if (finalSlug !== slug) {
        setSlug(finalSlug);
        if (slug && finalSlug !== slugify(slug)) {
          toast.info(`Slug adjusted to "${finalSlug}" to keep it unique`);
        }
      }

      // --- SAVE VARIANTS ---
      // If the admin changed the product's base price, carry the new price into
      // every variant that still had the OLD base price (i.e. was never given a
      // custom price). Without this, the storefront/POS keeps showing the old
      // variant price even though the product price was updated.
      const newBasePrice = parseFloat(price) || 0;
      const basePriceChanged = loadedBasePrice != null && newBasePrice !== loadedBasePrice;

      // 0. Fold any builder sizes/colours the admin picked into the concrete
      // variant list, so new sizes save even if "Generate Variants" wasn't clicked.
      const effectiveVariants = mergeBuilderVariants(variants, variantMode, builderSizes, builderColors, newBasePrice);
      if (effectiveVariants.length !== variants.length) {
        setVariants(effectiveVariants);
      }

      // 1. Build upsert payload — strip temp IDs, exclude disabled combinations.
      // Always persist option1 (size) so shop filters + PDP size chips stay correct.
      const variantsToUpsert = effectiveVariants.filter(v => !v._disabled).map(v => {
        const variantPrice = basePriceChanged && Number(v.price) === loadedBasePrice
          ? newBasePrice
          : (v.price || 0);
        const sizeFromName =
          typeof v.name === 'string' && v.name.includes(' / ')
            ? v.name.split(' / ')[0].trim()
            : (v.option2 ? null : String(v.name || '').trim());
        const option1 = String(v._size || v.option1 || sizeFromName || '').trim() || null;
        const option2 = v.option2 != null && String(v.option2).trim() !== ''
          ? String(v.option2).trim()
          : null;
        const payload: any = {
          product_id: targetId,
          name: String(v.name || '').trim(),
          option1,
          option2,
          option3: v.option3 || null,
          image_url: v.image_url || null,
          price: variantPrice,
          quantity: parseInt(v.quantity?.toString() || '0') || 0,
        };
        if (v.id && !v.id.toString().startsWith('temp-')) {
          payload.id = v.id;
        }
        return payload;
      });
      const effectiveProductQuantity = variantsToUpsert.length > 0
        ? variantsToUpsert.reduce((sum, v) => sum + (Number(v.quantity) || 0), 0)
        : (parseInt(stock) || 0);

      // 2. Delete variants that were removed (safe id list — avoid fragile .not/.in string form)
      if (productId !== 'new') {
        const keptIds = new Set(
          variantsToUpsert.filter(v => v.id).map(v => String(v.id)),
        );

        if (effectiveVariants.length === 0 || variantsToUpsert.length === 0) {
          await supabase.from('product_variants').delete().eq('product_id', targetId);
        } else {
          const { data: existingRows, error: existingErr } = await supabase
            .from('product_variants')
            .select('id')
            .eq('product_id', targetId);
          if (existingErr) {
            console.error('Variant list error:', existingErr);
            toast.error(`Could not update variants: ${existingErr.message}`);
          } else {
            const toDelete = (existingRows || [])
              .map((r: any) => String(r.id))
              .filter((id: string) => !keptIds.has(id));
            if (toDelete.length > 0) {
              const { error: delErr } = await supabase
                .from('product_variants')
                .delete()
                .in('id', toDelete);
              if (delErr) {
                console.error('Variant delete error:', delErr);
                toast.error(`Could not remove old variants: ${delErr.message}`);
              }
            }
          }
        }
      }

      // 3. Upsert variants
      if (variantsToUpsert.length > 0) {
        const { error: variantError } = await supabase.from('product_variants').upsert(variantsToUpsert);
        if (variantError) {
          console.error('Variant save error:', variantError);
          toast.error(`Product saved, but variants failed: ${variantError.message}`);
        }
      }

      // Keep parent product stock in sync with variant stock totals.
      const { error: syncQuantityError } = await supabase
        .from('products')
        .update({ quantity: effectiveProductQuantity })
        .eq('id', targetId);
      if (syncQuantityError) {
        console.error('Product quantity sync error:', syncQuantityError);
      }

      // 4. Save staged images for newly created products
      if (productId === 'new' && images.length > 0) {
        const imagesToInsert = images.map((img, idx) => ({
          product_id: targetId,
          url: img.url,
          position: idx,
          alt_text: productName,
        }));
        const { error: imgError } = await supabase.from('product_images').insert(imagesToInsert);
        if (imgError) {
          console.error('Image save error:', imgError);
          toast.error('Product saved but images failed to link');
        }
      }

      toast.success(productId === 'new' ? 'Product created!' : 'Product updated successfully');

      // Redirect to products list
      router.push('/admin/products');

    } catch (err: any) {
      console.error('Error saving product:', err);
      toast.error(`Failed to save: ${err.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  }

  const tabs = [
    { id: 'general', label: 'General', icon: 'ri-information-line' },
    { id: 'pricing', label: 'Pricing & Inventory', icon: 'ri-price-tag-3-line' },
    { id: 'variants', label: 'Variants', icon: 'ri-layout-grid-line' },
    { id: 'images', label: 'Images', icon: 'ri-image-line' },
    { id: 'seo', label: 'SEO', icon: 'ri-search-line' },
    ...(productId !== 'new' ? [{ id: 'history', label: 'Stock History', icon: 'ri-history-line' }] : [])
  ];

  if (loading) {
    return <div className="p-12 text-center text-gray-500">Loading product editor...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-3 min-w-0">
          <Link
            href="/admin/products"
            className="w-10 h-10 shrink-0 flex items-center justify-center border-2 border-gray-300 rounded-lg hover:border-gray-400 transition-colors"
          >
            <i className="ri-arrow-left-line text-xl text-gray-700"></i>
          </Link>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{productId === 'new' ? 'New Product' : 'Edit Product'}</h1>
            <p className="text-gray-600 mt-1 text-sm sm:text-base">Update product information and settings</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3 shrink-0 w-full sm:w-auto">
          <button className="px-4 sm:px-6 py-2.5 sm:py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 transition-colors font-semibold whitespace-nowrap cursor-pointer text-sm sm:text-base">
            <i className="ri-eye-line mr-1.5"></i>
            Preview
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-4 sm:px-6 py-2.5 sm:py-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer flex items-center text-sm sm:text-base ${saving ? 'opacity-75 cursor-not-allowed' : ''}`}
          >
            {saving ? (
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
            ) : (
              <i className="ri-save-line mr-1.5"></i>
            )}
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Product Delivery Notice */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <i className="ri-truck-line text-lg text-gray-600"></i>
          <h3 className="font-semibold text-gray-900 text-sm">Delivery Notice <span className="text-gray-500 font-normal">(for this product)</span></h3>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-3">
          {[
            { value: 'none', label: 'Standard', icon: 'ri-truck-line', color: 'gray' },
            { value: 'same_day', label: 'Same Day', icon: 'ri-flashlight-line', color: 'emerald' },
            { value: 'next_day', label: 'Next Day', icon: 'ri-time-line', color: 'blue' },
            { value: 'unavailable', label: 'Not Available', icon: 'ri-forbid-line', color: 'red' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDeliveryNotice(opt.value)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all text-sm font-medium ${deliveryNotice === opt.value
                ? `border-${opt.color}-400 bg-${opt.color}-50 text-${opt.color}-700`
                : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300'
              }`}
            >
              <i className={`${opt.icon}`}></i>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="md:hidden p-3 border-b border-gray-200 bg-gray-50">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Section</label>
          <select
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value)}
            className="w-full px-3 py-2.5 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 cursor-pointer text-sm font-medium bg-white"
          >
            {tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>{tab.label}</option>
            ))}
          </select>
        </div>

        <div className="hidden md:block border-b border-gray-200 overflow-x-auto">
          <div className="flex min-w-max">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-1.5 sm:space-x-2 px-3 sm:px-6 py-3 sm:py-4 text-sm sm:text-base font-semibold whitespace-nowrap transition-colors border-b-2 cursor-pointer ${activeTab === tab.id
                  ? 'border-emerald-700 text-emerald-700 bg-emerald-50'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
              >
                <i className={`${tab.icon} text-xl`}></i>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 sm:p-6 lg:p-8">
          {activeTab === 'general' && (
            <div className="space-y-6 max-w-3xl">
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Product Name *
                </label>
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="Enter product name"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  maxLength={1000}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
                  placeholder="Describe your product..."
                />
                <p className="text-sm text-gray-500 mt-2">{description.length} characters</p>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Category *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="">Select Category</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    {/* Fallback if no categories */}
                    {categories.length === 0 && <option>No categories found</option>}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="active">Active</option>
                    <option value="draft">Draft</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={featured}
                    onChange={(e) => setFeatured(e.target.checked)}
                    className="w-5 h-5 text-emerald-700 border-gray-300 rounded focus:ring-emerald-500 cursor-pointer"
                  />
                  <span className="text-gray-900 font-medium">
                    Feature this product on homepage
                  </span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onSale}
                    onChange={(e) => setOnSale(e.target.checked)}
                    className="w-5 h-5 text-rose-600 border-gray-300 rounded focus:ring-rose-500 cursor-pointer"
                  />
                  <span className="text-gray-900 font-medium">
                    Show on Sale page
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      (Appears on the public /sale page)
                    </span>
                  </span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isNewArrival}
                    onChange={(e) => setIsNewArrival(e.target.checked)}
                    className="w-5 h-5 text-sky-600 border-gray-300 rounded focus:ring-sky-500 cursor-pointer"
                  />
                  <span className="text-gray-900 font-medium">
                    Mark as New Arrival
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      (Appears when shoppers sort by New Arrivals)
                    </span>
                  </span>
                </label>
              </div>

              {/* LIVE DATABASE FIELDS - FOOTWEAR */}
              <div className="pt-6 border-t border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Product Details</h3>

                <div className="mb-6">
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Product Code / SKU <span className="text-gray-500 font-normal">(Unique identifier — synced with SKU)</span>
                  </label>
                  <input
                    type="text"
                    value={productCode}
                    onChange={(e) => { setProductCode(e.target.value); setSku(e.target.value); }}
                    placeholder="e.g., HYS-001"
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-mono"
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      Style Name
                    </label>
                    <input
                      type="text"
                      value={styleName}
                      onChange={(e) => setStyleName(e.target.value)}
                      placeholder="e.g., Classic Elegance"
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      Material
                    </label>
                    <input
                      type="text"
                      value={material}
                      onChange={(e) => setMaterial(e.target.value)}
                      placeholder="e.g., Genuine Leather"
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6 mt-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      Heel Height
                    </label>
                    <select
                      value={heelHeight}
                      onChange={(e) => setHeelHeight(e.target.value)}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                    >
                      <option value="">Not specified</option>
                      <option value="Flat">Flat (0–1")</option>
                      <option value="Low">Low (2–2.5")</option>
                      <option value="Mid">Mid (3–3.5")</option>
                      <option value="High">High (4"+)</option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      Pick the bucket that matches this product so it shows up under the matching Heel Height filter on the homepage and shop page.
                    </p>
                  </div>
                </div>

                <div className="mt-6">
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Sizing Notes
                  </label>
                  <textarea
                    rows={3}
                    value={sizingNotes}
                    onChange={(e) => setSizingNotes(e.target.value)}
                    placeholder="e.g., Runs true to size. For wide feet, consider sizing up."
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
                  />
                  <p className="text-sm text-gray-500 mt-2">Help customers choose the right size</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'pricing' && (
            <div className="space-y-6 max-w-3xl">
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Price (GH₵) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 font-semibold">GH₵</span>
                    <input
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="w-full pl-16 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      step="0.01"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Compare at Price (GH₵)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 font-semibold">GH₵</span>
                    <input
                      type="number"
                      value={comparePrice}
                      onChange={(e) => setComparePrice(e.target.value)}
                      className="w-full pl-16 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      step="0.01"
                    />
                  </div>
                  <p className="text-sm text-gray-500 mt-2">Show original price for comparison</p>
                </div>
              </div>

              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-blue-900 font-semibold mb-1">Discount Calculation</p>
                <p className="text-blue-800">
                  {price && comparePrice && parseFloat(comparePrice) > parseFloat(price) ? (
                    <>
                      Savings: GH₵ {(parseFloat(comparePrice) - parseFloat(price)).toFixed(2)}
                      <span className="ml-2">
                        ({(((parseFloat(comparePrice) - parseFloat(price)) / parseFloat(comparePrice)) * 100).toFixed(0)}% off)
                      </span>
                    </>
                  ) : 'No discount applied'}
                </p>
              </div>

              <div className="pt-6 border-t border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Inventory</h3>

                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      Stock Quantity *
                    </label>
                    <input
                      type="number"
                      value={stock}
                      onChange={(e) => setStock(e.target.value)}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      SKU
                    </label>
                    <input
                      type="text"
                      value={sku}
                      disabled
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg bg-gray-50 text-gray-500 font-mono cursor-not-allowed"
                      placeholder="Set via Product Code above"
                    />
                    <p className="text-sm text-gray-500 mt-1">Auto-synced with Product Code</p>
                  </div>
                </div>

                <div className="mt-6">
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Low Stock Threshold
                  </label>
                  <input
                    type="number"
                    value={lowStockThreshold}
                    onChange={(e) => setLowStockThreshold(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                  <p className="text-sm text-gray-500 mt-2">Get notified when stock falls below this number</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'variants' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Product Variants</h3>
                <p className="text-gray-500 mt-1 text-sm">Pick a setup mode, then define options. Variant rows are generated automatically.</p>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                {[
                  {
                    id: 'size_only',
                    title: 'Size Only',
                    hint: 'Best for footwear sizes only',
                    icon: 'ri-ruler-line'
                  },
                  {
                    id: 'size_color',
                    title: 'Size + Color',
                    hint: 'Generate every size/color combination',
                    icon: 'ri-layout-grid-line'
                  },
                  {
                    id: 'color_only',
                    title: 'Color Only',
                    hint: 'Use colors without sizes',
                    icon: 'ri-palette-line'
                  }
                ].map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setVariantMode(mode.id as VariantMode)}
                    className={`text-left p-4 rounded-xl border-2 transition-all cursor-pointer ${
                      variantMode === mode.id
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <i className={`${mode.icon} ${variantMode === mode.id ? 'text-emerald-600' : 'text-gray-500'}`}></i>
                      <p className={`font-semibold ${variantMode === mode.id ? 'text-emerald-800' : 'text-gray-900'}`}>{mode.title}</p>
                    </div>
                    <p className="text-xs text-gray-500">{mode.hint}</p>
                  </button>
                ))}
              </div>

              {/* Option Builder */}
              <div className="grid md:grid-cols-2 gap-5">
                {/* Sizes */}
                {(variantMode === 'size_only' || variantMode === 'size_color') && (
                <div className="bg-gray-50 rounded-2xl p-5 border border-gray-200">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                      <i className="ri-ruler-line text-emerald-600"></i>
                    </div>
                    <h4 className="font-semibold text-gray-900">Sizes</h4>
                    <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">required</span>
                  </div>

                  {/* Preset shoe sizes */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-gray-500">Quick select:</p>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setBuilderSizes(PRESET_SHOE_SIZES.slice(0, 7).join(', '))}
                          className="text-xs text-emerald-700 hover:text-emerald-800 font-medium cursor-pointer"
                        >
                          Use 36-42
                        </button>
                        <button
                          type="button"
                          onClick={() => setBuilderSizes('')}
                          className="text-xs text-gray-500 hover:text-gray-700 font-medium cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {PRESET_SHOE_SIZES.map(size => {
                        const currentSizes = builderSizes.split(',').map(s => s.trim()).filter(Boolean);
                        const isActive = currentSizes.includes(size);
                        return (
                          <button
                            key={size}
                            type="button"
                            onClick={() => {
                              if (isActive) {
                                setBuilderSizes(currentSizes.filter(s => s !== size).join(', '));
                              } else {
                                const numericSizes = [...currentSizes, size].sort((a, b) => {
                                  const na = Number(a), nb = Number(b);
                                  if (!isNaN(na) && !isNaN(nb)) return na - nb;
                                  return a.localeCompare(b);
                                });
                                setBuilderSizes(numericSizes.join(', '));
                              }
                            }}
                            className={`w-10 h-10 rounded-lg border-2 text-sm font-semibold transition-all cursor-pointer ${
                              isActive
                                ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm'
                                : 'border-gray-200 bg-white text-gray-600 hover:border-emerald-300 hover:text-emerald-600'
                            }`}
                          >
                            {size}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <input
                    type="text"
                    value={builderSizes}
                    onChange={e => setBuilderSizes(e.target.value)}
                    placeholder="Type custom sizes not in presets (e.g. 46, 47, XL)"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 bg-white text-sm"
                  />
                  <p className="text-xs text-gray-400 mt-2">Click buttons to add/remove. Separate custom values with commas.</p>
                  {builderSizes.trim() && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {builderSizes.split(',').map(s => s.trim()).filter(Boolean).map((s, i) => (
                        <span key={i} className="px-2.5 py-1 bg-white border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium">{s}</span>
                      ))}
                    </div>
                  )}
                </div>
                )}

                {/* Colors / Images */}
                {(variantMode === 'size_color' || variantMode === 'color_only') && (
                <div className="bg-gray-50 rounded-2xl p-5 border border-gray-200">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                      <i className="ri-palette-line text-purple-600"></i>
                    </div>
                    <h4 className="font-semibold text-gray-900">Colors / Appearance</h4>
                    <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">required</span>
                  </div>
                  <div className="space-y-2">
                    {builderColors.map((color, ci) => (
                      <div key={color.id} className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 p-2">
                        {color.image_url ? (
                          <div className="relative w-9 h-9 rounded-lg overflow-hidden border border-gray-200 shrink-0 group/img">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={color.image_url} alt="" className="w-full h-full object-cover" />
                            <button type="button"
                              onClick={() => updateBuilderColor(ci, { image_url: null })}
                              className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 flex items-center justify-center transition-opacity">
                              <i className="ri-close-line text-white text-sm"></i>
                            </button>
                          </div>
                        ) : (
                          <input type="color" value={color.hex || '#000000'}
                            onChange={e => updateBuilderColor(ci, { hex: e.target.value })}
                            className="w-9 h-9 rounded-lg border border-gray-200 cursor-pointer p-0.5 shrink-0" />
                        )}
                        <input type="text" value={color.name}
                          onChange={e => updateBuilderColor(ci, { name: e.target.value })}
                          placeholder="Color name (e.g. Black)"
                          className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400" />
                        <label className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 cursor-pointer hover:bg-purple-50 hover:border-purple-300 transition-colors shrink-0" title="Upload image instead of color">
                          <input type="file" accept="image/*" className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              try {
                                const filePath = `variants/${Date.now()}-${Math.random().toString(36).substring(2)}.${file.name.split('.').pop()}`;
                                const { error } = await supabase.storage.from('products').upload(filePath, file, { upsert: true });
                                if (error) throw error;
                                const { data: { publicUrl } } = supabase.storage.from('products').getPublicUrl(filePath);
                                updateBuilderColor(ci, { image_url: publicUrl });
                                toast.success('Image added to color — hit Save to keep it');
                              } catch (err: any) { toast.error('Upload failed: ' + err.message); }
                              e.target.value = '';
                            }} />
                          <i className="ri-image-add-line text-gray-400 text-sm"></i>
                        </label>
                        <button type="button" onClick={() => setBuilderColors(builderColors.filter((_, i) => i !== ci))}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 hover:text-red-600 text-gray-400 transition-colors shrink-0">
                          <i className="ri-close-line"></i>
                        </button>
                      </div>
                    ))}
                    <button type="button"
                      onClick={() => setBuilderColors([...builderColors, { id: `c-${Date.now()}`, name: '', hex: '#000000', image_url: null }])}
                      className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-purple-400 hover:text-purple-600 transition-colors text-sm flex items-center justify-center gap-1.5">
                      <i className="ri-add-line"></i> Add Color
                    </button>
                  </div>
                </div>
                )}
              </div>

              {/* Generate button */}
              <div className="flex items-center gap-4 flex-wrap">
                <button type="button" onClick={generateVariants}
                  disabled={
                    (variantMode === 'size_only' && !builderSizes.trim()) ||
                    (variantMode === 'color_only' && builderColors.filter(c => c.name.trim()).length === 0) ||
                    (variantMode === 'size_color' && (!builderSizes.trim() || builderColors.filter(c => c.name.trim()).length === 0))
                  }
                  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm">
                  <i className="ri-magic-line"></i>
                  Generate Variants
                </button>
                {builderSizes.trim() || builderColors.length > 0 ? (
                  <p className="text-sm text-gray-500">
                    {(() => {
                      const s = builderSizes.split(',').map(x => x.trim()).filter(Boolean).length;
                      const c = builderColors.filter(x => x.name.trim()).length;
                      if (variantMode === 'size_color') return `${s} sizes × ${c} colors = ${s * c} combinations`;
                      if (variantMode === 'size_only') return `${s} size variant${s !== 1 ? 's' : ''}`;
                      if (variantMode === 'color_only') return `${c} color variant${c !== 1 ? 's' : ''}`;
                      return '';
                    })()}
                  </p>
                ) : null}
                {variants.length > 0 && (
                  <span className="text-sm text-emerald-600 flex items-center gap-1">
                    <i className="ri-shield-check-line"></i>
                    Existing prices &amp; stock are kept when regenerating
                  </span>
                )}
              </div>

              {/* ── Combination Matrix ── shown when both sizes AND colors are defined */}
              {(() => {
                const mSizes = builderSizes.split(',').map(s => s.trim()).filter(Boolean);
                const mColors = builderColors.filter(c => c.name.trim());
                if (variantMode !== 'size_color' || mSizes.length === 0 || mColors.length === 0 || variants.length === 0) return null;
                const activeCount = variants.filter(v => !v._disabled).length;

                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-indigo-100 rounded-lg flex items-center justify-center shrink-0">
                        <i className="ri-grid-line text-indigo-600 text-sm"></i>
                      </div>
                      <div>
                        <span className="font-semibold text-gray-900 text-sm">Availability Matrix</span>
                        <span className="ml-2 text-xs text-gray-400">Click a cell to toggle that combination on/off</span>
                      </div>
                      <span className="ml-auto text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                        {activeCount} active
                      </span>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                      <table className="text-sm border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 bg-gray-50 min-w-[80px]">
                              Size ↓ &nbsp; Color →
                            </th>
                            {mColors.map(color => (
                              <th key={color.id} className="py-3 px-4 text-center bg-gray-50 min-w-[80px]">
                                <div className="flex flex-col items-center gap-1.5">
                                  {color.image_url ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={color.image_url} alt="" className="w-7 h-7 rounded-lg object-cover border border-gray-200" />
                                  ) : (
                                    <div className="w-6 h-6 rounded-md border border-gray-300" style={{ background: color.hex || '#000' }} />
                                  )}
                                  <span className="text-xs text-gray-600 font-medium leading-tight max-w-[70px] truncate">{color.name}</span>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {mSizes.map((size, si) => (
                            <tr key={size} className={`border-b border-gray-100 last:border-0 ${si % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                              <td className="py-3 px-4 font-semibold text-gray-800 bg-gray-50 text-sm">{size}</td>
                              {mColors.map(color => {
                                const variant = variants.find(v =>
                                  v._size === size && (v._color || v.option2) === color.name
                                );
                                const isActive = variant ? !variant._disabled : false;
                                return (
                                  <td key={color.id} className="py-3 px-4 text-center">
                                    <button
                                      type="button"
                                      title={isActive ? `${size} / ${color.name} — click to disable` : `${size} / ${color.name} — click to enable`}
                                      onClick={() => {
                                        if (variant) {
                                          setVariants(prev => prev.map(v =>
                                            v._size === size && (v._color || v.option2) === color.name
                                              ? { ...v, _disabled: !v._disabled }
                                              : v
                                          ));
                                        } else {
                                          // Cell was never generated — add it now
                                          setVariants(prev => [...prev, {
                                            id: `temp-${Date.now()}-${Math.random()}`,
                                            name: `${size} / ${color.name}`,
                                            option1: size,
                                            option2: color.name,
                                            option3: color.image_url ? null : (color.hex || null),
                                            image_url: color.image_url || null,
                                            price: parseFloat(price) || 0,
                                            quantity: 0,
                                            _size: size,
                                            _color: color.name,
                                            _disabled: false,
                                            _appearanceMode: color.image_url ? 'image' : 'color',
                                          }]);
                                        }
                                      }}
                                      className={`w-9 h-9 rounded-xl border-2 flex items-center justify-center mx-auto transition-all duration-150 ${
                                        isActive
                                          ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm hover:bg-emerald-600'
                                          : 'bg-white border-gray-200 text-gray-300 hover:border-emerald-400 hover:text-emerald-400'
                                      }`}
                                    >
                                      {isActive
                                        ? <i className="ri-check-line text-sm font-bold"></i>
                                        : <i className="ri-close-line text-sm"></i>
                                      }
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* Variants price/stock table — only active (non-disabled) rows */}
              {variants.filter(v => !v._disabled).length > 0 && (
                <div className="space-y-3">
                  {/* Bulk apply bar */}
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 bg-blue-50 border border-blue-200 rounded-xl px-3 sm:px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <i className="ri-flashlight-line text-blue-600"></i>
                      <span className="text-sm font-semibold text-blue-900">Bulk apply:</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-blue-700 font-medium">Price GH₵</span>
                      <input type="number" value={bulkPrice} onChange={e => setBulkPrice(e.target.value)}
                        placeholder={price || '0'}
                        className="w-20 sm:w-24 px-2 py-1.5 border border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 bg-white" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-blue-700 font-medium">Stock</span>
                      <input type="number" value={bulkStock} onChange={e => setBulkStock(e.target.value)}
                        placeholder="0"
                        className="w-16 sm:w-20 px-2 py-1.5 border border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 bg-white" />
                    </div>
                    <button type="button"
                      onClick={() => {
                        setVariants(prev => prev.map(v =>
                          v._disabled ? v : {
                            ...v,
                            ...(bulkPrice !== '' ? { price: parseFloat(bulkPrice) || 0 } : {}),
                            ...(bulkStock !== '' ? { quantity: parseInt(bulkStock) || 0 } : {}),
                          }
                        ));
                        toast.success('Applied to all active variants');
                      }}
                      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors">
                      Apply
                    </button>
                    <span className="w-full sm:w-auto sm:ml-auto text-xs text-blue-600">
                      {variants.filter(v => !v._disabled).length} variant{variants.filter(v => !v._disabled).length !== 1 ? 's' : ''} will be saved
                    </span>
                  </div>

                  {(() => {
                    const showColorColumn = variants.some(v => !v._disabled && (v._color || v.option2));
                    const removeVariant = (v: any, index: number) => {
                      // Mark disabled via matrix if possible, else remove
                      if (v._size && v._color) {
                        setVariants(prev => prev.map((vv, i) => i === index ? { ...vv, _disabled: true } : vv));
                      } else {
                        setVariants(variants.filter((_, i) => i !== index));
                        // Keep the size builder in sync so save-reconcile doesn't re-add it.
                        if (variantMode === 'size_only') {
                          const removedSize = v._size || v.name;
                          setBuilderSizes(prev =>
                            prev.split(',').map(s => s.trim()).filter(Boolean).filter(s => s !== removedSize).join(', ')
                          );
                        }
                      }
                    };

                    return (
                      <>
                        {/* Desktop: data-dense table */}
                        <div className="hidden md:block border border-gray-200 rounded-xl overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b border-gray-200">
                              <tr>
                                <th className="text-left py-3 px-4 font-semibold text-gray-700">Variant</th>
                                {showColorColumn && (
                                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Color</th>
                                )}
                                <th className="text-left py-3 px-4 font-semibold text-gray-700">Price (GH₵)</th>
                                <th className="text-left py-3 px-4 font-semibold text-gray-700">Stock</th>
                                <th className="text-right py-3 px-4 font-semibold text-gray-700"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {variants.map((v, index) => {
                                if (v._disabled) return null;
                                return (
                                  <tr key={v.id || index} className="hover:bg-gray-50 transition-colors">
                                    <td className="py-3 px-4 font-medium text-gray-900">{v.name}</td>
                                    {showColorColumn && (
                                      <td className="py-3 px-4">
                                        <div className="flex items-center gap-2">
                                          {v.image_url ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={v.image_url} alt="" className="w-7 h-7 rounded-md object-cover border border-gray-200" />
                                          ) : v.option3 ? (
                                            <div className="w-5 h-5 rounded-md border border-gray-300 shrink-0" style={{ background: v.option3 }} />
                                          ) : null}
                                          <span className="text-gray-600 text-xs">{v.option2 || v._color || '—'}</span>
                                        </div>
                                      </td>
                                    )}
                                    <td className="py-3 px-4">
                                      <input type="number" value={v.price ?? ''}
                                        onChange={e => { const nv = [...variants]; nv[index].price = parseFloat(e.target.value) || 0; setVariants(nv); }}
                                        placeholder={price || '0'}
                                        className="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 text-sm" />
                                    </td>
                                    <td className="py-3 px-4">
                                      <input type="number" value={v.quantity ?? 0}
                                        onChange={e => { const nv = [...variants]; nv[index].quantity = parseInt(e.target.value) || 0; setVariants(nv); }}
                                        className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 text-sm" />
                                    </td>
                                    <td className="py-3 px-4 text-right">
                                      <button type="button"
                                        onClick={() => removeVariant(v, index)}
                                        aria-label={`Remove variant ${v.name}`}
                                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                        <i className="ri-close-line"></i>
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile: stacked card list — every field + delete is visible without horizontal scroll */}
                        <div className="md:hidden space-y-3">
                          {variants.map((v, index) => {
                            if (v._disabled) return null;
                            return (
                              <div
                                key={v.id || index}
                                className="border border-gray-200 rounded-xl bg-white p-4 shadow-sm"
                              >
                                <div className="flex items-start justify-between gap-3 mb-3">
                                  <div className="min-w-0">
                                    <p className="font-semibold text-gray-900 text-sm break-words">{v.name}</p>
                                    {showColorColumn && (
                                      <div className="flex items-center gap-2 mt-1.5">
                                        {v.image_url ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img src={v.image_url} alt="" className="w-6 h-6 rounded-md object-cover border border-gray-200" />
                                        ) : v.option3 ? (
                                          <div className="w-5 h-5 rounded-md border border-gray-300 shrink-0" style={{ background: v.option3 }} />
                                        ) : null}
                                        <span className="text-gray-600 text-xs">{v.option2 || v._color || '—'}</span>
                                      </div>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeVariant(v, index)}
                                    aria-label={`Remove variant ${v.name}`}
                                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                                  >
                                    <i className="ri-delete-bin-line text-sm"></i>
                                    Remove
                                  </button>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <label className="block">
                                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Price (GH₵)</span>
                                    <input
                                      type="number"
                                      value={v.price ?? ''}
                                      onChange={e => { const nv = [...variants]; nv[index].price = parseFloat(e.target.value) || 0; setVariants(nv); }}
                                      placeholder={price || '0'}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 text-sm"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Stock</span>
                                    <input
                                      type="number"
                                      value={v.quantity ?? 0}
                                      onChange={e => { const nv = [...variants]; nv[index].quantity = parseInt(e.target.value) || 0; setVariants(nv); }}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 text-sm"
                                    />
                                  </label>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* Empty state */}
              {variants.filter(v => !v._disabled).length === 0 && variants.length === 0 && (
                <div className="border-2 border-dashed border-gray-200 rounded-2xl py-14 text-center">
                  <i className="ri-stack-line text-5xl text-gray-300 mb-3 block"></i>
                  <p className="font-semibold text-gray-500">No variants generated yet</p>
                  <p className="text-sm text-gray-400 mt-1">Fill in sizes and/or colors above, then click <strong>Generate Variants</strong></p>
                </div>
              )}
              {variants.filter(v => !v._disabled).length === 0 && variants.length > 0 && (
                <div className="border-2 border-dashed border-amber-200 rounded-2xl py-10 text-center bg-amber-50">
                  <i className="ri-error-warning-line text-4xl text-amber-400 mb-2 block"></i>
                  <p className="font-semibold text-amber-700">All combinations are disabled</p>
                  <p className="text-sm text-amber-600 mt-1">Check at least one cell in the matrix above to enable it</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'images' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">Product Images</h3>
                <p className="text-gray-600">Upload images via URL or file upload. Drag to reorder.</p>
              </div>

              {/* Image Upload Methods */}
              <div className="space-y-4">
                {/* URL Input */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">Add Image URL</label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      placeholder="https://example.com/image.jpg"
                      className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      onKeyPress={async (e) => {
                        if (e.key === 'Enter' && e.currentTarget.value) {
                          const url = e.currentTarget.value;

                          if (productId === 'new') {
                            setImages([...images, { url, position: images.length }]);
                            e.currentTarget.value = '';
                            toast.success('Image added');
                            return;
                          }

                          try {
                            const { error } = await supabase.from('product_images').insert({
                              product_id: productId,
                              url: url,
                              position: images.length,
                              alt_text: productName
                            });
                            if (error) throw error;
                            setImages([...images, { url, position: images.length }]);
                            e.currentTarget.value = '';
                            toast.success('Image added');
                          } catch (err) {
                            toast.error('Failed to add image');
                          }
                        }
                      }}
                    />
                    <button
                      onClick={async (e) => {
                        const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                        const url = input.value;
                        if (!url) return;

                        if (productId === 'new') {
                          setImages([...images, { url, position: images.length }]);
                          input.value = '';
                          toast.success('Image added');
                          return;
                        }

                        try {
                          const { error } = await supabase.from('product_images').insert({
                            product_id: productId,
                            url: url,
                            position: images.length,
                            alt_text: productName
                          });
                          if (error) throw error;
                          setImages([...images, { url, position: images.length }]);
                          input.value = '';
                          toast.success('Image added');
                        } catch (err) {
                          toast.error('Failed to add image');
                        }
                      }}
                      className="px-6 py-3 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 font-semibold whitespace-nowrap"
                    >
                      Add URL
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Press Enter or click "Add URL" to add the image</p>
                </div>

                {/* File Upload */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">Upload from Computer</label>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-emerald-500 transition-colors">
                    <input
                      type="file"
                      accept="image/*,video/mp4,video/webm"
                      multiple
                      className="hidden"
                      id="image-upload"
                      onChange={async (e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length === 0) return;

                        toast.info(`Uploading ${files.length} file(s) to storage...`);

                        for (const file of files) {
                          try {
                            // Upload directly to Supabase Storage
                            const fileExt = file.name.split('.').pop() || 'jpg';
                            const filePath = `products/${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;

                            const { error: uploadError } = await supabase.storage
                              .from('products')
                              .upload(filePath, file, { upsert: true });

                            if (uploadError) {
                              console.error('Storage upload error:', uploadError);
                              toast.error(`Failed to upload ${file.name}: ${uploadError.message}`);
                              continue;
                            }

                            // Get the public CDN URL
                            const { data: { publicUrl } } = supabase.storage
                              .from('products')
                              .getPublicUrl(filePath);

                            if (productId === 'new') {
                              // Stage for new products — saved on form submit
                              setImages(prev => [...prev, { url: publicUrl, position: prev.length }]);
                            } else {
                              // Save directly to DB for existing products
                              // Use setImages functional updater to get fresh length, avoiding stale closure
                              await new Promise<void>((resolve, reject) => {
                                setImages(prev => {
                                  const position = prev.length;
                                  supabase.from('product_images').insert({
                                    product_id: productId,
                                    url: publicUrl,
                                    position,
                                    alt_text: productName,
                                  }).then(({ error: dbError }) => {
                                    if (dbError) reject(dbError);
                                    else resolve();
                                  });
                                  return [...prev, { url: publicUrl, position }];
                                });
                              });
                            }

                            toast.success(`${file.name} uploaded!`);
                          } catch (err: any) {
                            toast.error(`Failed to upload ${file.name}: ${err.message}`);
                          }
                        }

                        e.target.value = '';
                      }}
                    />
                    <label htmlFor="image-upload" className="cursor-pointer">
                      <i className="ri-upload-cloud-line text-4xl text-gray-400 mb-2 block"></i>
                      <p className="text-gray-700 font-medium">Click to upload or drag and drop</p>
                      <p className="text-sm text-gray-500 mt-1">Images (PNG, JPG) or Videos (MP4, WebM)</p>
                    </label>
                  </div>
                </div>
              </div>

              {/* Image Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {images.filter(img => img?.url).map((image, index) => {
                  const isVideo = image.url.startsWith('data:video') || image.url.match(/\.(mp4|webm|ogg|mov)$/i);
                  return (
                    <div key={index} className="relative group">
                      <div className="aspect-square bg-gray-100 rounded-xl overflow-hidden border-2 border-gray-200">
                        {isVideo ? (
                          <video
                            src={
                              image.url.startsWith('data:')
                                ? image.url
                                : `${image.url.split('#')[0]}${image.url.includes('?') ? '&' : '?'}v=range-1#t=0.001`
                            }
                            className="w-full h-full object-cover"
                            muted
                            playsInline
                            loop
                            preload="metadata"
                            onLoadedMetadata={(e) => {
                              const v = e.currentTarget;
                              v.muted = true;
                              v.volume = 0;
                              if (v.currentTime < 0.05) {
                                try { v.currentTime = 0.05; } catch { /* ignore */ }
                              }
                            }}
                            onPlay={(e) => {
                              e.currentTarget.muted = true;
                              e.currentTarget.volume = 0;
                            }}
                            onMouseOver={e => { e.currentTarget.muted = true; void e.currentTarget.play(); }}
                            onMouseOut={e => e.currentTarget.pause()}
                          />
                        ) : (
                          <LazyImage
                            src={image.url}
                            alt={`Product ${index + 1}`}
                            fill
                            sizes="(max-width: 768px) 50vw, 25vw"
                            className="w-full h-full"
                          />
                        )}
                        {isVideo && (
                          <div className="absolute top-2 right-2 bg-black/50 text-white p-1 rounded-full">
                            <i className="ri-movie-fill"></i>
                          </div>
                        )}
                      </div>

                      {/* Overlay Controls */}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center gap-2">
                        <button
                          onClick={async () => {
                            if (!confirm('Delete this item?')) return;

                            if (productId === 'new') {
                              setImages(images.filter((_, i) => i !== index));
                              return;
                            }

                            try {
                              const { error } = await supabase
                                .from('product_images')
                                .delete()
                                .eq('product_id', productId)
                                .eq('url', image.url);

                              if (error) throw error;
                              setImages(images.filter((_, i) => i !== index));
                              toast.success('Deleted');
                            } catch (err) {
                              toast.error('Failed to delete');
                            }
                          }}
                          className="w-10 h-10 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center justify-center"
                        >
                          <i className="ri-delete-bin-line"></i>
                        </button>

                        {/* Reorder buttons logic can remain or be updated similarly if we want reorder on new products */}
                        {/* For brevity, omitting detailed reorder update here, assuming delete is main priority for user */}
                        {index > 0 && (
                          <button
                            onClick={async () => {
                              const newImages = [...images];
                              [newImages[index], newImages[index - 1]] = [newImages[index - 1], newImages[index]];
                              setImages(newImages);
                              // Update positions in DB
                              if (productId !== 'new') {
                                for (let i = 0; i < newImages.length; i++) {
                                  await supabase
                                    .from('product_images')
                                    .update({ position: i })
                                    .eq('product_id', productId)
                                    .eq('url', newImages[i].url);
                                }
                              }
                            }}
                            className="w-10 h-10 bg-gray-700 hover:bg-gray-800 text-white rounded-lg flex items-center justify-center"
                          >
                            <i className="ri-arrow-left-line"></i>
                          </button>
                        )}

                        {index < images.length - 1 && (
                          <button
                            onClick={async () => {
                              const newImages = [...images];
                              [newImages[index], newImages[index + 1]] = [newImages[index + 1], newImages[index]];
                              setImages(newImages);
                              // Update positions in DB
                              if (productId !== 'new') {
                                for (let i = 0; i < newImages.length; i++) {
                                  await supabase
                                    .from('product_images')
                                    .update({ position: i })
                                    .eq('product_id', productId)
                                    .eq('url', newImages[i].url);
                                }
                              }
                            }}
                            className="w-10 h-10 bg-gray-700 hover:bg-gray-800 text-white rounded-lg flex items-center justify-center"
                          >
                            <i className="ri-arrow-right-line"></i>
                          </button>
                        )}
                      </div>

                      {/* Position Badge */}
                      <div className="absolute top-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                        #{index + 1}
                      </div>
                    </div>
                  );
                })}
                {images.length === 0 && (
                  <div className="col-span-4 text-center py-12 text-gray-500">
                    <i className="ri-image-line text-4xl mb-2 block text-gray-300"></i>
                    <p>No images uploaded yet. Add your first image above.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'seo' && (
            <div className="space-y-6 max-w-3xl">
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">Search Engine Optimization</h3>
                <p className="text-gray-600">Optimize how this product appears in search results</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Page Title
                </label>
                <input
                  type="text"
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Meta Description
                </label>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={seoDescription}
                  onChange={(e) => setSeoDescription(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  URL Slug
                </label>
                <div className="flex items-center">
                  <span className="text-gray-600 bg-gray-100 px-4 py-3 border-2 border-r-0 border-gray-300 rounded-l-lg">
                    /product/
                  </span>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-r-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Keywords
                </label>
                <input
                  type="text"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="leather, bag, accessories"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
                <p className="text-sm text-gray-500 mt-2">Separate keywords with commas</p>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-1">Stock History</h3>
                  <p className="text-gray-600">Every stock change for this product — sales, restocks, cancellations and manual edits</p>
                </div>
                <button
                  type="button"
                  onClick={() => setStockHistoryLoaded(false)}
                  className="px-4 py-2 border-2 border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:border-gray-300 flex items-center gap-2"
                >
                  <i className="ri-refresh-line"></i> Refresh
                </button>
              </div>

              {stockHistoryLoading ? (
                <div className="py-12 text-center text-gray-500">Loading stock history…</div>
              ) : stockMovements.length === 0 ? (
                <div className="py-12 text-center text-gray-500">
                  <i className="ri-history-line text-4xl text-gray-300 block mb-2"></i>
                  No stock movements recorded yet. Changes are logged automatically from now on.
                </div>
              ) : (
                <div className="overflow-x-auto border border-gray-200 rounded-xl">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700 whitespace-nowrap">Date &amp; Time</th>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">Variant</th>
                        <th className="text-right py-3 px-4 font-semibold text-gray-700">Change</th>
                        <th className="text-right py-3 px-4 font-semibold text-gray-700 whitespace-nowrap">Stock After</th>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">Reason</th>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">Reference</th>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {stockMovements.map((m) => {
                        const reasonLabels: Record<string, { label: string; cls: string }> = {
                          sale: { label: 'Sale', cls: 'bg-blue-100 text-blue-700' },
                          order_cancelled: { label: 'Order cancelled (restock)', cls: 'bg-amber-100 text-amber-700' },
                          item_cancelled: { label: 'Item cancelled (restock)', cls: 'bg-amber-100 text-amber-700' },
                          item_returned: { label: 'Item returned (restock)', cls: 'bg-orange-100 text-orange-700' },
                          manual_adjustment: { label: 'Manual adjustment', cls: 'bg-gray-100 text-gray-700' },
                          initial_stock: { label: 'Stock added', cls: 'bg-emerald-100 text-emerald-700' },
                          variant_removed: { label: 'Variant removed', cls: 'bg-red-100 text-red-700' },
                        };
                        const reason = reasonLabels[m.reason] || { label: m.reason, cls: 'bg-gray-100 text-gray-700' };
                        return (
                          <tr key={m.id} className="hover:bg-gray-50">
                            <td className="py-3 px-4 text-gray-600 whitespace-nowrap">
                              {new Date(m.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="py-3 px-4 text-gray-900 font-medium">{m.variant_name || '—'}</td>
                            <td className={`py-3 px-4 text-right font-bold whitespace-nowrap ${m.change > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {m.change > 0 ? `+${m.change}` : m.change}
                            </td>
                            <td className="py-3 px-4 text-right text-gray-700">{m.quantity_after ?? '—'}</td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${reason.cls}`}>
                                {reason.label}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-gray-600 whitespace-nowrap">{m.reference || '—'}</td>
                            <td className="py-3 px-4 text-gray-600 truncate max-w-[160px]">{m.user_email || 'System'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div >
  );
}
