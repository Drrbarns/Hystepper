import Link from 'next/link';

type BrandLogoProps = {
  href?: string | null;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
};

const SIZE_CLASS = {
  sm: 'text-xl',
  md: 'text-2xl',
  lg: 'text-4xl',
} as const;

/** Text wordmark — matches classic storefront branding. */
export default function BrandLogo({
  href = '/',
  className = '',
  size = 'md',
}: BrandLogoProps) {
  const wordmark = (
    <span
      className={`font-serif font-bold tracking-tight text-gray-900 ${SIZE_CLASS[size]} ${className}`.trim()}
    >
      Hy_stepper
    </span>
  );

  if (!href) return wordmark;

  return (
    <Link href={href} className="inline-block group" aria-label="Hy_stepper home">
      <span
        className={`font-serif font-bold tracking-tight text-gray-900 group-hover:text-gold-600 transition-colors ${SIZE_CLASS[size]} ${className}`.trim()}
      >
        Hy_stepper
      </span>
    </Link>
  );
}
