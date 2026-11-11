// The ad platforms' browser tags (FIL-621): Meta Pixel, Reddit Pixel, the
// ChatGPT ads pixel (oaiq) and Google Ads (through the gtag.js the page
// already loads for Analytics).
// Each loads only after ads consent and only when its id is set at build
// time; without either, every call here does nothing.
//
//   REACT_APP_META_PIXEL_ID, REACT_APP_REDDIT_PIXEL_ID, REACT_APP_OPENAI_PIXEL_ID,
//   REACT_APP_GOOGLE_ADS_ID (AW-...), REACT_APP_GOOGLE_ADS_SIGNUP_LABEL
//
// The first board built is sent server-side (lib/attribution.mjs in the
// backend), so it survives ad blockers and the desktop app; the browser
// sends page views and the sign-up.

import { readConsent } from './consent';

const META = process.env.REACT_APP_META_PIXEL_ID || '';
const REDDIT = process.env.REACT_APP_REDDIT_PIXEL_ID || '';
const OPENAI = process.env.REACT_APP_OPENAI_PIXEL_ID || '';
const GADS = process.env.REACT_APP_GOOGLE_ADS_ID || '';
const GADS_SIGNUP = process.env.REACT_APP_GOOGLE_ADS_SIGNUP_LABEL || '';

const w = () => window as any;
let loaded = false;

function addScript(src: string): void {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

/** Load the tags (once), if the visitor allowed ads measurement. */
export function loadPixels(): string[] {
  if (loaded || !readConsent()?.ads) return [];
  loaded = true;
  const on: string[] = [];
  if (META) {
    if (!w().fbq) {
      const n: any = function (...args: unknown[]) { n.callMethod ? n.callMethod(...args) : n.queue.push(args); };
      n.queue = []; n.loaded = true; n.version = '2.0'; n.push = n;
      w().fbq = n; w()._fbq = n;
      addScript('https://connect.facebook.net/en_US/fbevents.js');
    }
    w().fbq('init', META);
    w().fbq('track', 'PageView');
    on.push('meta');
  }
  if (REDDIT) {
    if (!w().rdt) {
      const p: any = function (...args: unknown[]) { p.sendEvent ? p.sendEvent(...args) : p.callQueue.push(args); };
      p.callQueue = [];
      w().rdt = p;
      addScript('https://www.redditstatic.com/ads/pixel.js');
    }
    w().rdt('init', REDDIT);
    w().rdt('track', 'PageVisit');
    on.push('reddit');
  }
  if (OPENAI) {
    if (!w().oaiq) {
      const q: any = function (...args: unknown[]) { q.q.push(args); };
      q.q = [];
      w().oaiq = q;
      addScript('https://bzrcdn.openai.com/sdk/oaiq.min.js');
    }
    w().oaiq('init', { pixelId: OPENAI });
    on.push('openai');
  }
  if (GADS && typeof w().gtag === 'function') {
    w().gtag('config', GADS);
    on.push('google_ads');
  }
  return on;
}

/** A new account: the sign-up conversion, once, with an id the platforms dedupe on. */
export function trackSignUp(userId: string): void {
  if (!readConsent()?.ads) return;
  loadPixels();
  const id = `signup_${userId}`;
  if (META && w().fbq) w().fbq('track', 'CompleteRegistration', {}, { eventID: id });
  if (REDDIT && w().rdt) w().rdt('track', 'SignUp', { conversionId: id });
  if (OPENAI && w().oaiq) w().oaiq('measure', 'registration_completed', { type: 'customer_action' }, { event_id: id });
  if (typeof w().gtag === 'function') {
    w().gtag('event', 'sign_up', { method: 'filmassistant' });
    // The Ads "SIGNUP" conversion, reaching Ads through the combined Google tag
    // (G-5Q1VS7MNJ9 now carries AW-966922759).
    w().gtag('event', 'conversion_event_signup', { transaction_id: id });
    if (GADS && GADS_SIGNUP) w().gtag('event', 'conversion', { send_to: `${GADS}/${GADS_SIGNUP}`, transaction_id: id });
  }
}

/** A withdrawn choice, mid-visit: the ChatGPT pixel stops sending (and drops
 *  its cookies). Meta and Reddit have no switch; they stop on the next load. */
export function applyPixelConsent(ads: boolean): void {
  if (w().oaiq) w().oaiq('consent', ads);
}

/** For tests. */
export const pixelIds = () => ({ META, REDDIT, OPENAI, GADS, GADS_SIGNUP });
