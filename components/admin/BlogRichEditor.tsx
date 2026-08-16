'use client';

import { useEffect, useRef } from 'react';

type BlogRichEditorProps = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
};

type Tool = {
  label: string;
  icon: string;
  command?: string;
  value?: string;
  action?: 'link' | 'image' | 'clear';
  title: string;
};

const TOOLS: Tool[] = [
  { label: 'B', icon: 'ri-bold', command: 'bold', title: 'Bold' },
  { label: 'I', icon: 'ri-italic', command: 'italic', title: 'Italic' },
  { label: 'U', icon: 'ri-underline', command: 'underline', title: 'Underline' },
  { label: 'H2', icon: 'ri-h-2', command: 'formatBlock', value: 'h2', title: 'Heading 2' },
  { label: 'H3', icon: 'ri-h-3', command: 'formatBlock', value: 'h3', title: 'Heading 3' },
  { label: 'P', icon: 'ri-paragraph', command: 'formatBlock', value: 'p', title: 'Paragraph' },
  { label: '•', icon: 'ri-list-unordered', command: 'insertUnorderedList', title: 'Bullet list' },
  { label: '1.', icon: 'ri-list-ordered', command: 'insertOrderedList', title: 'Numbered list' },
  { label: 'Quote', icon: 'ri-double-quotes-l', command: 'formatBlock', value: 'blockquote', title: 'Quote' },
  { label: 'Link', icon: 'ri-link', action: 'link', title: 'Insert link' },
  { label: 'Image', icon: 'ri-image-line', action: 'image', title: 'Insert image URL' },
  { label: 'Clear', icon: 'ri-format-clear', action: 'clear', title: 'Clear formatting' },
];

/**
 * Lightweight WYSIWYG for blog posts — no extra npm deps.
 * Saves HTML that the storefront renders safely as admin-authored content.
 */
export default function BlogRichEditor({
  value,
  onChange,
  placeholder = 'Write your article…',
}: BlogRichEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastExternal = useRef<string>('');

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value === lastExternal.current) return;
    if (el.innerHTML === value) return;
    el.innerHTML = value || '';
    lastExternal.current = value || '';
  }, [value]);

  const emitChange = () => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    lastExternal.current = html;
    onChange(html);
  };

  const run = (tool: Tool) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();

    if (tool.action === 'link') {
      const url = window.prompt('Link URL', 'https://');
      if (!url) return;
      document.execCommand('createLink', false, url);
      emitChange();
      return;
    }

    if (tool.action === 'image') {
      const url = window.prompt('Image URL', 'https://');
      if (!url) return;
      document.execCommand('insertImage', false, url);
      emitChange();
      return;
    }

    if (tool.action === 'clear') {
      document.execCommand('removeFormat', false);
      document.execCommand('formatBlock', false, 'p');
      emitChange();
      return;
    }

    if (tool.command === 'formatBlock' && tool.value) {
      document.execCommand('formatBlock', false, tool.value);
    } else if (tool.command) {
      document.execCommand(tool.command, false, tool.value);
    }
    emitChange();
  };

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-emerald-500">
      <div className="flex flex-wrap gap-1 p-2 bg-gray-50 border-b border-gray-200">
        {TOOLS.map((tool) => (
          <button
            key={tool.title}
            type="button"
            title={tool.title}
            onMouseDown={(e) => {
              e.preventDefault();
              run(tool);
            }}
            className="w-9 h-9 inline-flex items-center justify-center rounded-md text-gray-700 hover:bg-white hover:text-emerald-700 border border-transparent hover:border-gray-200 transition-colors"
          >
            <i className={`${tool.icon} text-base`}></i>
          </button>
        ))}
      </div>
      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label="Blog content editor"
        data-placeholder={placeholder}
        className="min-h-[280px] max-h-[480px] overflow-y-auto px-4 py-3 text-gray-900 leading-relaxed outline-none prose prose-sm max-w-none
          empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400 empty:before:pointer-events-none
          [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mt-4 [&_h2]:mb-2
          [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-2
          [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6
          [&_blockquote]:border-l-4 [&_blockquote]:border-emerald-400 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-gray-600
          [&_a]:text-emerald-700 [&_a]:underline
          [&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-3"
        onInput={emitChange}
        onBlur={emitChange}
        suppressContentEditableWarning
      />
      <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 flex items-center gap-2">
        <i className="ri-information-line"></i>
        Use the toolbar for headings, bold, lists, links, and images. Content is saved as formatted HTML.
      </div>
    </div>
  );
}
