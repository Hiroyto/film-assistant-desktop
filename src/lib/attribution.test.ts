// What brought a writer here (FIL-621): read off the URL, kept until sign-in.
import { touchFrom, captureTouch, attributionPayload, FIRST_KEY, LAST_KEY, VISITOR_KEY, wasSent, markSent } from './attribution';
import { saveConsent, CONSENT_KEY } from './consent';

beforeEach(() => {
  window.localStorage.clear();
  document.cookie = '_ga=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  document.cookie = '_fbp=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  document.cookie = '__obref=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('touchFrom', () => {
  it('reads UTMs, the platforms\' click ids and ?ref=', () => {
    const t = touchFrom('https://filmassistant.io/?utm_source=reddit&utm_campaign=fdx-angle&utm_content=cr7&rdt_cid=RDT1&ref=jo', '')!;
    expect(t).toMatchObject({ source: 'reddit', campaign: 'fdx-angle', content: 'cr7', rdt_cid: 'RDT1', ref: 'jo', landing: '/' });
  });
  it('reads the ChatGPT ads click id', () => {
    expect(touchFrom('https://filmassistant.io/?utm_source=chatgpt&oppref=OPP1', '')).toMatchObject({ source: 'chatgpt', oppref: 'OPP1' });
  });
  it('a visit from another site counts, with its referrer', () => {
    const t = touchFrom('https://filmassistant.io/pricing', 'https://news.ycombinator.com/item?id=1')!;
    expect(t.referrer).toBe('https://news.ycombinator.com/item?id=1');
    expect(t.landing).toBe('/pricing');
  });
  it('coming back from Google or Apple sign-in is not a touch', () => {
    expect(touchFrom('https://filmassistant.io/', 'https://accounts.google.com/')).toBeNull();
    expect(touchFrom('https://filmassistant.io/', 'https://appleid.apple.com/auth')).toBeNull();
    expect(touchFrom('https://filmassistant.io/', 'https://filmassistant.auth.us-east-1.amazoncognito.com/oauth2/idpresponse')).toBeNull();
  });
  it('a plain visit, or one from our own pages, carries nothing', () => {
    expect(touchFrom('https://filmassistant.io/', '')).toBeNull();
    expect(touchFrom('https://filmassistant.io/home', 'https://filmassistant.io/')).toBeNull();
  });
});

describe('captureTouch', () => {
  it('keeps the first touch for good and the last touch up to date', () => {
    captureTouch('https://filmassistant.io/?utm_source=reddit&rdt_cid=A', '');
    captureTouch('https://filmassistant.io/', '');
    captureTouch('https://filmassistant.io/?utm_source=meta&fbclid=F', '');
    expect(JSON.parse(window.localStorage.getItem(FIRST_KEY)!).source).toBe('reddit');
    expect(JSON.parse(window.localStorage.getItem(LAST_KEY)!).source).toBe('meta');
    expect(window.localStorage.getItem(VISITOR_KEY)).toBeTruthy();
  });
});

describe('attributionPayload', () => {
  it('sends ad and analytics cookies only with consent', () => {
    document.cookie = '_ga=GA1.1.123.456';
    document.cookie = '_fbp=fb.1.1.99';
    document.cookie = '__obref=OB-1';
    expect(attributionPayload()).toMatchObject({ consent: { ads: false, analytics: false }, gaClientId: '', fbp: '', obref: '' });
    saveConsent({ ads: true, analytics: true });
    expect(attributionPayload()).toMatchObject({ consent: { ads: true, analytics: true }, gaClientId: '123.456', fbp: 'fb.1.1.99', obref: 'OB-1' });
  });
  it('is sent again when the cookie choice changes', () => {
    markSent('u1');
    expect(wasSent('u1')).toBe(true);
    saveConsent({ ads: true, analytics: false });
    expect(wasSent('u1')).toBe(false);
    expect(window.localStorage.getItem(CONSENT_KEY)).toContain('"ads":true');
  });
});
