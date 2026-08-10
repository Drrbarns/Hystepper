'use client';

import type { ReactNode } from 'react';

/**
 * Horizontal-scroll wrapper for admin data tables on narrow viewports.
 * Pair with `min-w-[…]` on the table so swipe actually reveals clipped columns.
 */
export default function AdminTableScroll({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-x-auto overscroll-x-contain touch-pan-x -mx-4 px-4 sm:mx-0 sm:px-0 ${className}`}
    >
      {children}
    </div>
  );
}
