// stripeDeepLink — primitivo do checkout Stripe via deep link (BC-10 / AD-04).
//
// ESCOPO TAREFA 05: a primitiva reutilizável — abrir a URL Stripe no browser externo
// (shell.openExternal) e escutar o callback filmassistant://stripe/{success|cancel}.
// O FLUXO COMPLETO (invocar Lambda p/ obter a URL, polling /user 5s/2min como fallback,
// atualizar subscription state) é montado na TAREFA 09 (BC-06 Billing), que consome
// estas funções.

import { openExternal, onDeepLink } from './ipcClient';

export type StripeCallbackResult = 'success' | 'cancel';

const STRIPE_HOST = 'stripe';

/**
 * Abre a URL de Checkout/Portal do Stripe no browser externo do OS.
 * Desktop: shell.openExternal. Web: window.open (legado).
 */
export async function openStripe(url: string): Promise<void> {
  await openExternal(url);
}

/**
 * Inscreve um handler para o callback do Stripe via deep link
 * (`filmassistant://stripe/success` | `filmassistant://stripe/cancel`).
 * Retorna unsubscribe. No-op na web (lá o retorno é via redirect normal da aba).
 */
export function onStripeCallback(
  handler: (result: StripeCallbackResult, query: Record<string, string>) => void,
): () => void {
  return onDeepLink((payload) => {
    if (payload.host !== STRIPE_HOST) return;
    const result: StripeCallbackResult = payload.path.replace(/^\//, '') === 'cancel' ? 'cancel' : 'success';
    handler(result, payload.query);
  });
}
