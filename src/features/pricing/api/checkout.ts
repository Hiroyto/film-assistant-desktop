// Checkout API (BC-06). POST /checkout → URL Stripe (res.data.headers.Location).
// Preserva o contrato legado: event ∈ {member, base, discount}; email + userId no body.
import { safeApiCall } from '../../../models/apiHelpers';
import type { PlanId } from '../../../models/products';

/** Mapeia o PlanId canônico para o `event` esperado pela Lambda legada. */
const PLAN_EVENT: Record<PlanId, 'member' | 'base' | 'discount'> = {
  member: 'member',
  base: 'base',
  refill: 'discount', // refill (member-only) = "discount" no backend legado
};

export interface CheckoutParams {
  plan: PlanId;
  email: string;
  userId: string; // cognito:username
  token: string;
}

/** Cria a sessão de checkout e retorna a URL hospedada do Stripe. */
export async function createCheckout(params: CheckoutParams): Promise<string> {
  const res = await safeApiCall(
    'checkout',
    { event: PLAN_EVENT[params.plan], email: params.email, userId: params.userId },
    params.token,
  );
  if (!res.success) {
    throw new Error(res.error || 'Falha ao criar checkout');
  }
  const url: string | undefined = res.data?.headers?.Location;
  if (!url) throw new Error('Checkout sem URL (Location ausente)');
  return url;
}

export { PLAN_EVENT };
