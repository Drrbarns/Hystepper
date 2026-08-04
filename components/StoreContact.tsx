'use client';

import { useCMS } from '@/context/CMSContext';

const DEFAULT_EMAIL = 'info@hystepper.com';
const DEFAULT_PHONE = '0276558163';
const DEFAULT_ADDRESS = 'Accra, Ghana';

/** Strip accidental JSON/Coolify quotes around setting values. */
export function cleanSettingValue(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
}

export function useStoreContact() {
  const { getSetting } = useCMS();
  const email = cleanSettingValue(getSetting('contact_email')) || DEFAULT_EMAIL;
  const phone = cleanSettingValue(getSetting('contact_phone')) || DEFAULT_PHONE;
  const address = cleanSettingValue(getSetting('contact_address')) || DEFAULT_ADDRESS;
  const whatsappRaw = cleanSettingValue(getSetting('whatsapp_number')) || phone;
  const whatsappDigits = whatsappRaw.replace(/\D/g, '');

  return {
    email,
    phone,
    address,
    whatsappDigits,
    mailto: `mailto:${email}`,
    tel: `tel:${phone.replace(/\s/g, '')}`,
    whatsappUrl: whatsappDigits ? `https://wa.me/${whatsappDigits}` : '',
  };
}

export function StoreContactEmail({
  className,
}: {
  className?: string;
}) {
  const { email, mailto } = useStoreContact();
  return (
    <a href={mailto} className={className}>
      {email}
    </a>
  );
}

export function StoreContactPhone({
  className,
}: {
  className?: string;
}) {
  const { phone, tel } = useStoreContact();
  return (
    <a href={tel} className={className}>
      {phone}
    </a>
  );
}
