import Link from 'next/link';

export const BRAND_LOGO_SRC = '/brand/hy-stepper-logo.png?v=20260813';

type BrandLogoProps = {
  href?: string | null;
  className?: string;
  priority?: boolean;
};

export default function BrandLogo({
  href = '/',
  className = 'h-14 w-auto max-w-[220px] object-contain',
}: BrandLogoProps) {
  const img = (
    <img
      src={BRAND_LOGO_SRC}
      alt="Hy-Stepper"
      className={className}
      width={220}
      height={155}
    />
  );

  if (!href) return img;

  return (
    <Link href={href} className="inline-block" aria-label="Hy-Stepper home">
      {img}
    </Link>
  );
}
