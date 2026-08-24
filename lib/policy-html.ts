import { escapeHtml } from '@/lib/sanitize';

export function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(text);
}

/** Convert dash-list policy copy into HTML the rich editor can format. */
export function plainPolicyToHtml(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const parts: string[] = [];
  let list: string[] = [];

  const flushList = () => {
    if (list.length === 0) return;
    parts.push(`<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
    list = [];
  };

  lines.forEach((line) => {
    if (line.startsWith('- ')) {
      list.push(line.slice(2).trim());
      return;
    }
    flushList();
    parts.push(`<p>${escapeHtml(line)}</p>`);
  });
  flushList();

  return parts.join('');
}

export function policyToEditorHtml(value: string | undefined, fallback: string): string {
  const raw = (value || '').trim() || fallback;
  return looksLikeHtml(raw) ? raw : plainPolicyToHtml(raw);
}
