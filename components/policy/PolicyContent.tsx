'use client';

import { sanitizeHtml } from '@/lib/sanitize';
import { looksLikeHtml } from '@/lib/policy-html';

type PolicyContentProps = {
  text: string;
  variant?: 'storefront' | 'admin';
};

function PlainPolicyBody({ text, variant }: { text: string; variant: 'storefront' | 'admin' }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks: Array<{ type: 'p'; text: string } | { type: 'ul'; items: string[] }> = [];

  lines.forEach((line) => {
    if (line.startsWith('- ')) {
      const item = line.slice(2).trim();
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'ul') {
        blocks[blocks.length - 1] = { type: 'ul', items: [...last.items, item] };
      } else {
        blocks.push({ type: 'ul', items: [item] });
      }
    } else {
      blocks.push({ type: 'p', text: line });
    }
  });

  const isStore = variant === 'storefront';

  return (
    <div className={`space-y-4 text-sm md:text-base leading-relaxed ${isStore ? 'text-gray-300' : 'text-gray-700'}`}>
      {blocks.map((block, i) =>
        block.type === 'p' ? (
          <p key={i} className={isStore ? 'text-center' : ''}>{block.text}</p>
        ) : (
          <ul key={i} className={`space-y-2 ${isStore ? 'text-left max-w-xl mx-auto' : ''}`}>
            {block.items.map((item, j) => (
              <li key={j} className="flex items-start gap-2">
                <span className={isStore ? 'text-gold-400 mt-0.5' : 'text-emerald-600 mt-0.5'}>&bull;</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

export default function PolicyContent({ text, variant = 'storefront' }: PolicyContentProps) {
  if (looksLikeHtml(text)) {
    const isStore = variant === 'storefront';
    return (
      <div
        className={
          isStore
            ? 'policy-html text-gray-300 text-sm md:text-base leading-relaxed text-center [&_p]:mb-4 [&_ul]:text-left [&_ul]:max-w-xl [&_ul]:mx-auto [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_ol]:text-left [&_ol]:max-w-xl [&_ol]:mx-auto [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:marker:text-gold-400 [&_strong]:text-white [&_a]:text-gold-400 [&_a]:underline'
            : 'policy-html text-sm text-gray-700 leading-relaxed [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_strong]:font-semibold'
        }
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }}
      />
    );
  }

  return <PlainPolicyBody text={text} variant={variant} />;
}
