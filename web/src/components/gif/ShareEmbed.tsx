'use client';

import { useEffect, useId, useState } from 'react';

interface ShareEmbedProps {
  /** Absolute URL of the gif's own detail page, e.g. `https://gallery.example/gif/abc123`. */
  pageUrl: string;
  /** Direct URL of the gif asset itself (`gif.url`), used in the embed snippet. */
  assetUrl: string;
  title: string;
  width: number | null;
  height: number | null;
}

type CopyTarget = 'link' | 'embed';

const buttonClassName =
  'rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

const primaryButtonClassName =
  'rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildEmbedSnippet(
  assetUrl: string,
  pageUrl: string,
  title: string,
  width: number | null,
  height: number | null
): string {
  const alt = escapeHtml(title || 'GIF');
  const dims = width && height ? ` width="${width}" height="${height}"` : '';
  return `<a href="${pageUrl}" target="_blank" rel="noopener noreferrer"><img src="${assetUrl}" alt="${alt}"${dims}></a>`;
}

/**
 * Copies `text` to the clipboard. Prefers the async Clipboard API; falls back to a hidden,
 * off-screen textarea + `execCommand('copy')` for browsers/contexts (e.g. non-HTTPS) where
 * `navigator.clipboard` isn't available. Returns whether the copy actually succeeded so callers
 * can fall back to "select it yourself" messaging instead of lying about it.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy fallback below.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Share + embed controls for the GIF detail page (L42-429): native share sheet when the browser
 * supports it, copy-link/copy-embed buttons, social share links that work with no JavaScript at
 * all, and a collapsible embed code snippet. The embed snippet is a plain `<a><img></a>` pointing
 * at the gif's real asset URL - it works today without depending on any not-yet-built backend
 * embed endpoint.
 */
export function ShareEmbed({ pageUrl, assetUrl, title, width, height }: ShareEmbedProps) {
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const [showEmbed, setShowEmbed] = useState(false);
  const [status, setStatus] = useState('');
  const embedFieldId = useId();
  const embedPanelId = useId();

  useEffect(() => {
    // One-time client-only feature check: `navigator` doesn't exist during SSR, so this has to
    // run after mount. Rendering without the Share button first (matching the server) and then
    // adding it once we know the browser supports it avoids a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);

  const shareTitle = title || 'Check out this GIF';
  const embedSnippet = buildEmbedSnippet(assetUrl, pageUrl, shareTitle, width, height);
  const encodedUrl = encodeURIComponent(pageUrl);
  const encodedText = encodeURIComponent(shareTitle);

  const handleCopy = async (target: CopyTarget, text: string, successMessage: string, failureMessage: string) => {
    const ok = await copyText(text);
    setCopied(ok ? target : null);
    setStatus(ok ? successMessage : failureMessage);
    if (!ok && target === 'embed') setShowEmbed(true);
  };

  const handleNativeShare = async () => {
    try {
      await navigator.share({ title: shareTitle, url: pageUrl });
    } catch {
      // The user cancelled the share sheet (or it failed silently) - nothing to surface as an error.
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {canShare ? (
          <button type="button" onClick={() => void handleNativeShare()} className={primaryButtonClassName}>
            Share
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => void handleCopy('link', pageUrl, 'Link copied to clipboard.', "Couldn't copy the link automatically - select and copy it yourself.")}
          className={buttonClassName}
        >
          {copied === 'link' ? 'Copied!' : 'Copy link'}
        </button>

        <a
          href={`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClassName}
        >
          Share on X
        </a>
        <a
          href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClassName}
        >
          Share on Facebook
        </a>
        <a
          href={`https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedText}`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClassName}
        >
          Share on Reddit
        </a>

        <button
          type="button"
          onClick={() => setShowEmbed((prev) => !prev)}
          aria-expanded={showEmbed}
          aria-controls={embedPanelId}
          className={buttonClassName}
        >
          {showEmbed ? 'Hide embed code' : 'Embed'}
        </button>
      </div>

      {showEmbed ? (
        <div id={embedPanelId} className="space-y-2">
          <label htmlFor={embedFieldId} className="block text-sm font-medium text-slate-700">
            Embed code
          </label>
          <textarea
            id={embedFieldId}
            readOnly
            value={embedSnippet}
            rows={2}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded-md border border-slate-300 bg-slate-50 p-2 font-mono text-xs text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          />
          <button
            type="button"
            onClick={() =>
              void handleCopy(
                'embed',
                embedSnippet,
                'Embed code copied to clipboard.',
                "Couldn't copy the embed code automatically - select and copy it from the field above."
              )
            }
            className={buttonClassName}
          >
            {copied === 'embed' ? 'Copied!' : 'Copy embed code'}
          </button>
        </div>
      ) : null}

      {/* Announces copy/share outcomes to screen readers without changing the visible layout. */}
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </div>
  );
}
