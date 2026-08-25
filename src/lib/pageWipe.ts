// pageWipe — the board/script switch as a PUSH transition (Ben 2026-08-23).
//
// Not a cover wipe: the page you leave visibly slides off one edge while the
// page you're heading to slides in from the other, in lockstep, like a
// carousel. The router unmounts the outgoing page on navigate, so the
// outgoing surface is a static CLONE of the current DOM in a fixed ghost
// layer (inline styles carry the look); navigation fires immediately and the
// REAL app root plays the incoming half. Board -> Script travels right
// (outgoing exits left); Script -> Board mirrors it.
//
// The ghost carries a light horizontal-only blur while moving (motion blur);
// the incoming page stays crisp — it's what the writer reads on landing.
import { THEME_STORE_KEY } from '../components/Freeform/corkboard/theme';

const DURATION_MS = 340;
const EASING = 'cubic-bezier(0.3, 0.6, 0.2, 1)';
const GHOST_BLUR_PX = 12;

let running = false;

export function playPageWipe(direction: 'right' | 'left', navigate: () => void): void {
  const root = typeof document !== 'undefined' ? document.getElementById('root') : null;
  if (running || !root) { navigate(); return; }
  running = true;

  let dark = true;
  try { dark = (localStorage.getItem(THEME_STORE_KEY) ?? 'dark') !== 'light'; } catch { /* default dark */ }

  // out = where the outgoing page exits; the incoming page enters from the
  // opposite edge. 'right' = traveling right through space: exit left.
  const outX = direction === 'right' ? '-100%' : '100%';
  const inX = direction === 'right' ? '100%' : '-100%';

  // --- Ghost: a static clone of the current page in a fixed layer ---------
  const holder = document.createElement('div');
  holder.setAttribute('data-page-wipe', direction);
  Object.assign(holder.style, {
    position: 'fixed', inset: '0', overflow: 'hidden',
    // Above the app (popovers sit at 99999) — the ghost IS the old page.
    zIndex: '2147483000', pointerEvents: 'all',
    background: dark ? '#0a0a0b' : '#f7f3ea',
    willChange: 'transform',
  } as CSSStyleDeclaration);
  // Horizontal-only Gaussian for the motion smear (CSS blur() is
  // omnidirectional and reads as out-of-focus, not speed).
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.innerHTML =
    '<defs><filter id="pw-mblur" x="-15%" y="0%" width="130%" height="100%">' +
    `<feGaussianBlur in="SourceGraphic" stdDeviation="${GHOST_BLUR_PX},0" /></filter></defs>`;
  let ghost: HTMLElement | null = null;
  try {
    ghost = root.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('id'); // never duplicate #root
    // Freeze the current scroll into the clone (the layer itself is fixed).
    ghost.style.transform = `translateY(${-window.scrollY}px)`;
    ghost.style.pointerEvents = 'none';
    ghost.style.filter = 'url(#pw-mblur)';
    holder.appendChild(svg);
    holder.appendChild(ghost);
    document.body.appendChild(holder);
  } catch {
    holder.remove();
    running = false;
    navigate();
    return;
  }

  let incoming: Animation | null = null;
  let done = false;
  const cleanup = () => {
    if (done) return; // cancel() below re-fires oncancel
    done = true;
    running = false;
    holder.remove();
    try { incoming?.cancel(); } catch { /* already gone */ }
    root.style.transform = '';
    root.style.willChange = '';
  };

  // --- Swap now; animate both halves in the same frame --------------------
  try { navigate(); } catch { cleanup(); return; }
  try {
    window.scrollTo(0, 0); // the incoming page starts at its top
    root.style.willChange = 'transform';
    const opts = { duration: DURATION_MS, easing: EASING, fill: 'forwards' as const };
    holder.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${outX})` }], opts);
    incoming = root.animate([{ transform: `translateX(${inX})` }, { transform: 'translateX(0)' }], opts);
    incoming.onfinish = cleanup;
    incoming.oncancel = cleanup;
  } catch {
    cleanup();
    return;
  }
  // Throttled/hidden tabs can starve animation events — never strand the
  // ghost layer or a transformed root (live miss on the first cut of this).
  window.setTimeout(() => { if (running) cleanup(); }, DURATION_MS + 900);
}
