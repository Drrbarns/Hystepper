'use client';

import { useEffect, useRef, useState } from 'react';
import { useCMS } from '@/context/CMSContext';

const STORAGE_KEY = 'whatsapp-button-pos-v1';
// Don't treat a tiny pointer wiggle as a drag — anything under this many
// pixels of movement still counts as a click that opens WhatsApp.
const DRAG_THRESHOLD = 6;
// Default offset from the bottom-right corner (matches the old layout).
const DEFAULT_RIGHT = 24;
// Sit above the mobile bottom nav (h-16 = 64px) + a little margin. On
// desktop the nav is hidden so this still looks fine.
const DEFAULT_BOTTOM = 88;

type Pos = { x: number; y: number };

function clampToViewport(pos: Pos, size: number, margin = 8): Pos {
  if (typeof window === 'undefined') return pos;
  const maxX = Math.max(margin, window.innerWidth - size - margin);
  const maxY = Math.max(margin, window.innerHeight - size - margin);
  return {
    x: Math.min(Math.max(margin, pos.x), maxX),
    y: Math.min(Math.max(margin, pos.y), maxY),
  };
}

function computeDefaultPos(size: number): Pos {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  return {
    x: window.innerWidth - size - DEFAULT_RIGHT,
    y: window.innerHeight - size - DEFAULT_BOTTOM,
  };
}

export default function WhatsAppButton() {
  const { getSetting } = useCMS();
  // Strip anything that isn't a digit — wa.me only accepts the raw
  // international number (e.g. 233276558163, no spaces / +'s).
  const rawNumber = getSetting('whatsapp_number') || '233276558163';
  const whatsappNumber = rawNumber.replace(/\D/g, '');
  const siteName = getSetting('site_name') || 'Hy_stepper';
  const message = encodeURIComponent(`Hi! I have a question about ${siteName}.`);
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${message}`;

  const buttonRef = useRef<HTMLButtonElement>(null);
  // Once the user picks a custom spot we render absolutely; before then
  // we keep the default Tailwind bottom/right anchoring so the button
  // sits in the same place during SSR / first paint.
  const [position, setPosition] = useState<Pos | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  const dragOffset = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const startPoint = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const movedRef = useRef(false);
  const buttonSize = 56; // matches w-14 h-14

  // Restore the saved position on mount and clamp it to the current viewport.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Pos;
      if (typeof saved.x === 'number' && typeof saved.y === 'number') {
        setPosition(clampToViewport(saved, buttonSize));
      }
    } catch {
      // ignore corrupted storage
    }
  }, []);

  // Re-clamp when the viewport changes (resize / orientation flip).
  useEffect(() => {
    if (!position) return;
    const handleResize = () => {
      setPosition((p) => (p ? clampToViewport(p, buttonSize) : p));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [position]);

  const beginDrag = (clientX: number, clientY: number) => {
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragOffset.current = { dx: clientX - rect.left, dy: clientY - rect.top };
    startPoint.current = { x: clientX, y: clientY };
    movedRef.current = false;
    setIsDragging(true);
    setShowTooltip(false);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Ignore non-primary buttons so right-click etc. doesn't start a drag.
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    buttonRef.current?.setPointerCapture(e.pointerId);
    beginDrag(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - startPoint.current.x;
    const dy = e.clientY - startPoint.current.y;
    if (!movedRef.current && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      movedRef.current = true;
    }
    if (movedRef.current) {
      const next = clampToViewport(
        {
          x: e.clientX - dragOffset.current.dx,
          y: e.clientY - dragOffset.current.dy,
        },
        buttonSize
      );
      setPosition(next);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      buttonRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // pointer was already released; ignore
    }

    if (movedRef.current && position) {
      // Persist the user's chosen spot.
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
      } catch {
        // ignore (private browsing / storage full)
      }
    } else {
      // No real drag happened — treat as a click and open WhatsApp.
      window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const isPositioned = position !== null;
  const containerStyle: React.CSSProperties = isPositioned
    ? { left: position!.x, top: position!.y, right: 'auto', bottom: 'auto' }
    : { right: DEFAULT_RIGHT, bottom: DEFAULT_BOTTOM };

  return (
    <div
      className="fixed z-50 select-none touch-none"
      style={containerStyle}
    >
      {showTooltip && !isDragging && (
        <div className="absolute bottom-16 right-0 bg-white rounded-lg shadow-xl border border-gray-200 p-3 whitespace-nowrap animate-fade-in pointer-events-none">
          <p className="text-sm font-medium text-gray-900">Chat with us on WhatsApp</p>
          <p className="text-xs text-gray-500">Tap to chat · drag to move</p>
          <div className="absolute -bottom-2 right-6 w-4 h-4 bg-white border-b border-r border-gray-200 transform rotate-45"></div>
        </div>
      )}
      <button
        ref={buttonRef}
        type="button"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onMouseEnter={() => !isDragging && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`flex items-center justify-center w-14 h-14 bg-[#25D366] hover:bg-[#20BD5A] rounded-full shadow-lg hover:shadow-xl transition-shadow ${
          isDragging ? 'cursor-grabbing scale-105 shadow-2xl' : 'cursor-grab hover:scale-110'
        } transition-transform`}
        aria-label="Chat on WhatsApp (drag to reposition)"
        title="Tap to chat · drag to move"
      >
        <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white pointer-events-none">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      </button>
    </div>
  );
}
