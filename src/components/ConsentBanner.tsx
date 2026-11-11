// The tracking consent banner (FIL-621, Ben 2026-10-26: deny by default).
// Shown until the visitor chooses; "Cookie settings" in the footer reopens it.
// Until a yes, Google's tags run in Consent Mode with everything denied and
// the Meta and Reddit pixels are never loaded (lib/consent.ts).

import React, { useEffect, useState } from 'react';
import { gpcOn, onConsentOpen, readConsent, saveConsent } from '../lib/consent';
import { applyPixelConsent, loadPixels } from '../lib/pixels';

export default function ConsentBanner() {
  const [open, setOpen] = useState(() => !readConsent());
  useEffect(() => onConsentOpen(() => setOpen(true)), []);
  useEffect(() => { if (readConsent()?.ads) loadPixels(); }, []);
  if (!open) return null;

  const choose = (all: boolean) => {
    const c = saveConsent({ ads: all, analytics: all });
    applyPixelConsent(c.ads);
    if (c.ads) loadPixels();
    setOpen(false);
  };
  const btn: React.CSSProperties = { font: 'inherit', fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 8, cursor: 'pointer' };

  return (
    <div
      role="dialog" aria-live="polite" aria-label="Cookie choices" data-consent-banner
      style={{
        position: 'fixed', left: 16, bottom: 16, zIndex: 2147483000, maxWidth: 380, boxSizing: 'border-box',
        padding: '14px 16px', borderRadius: 12, background: '#16161a', color: '#ececec',
        border: '1px solid #2c2c33', boxShadow: '0 12px 32px rgba(0,0,0,.35)',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif", fontSize: 13, lineHeight: 1.5,
      }}
    >
      <div style={{ marginBottom: 10 }}>
        We use cookies to see which ads bring writers here and how the site gets used. Nothing is tracked until you say yes.{' '}
        <a href="/privacy.html" style={{ color: '#ff8c42' }}>Privacy Policy</a>
        {gpcOn() && <div data-consent-gpc style={{ marginTop: 6, color: '#a8a8b3' }}>Your browser's Global Privacy Control is on, so advertising cookies stay off.</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" data-consent-necessary onClick={() => choose(false)} style={{ ...btn, background: 'transparent', color: '#ececec', border: '1px solid #3a3a42' }}>Only necessary</button>
        <button type="button" data-consent-accept onClick={() => choose(true)} style={{ ...btn, background: '#ff8c42', color: '#fff', border: '1px solid transparent' }}>Accept</button>
      </div>
    </div>
  );
}
