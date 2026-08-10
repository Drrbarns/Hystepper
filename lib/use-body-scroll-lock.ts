'use client';

import { useEffect } from 'react';

/**
 * Locks document body scroll while `locked` is true. Use for full-screen
 * mobile drawers/modals so the page underneath doesn't steal touch scroll.
 */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [locked]);
}
