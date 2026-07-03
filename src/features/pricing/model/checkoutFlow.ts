// Checkout flow (AD-04 / BR-MIGRAR-029). Abre o Stripe no browser externo
// (shell.openExternal no desktop; window.open '_self' na web) e, no desktop, corre
// uma RACE entre o deep link (filmassistant://stripe/{success|cancel}) e o POLLING
// de /user (5s por 2min). Quem chegar primeiro resolve. Dupla proteção (RISK-006).
import { createCheckout } from '../api/checkout';
import { openStripe, onStripeCallback } from '../../../lib/stripeDeepLink';
import { isDesktop } from '../../../lib/ipcClient';
import { clock, TimerHandle } from '../../../lib/clock';
import type { PlanId } from '../../../models/products';

export const POLL_INTERVAL_MS = 5_000;
export const POLL_DURATION_MS = 120_000; // 2 min

export type CheckoutOutcome = 'success' | 'cancel' | 'timeout';
export interface CheckoutResult {
  outcome: CheckoutOutcome;
  source: 'deep_link' | 'polling' | 'web';
}

export interface UserSnapshot {
  cap: number;
  subscription: string | null;
}

export interface StartCheckoutDeps {
  plan: PlanId;
  email: string;
  userId: string;
  token: string;
  /** Lê o estado atual de cap/subscription (refetch /user) — injetado p/ desacoplar. */
  pollUser: () => Promise<UserSnapshot>;
  onResolved?: (result: CheckoutResult) => void;
}

function changed(a: UserSnapshot, b: UserSnapshot): boolean {
  return a.cap !== b.cap || a.subscription !== b.subscription;
}

/**
 * Inicia o checkout. Retorna `{ cancel }`. No desktop resolve via deep link OU polling;
 * na web a aba navega para o Stripe e o retorno é via redirect normal (source 'web').
 */
export async function startCheckout(deps: StartCheckoutDeps): Promise<{ cancel: () => void }> {
  const url = await createCheckout({
    plan: deps.plan,
    email: deps.email,
    userId: deps.userId,
    token: deps.token,
  });

  await openStripe(url);

  if (!isDesktop()) {
    // Web: a aba já navegou para o Stripe; o retorno acontece por redirect.
    deps.onResolved?.({ outcome: 'success', source: 'web' });
    return { cancel: () => {} };
  }

  // Desktop: race deep link vs polling.
  let resolved = false;
  let pollTimer: TimerHandle | null = null;
  let deadlineTimer: TimerHandle | null = null;
  let offDeepLink: (() => void) | null = null;

  const cleanup = () => {
    if (pollTimer) clock.clearInterval(pollTimer);
    if (deadlineTimer) clock.clearTimeout(deadlineTimer);
    offDeepLink?.();
  };
  const resolve = (result: CheckoutResult) => {
    if (resolved) return;
    resolved = true;
    cleanup();
    deps.onResolved?.(result);
  };

  const baseline = await deps.pollUser().catch(() => null);

  offDeepLink = onStripeCallback((res) => {
    resolve({ outcome: res === 'cancel' ? 'cancel' : 'success', source: 'deep_link' });
  });

  pollTimer = clock.setInterval(() => {
    void (async () => {
      try {
        const snap = await deps.pollUser();
        if (baseline && changed(baseline, snap)) {
          resolve({ outcome: 'success', source: 'polling' });
        }
      } catch {
        /* ignora falha de poll individual */
      }
    })();
  }, POLL_INTERVAL_MS);

  deadlineTimer = clock.setTimeout(() => resolve({ outcome: 'timeout', source: 'polling' }), POLL_DURATION_MS);

  return { cancel: () => resolve({ outcome: 'cancel', source: 'deep_link' }) };
}
