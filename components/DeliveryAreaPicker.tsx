'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

export type DeliveryZoneOption = {
  id: string;
  name: string;
  is_accra?: boolean;
};

type Props = {
  zones: DeliveryZoneOption[];
  value: string;
  onChange: (zoneName: string) => void;
  error?: boolean;
  placeholder?: string;
  /** Split results into Greater Accra / Other Regions when `is_accra` is present. */
  groupByRegion?: boolean;
  formatSelected?: (zone: DeliveryZoneOption) => string;
  renderOptionRight?: (zone: DeliveryZoneOption) => ReactNode;
  disabled?: boolean;
};

export default function DeliveryAreaPicker({
  zones,
  value,
  onChange,
  error = false,
  placeholder = 'Type to search your area…',
  groupByRegion = true,
  formatSelected,
  renderOptionRight,
  disabled = false,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => zones.find((z) => z.name === value) || null,
    [zones, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return zones;
    return zones.filter((z) => z.name.toLowerCase().includes(q));
  }, [zones, query]);

  const groups = useMemo(() => {
    if (!groupByRegion) {
      return [{ label: null as string | null, items: filtered }];
    }
    const accra = filtered.filter((z) => z.is_accra);
    const other = filtered.filter((z) => !z.is_accra);
    const out: { label: string | null; items: DeliveryZoneOption[] }[] = [];
    if (accra.length) out.push({ label: 'Greater Accra', items: accra });
    if (other.length) out.push({ label: 'Other Regions', items: other });
    if (!out.length) out.push({ label: null, items: [] });
    return out;
  }, [filtered, groupByRegion]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, []);

  const closedLabel = selected
    ? formatSelected?.(selected) ?? selected.name
    : '';

  const inputValue = open ? query : closedLabel;

  const pick = (zone: DeliveryZoneOption) => {
    onChange(zone.name);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const clear = () => {
    onChange('');
    setQuery('');
    setOpen(true);
    inputRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <div
        className={`relative w-full border rounded-lg overflow-hidden transition-colors bg-white ${
          error
            ? 'border-red-500'
            : open
              ? 'border-gold-400 ring-2 ring-gold-300'
              : 'border-gray-300'
        } ${disabled ? 'opacity-60' : ''}`}
      >
        <div className="flex items-center">
          <i className="ri-search-line text-gray-400 ml-3 shrink-0" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            disabled={disabled}
            value={inputValue}
            placeholder={placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              if (value) onChange('');
              setOpen(true);
            }}
            onFocus={() => {
              setOpen(true);
              // Start typing from a clean filter so customers can search immediately.
              setQuery('');
            }}
            className="w-full px-3 py-3 bg-white focus:outline-none min-w-0"
          />
          {value ? (
            <button
              type="button"
              onClick={clear}
              className="mr-2 p-1 text-gray-400 hover:text-gray-600"
              aria-label="Clear delivery area"
            >
              <i className="ri-close-line text-lg" aria-hidden />
            </button>
          ) : (
            <i
              className={`ri-arrow-down-s-line text-gray-400 mr-3 transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden
            />
          )}
        </div>
      </div>

      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-50 w-full mt-1 bg-white border-2 border-gray-200 rounded-lg shadow-xl max-h-60 overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-500 text-center">
              No areas match &ldquo;{query.trim()}&rdquo;
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.label ?? 'all'}>
                {group.label && (
                  <div className="sticky top-0 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500 bg-gray-50 border-b border-gray-100">
                    {group.label}
                  </div>
                )}
                {group.items.map((z) => {
                  const isSelected = value === z.name;
                  return (
                    <button
                      key={z.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => pick(z)}
                      className={`w-full text-left px-4 py-2.5 transition-colors flex items-center justify-between gap-3 cursor-pointer ${
                        isSelected ? 'bg-gold-50' : 'hover:bg-gold-50'
                      }`}
                    >
                      <span className="text-gray-900 min-w-0 truncate flex items-center gap-2">
                        {isSelected && (
                          <i className="ri-check-line text-gold-600 shrink-0" aria-hidden />
                        )}
                        {z.name}
                      </span>
                      {renderOptionRight?.(z)}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
