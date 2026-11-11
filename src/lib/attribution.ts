// What brought a writer here (FIL-621): ad click ids, UTMs and ?ref=, read
// off the URL on whatever page they land, kept in this browser until they
// sign in, then handed to the backend once (record-attribution), where it
// joins their account. The first touch is kept for good; the last touch is
// the most recent visit that carried any of these.
//
// Ad links carry utm_source, utm_campaign (the angle or subreddit) and
// utm_content (the creative id); the platforms add their own click id
// (Reddit rdt_cid, Meta fbclid, Google gclid, ChatGPT oppref).

import { readConsent } from './consent';

export interface Touch {
  source?: string; medium?: string; campaign?: string; content?: string; term?: string;
  ref?: string; rdt_cid?: string; fbclid?: string; gclid?: string; oppref?: string;
  landing?: string; referrer?: string; at: string;
}

export const FIRST_KEY = 'fa-attr-first';
export const LAST_KEY = 'fa-attr-last';
export const VISITOR_KEY = 'fa-vid';
const PARAMS: Array<[string, keyof Touch]> = [
  ['utm_source', 'source'], ['utm_medium', 'medium'], ['utm_campaign', 'campaign'], ['utm_content', 'content'], ['utm_term', 'term'],
  ['ref', 'ref'], ['rdt_cid', 'rdt_cid'], ['fbclid', 'fbclid'], ['gclid', 'gclid'], ['oppref', 'oppref'],
];
const OWN_HOSTS = /(^|\.)filmassistant\.io$|^localhost$|^127\.0\.0\.1$/;
// Coming back from a sign-in page is not a visit from somewhere new.
const SIGN_IN_HOSTS = /^accounts\.google\.com$|^appleid\.apple\.com$|(^|\.)amazoncognito\.com$/;

const store = {
  get(k: string): string | null { try { return window.localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string): void { try { window.localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const parse = <T,>(s: string | null): T | null => { try { return s ? (JSON.parse(s) as T) : null; } catch { return null; } };

/** The touch this URL and referrer carry, or null when they carry nothing. */
export function touchFrom(href: string, referrer: string, now = new Date()): Touch | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  const t: Touch = { at: now.toISOString() };
  for (const [p, k] of PARAMS) {
    const v = url.searchParams.get(p);
    if (v) (t as any)[k] = v.slice(0, 300);
  }
  let refHost = '';
  try { refHost = referrer ? new URL(referrer).hostname : ''; } catch { refHost = ''; }
  const external = !!refHost && !OWN_HOSTS.test(refHost) && !SIGN_IN_HOSTS.test(refHost);
  const tagged = PARAMS.some(([, k]) => (t as any)[k]);
  if (!tagged && !external) return null;
  t.landing = url.pathname.slice(0, 300);
  if (external) t.referrer = `${referrer}`.slice(0, 300);
  return t;
}

/** Call once per page load, before anything rewrites the URL. */
export function captureTouch(href = window.location.href, referrer = document.referrer): Touch | null {
  if (!store.get(VISITOR_KEY)) store.set(VISITOR_KEY, (window.crypto?.randomUUID?.() ?? `v${Date.now()}${Math.random().toString(36).slice(2)}`));
  const t = touchFrom(href, referrer);
  if (!t) return null;
  if (!store.get(FIRST_KEY)) store.set(FIRST_KEY, JSON.stringify(t));
  store.set(LAST_KEY, JSON.stringify(t));
  return t;
}

const cookie = (name: string): string => {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&')}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : '';
};

/** Everything record-attribution takes, read now. */
export function attributionPayload() {
  const consent = readConsent();
  const ga = cookie('_ga'); // "GA1.1.<client id>"
  return {
    first: parse<Touch>(store.get(FIRST_KEY)),
    last: parse<Touch>(store.get(LAST_KEY)),
    visitorId: store.get(VISITOR_KEY) ?? '',
    consent: { ads: !!consent?.ads, analytics: !!consent?.analytics },
    gaClientId: consent?.analytics ? ga.split('.').slice(2).join('.') : '',
    fbp: consent?.ads ? cookie('_fbp') : '',
    fbc: consent?.ads ? cookie('_fbc') : '',
    obref: consent?.ads ? cookie('__obref') : '',
  };
}

/** Sent already for this writer with this consent? (Sent again when consent changes.) */
export const sentKey = (userId: string) => `fa-attr-sent:${userId}`;
export function sentSignature(): string {
  const c = readConsent();
  return `${store.get(LAST_KEY) ?? ''}|${c ? `${c.ads}${c.analytics}` : 'none'}`;
}
export const wasSent = (userId: string) => store.get(sentKey(userId)) === sentSignature();
export const markSent = (userId: string) => store.set(sentKey(userId), sentSignature());
