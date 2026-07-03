// Customer Portal (BC-06 / BR-MIGRAR-029). Abre o portal do Stripe no browser
// externo (shell.openExternal no desktop; window.open '_self' na web — legado).
import { openExternal } from '../../../lib/ipcClient';

/** Abre o Stripe Customer Portal. URL via env (REACT_APP_STRIPE_PORTAL_URL). */
export async function openCustomerPortal(): Promise<void> {
  const url = process.env.REACT_APP_STRIPE_PORTAL_URL;
  if (!url) {
    console.warn('[billing] REACT_APP_STRIPE_PORTAL_URL não configurada');
    return;
  }
  await openExternal(url);
}
