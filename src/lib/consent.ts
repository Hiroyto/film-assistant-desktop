// Tracking consent (FIL-621, Ben 2026-10-26: a banner, denied by default).
//
// Nothing that tracks across sites runs until the visitor says yes: Google
// tags start in Consent Mode with everything denied (public/index.html), and
// the Meta and Reddit pixels are not even loaded. The choice is kept in this
// browser; "Cookie settings" in the footer reopens the banner.
//
// Global Privacy Control (2026-10-27): a browser that sends the GPC signal has
// opted out of sharing for advertising (California law), so ads read as
// declined whatever was clicked; analytics is unaffected.
//
// What brought a writer here (UTMs, click ids, ?ref=) is kept on our own
// record of them whatever they choose (lib/attribution.ts); only sending it
// to an ad platform waits on ads consent.

export interface Consent {
  /** Ad measurement: the Meta, Reddit and Google Ads tags, and server-side conversions. */
  ads: boolean;
  /** Site analytics: Google Analytics. */
  analytics: boolean;
  at: string;
  v: 1;
}

export const CONSENT_KEY = 'fa-consent';
const OPEN_EVENT = 'fa-consent-open';
const CHANGE_EVENT = 'fa-consent-change';

/** The browser's Global Privacy Control signal. */
export const gpcOn = (): boolean => (navigator as any)?.globalPrivacyControl === true;

export function readConsent(): Consent | null {
  try {
    const c = JSON.parse(window.localStorage.getItem(CONSENT_KEY) || 'null');
    if (!(c && c.v === 1 && typeof c.ads === 'boolean' && typeof c.analytics === 'boolean')) return null;
    return gpcOn() ? { ...c, ads: false } : c;
  } catch {
    return null;
  }
}

type Gtag = (...args: unknown[]) => void;
const gtag = (): Gtag | null => (typeof (window as any).gtag === 'function' ? (window as any).gtag : null);

/** Google Consent Mode: tell the tags what was chosen. */
export function applyToGoogle(c: Pick<Consent, 'ads' | 'analytics'>): void {
  const g = gtag();
  if (!g) return;
  const ad = c.ads ? 'granted' : 'denied';
  g('consent', 'update', { ad_storage: ad, ad_user_data: ad, ad_personalization: ad, analytics_storage: c.analytics ? 'granted' : 'denied' });
}

export function saveConsent(choice: Pick<Consent, 'ads' | 'analytics'>): Consent {
  const c: Consent = { ads: choice.ads && !gpcOn(), analytics: choice.analytics, at: new Date().toISOString(), v: 1 };
  try { window.localStorage.setItem(CONSENT_KEY, JSON.stringify(c)); } catch { /* private mode: holds for this page */ }
  applyToGoogle(c);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: c }));
  return c;
}

export function onConsentChange(fn: (c: Consent) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<Consent>).detail);
  window.addEventListener(CHANGE_EVENT, h);
  return () => window.removeEventListener(CHANGE_EVENT, h);
}

/** Reopen the banner (the footer's "Cookie settings"). */
export function openConsent(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}
export function onConsentOpen(fn: () => void): () => void {
  window.addEventListener(OPEN_EVENT, fn);
  return () => window.removeEventListener(OPEN_EVENT, fn);
}
