// Catálogo de produtos — source-of-truth de preços (DEC-011 / BR-MIGRAR-026).
// O teaser $5.00 da landing era drift; landing está descartada. $4.50 é canônico.
import { isMember } from './user';

export const products = [
    {
        id: 1,
        title: "Member",
        price: "8.00",
        type: "/month",
        badge: true,
        buttonText: "Buy Plan",
        features: [
            "~750 generations per month",
            "Access to Community",
            "Participate in Weekly Contests",
            "Better Rate on Tokens",
            "Cheaper Token Refills",
        ],
    },
    {
        id: 2,
        title: "Base Token Package",
        price: "12.00",
        type: "one-time",
        badge: false,
        buttonText: "Buy Tokens",
        features: [
            "~750 generations",
            "Create more stories",
            "Create more summaries",
            "One time purchase",
        ],
    },
    {
        id: 3,
        title: "Member Token Refill",
        price: "4.50",
        type: "refill",
        badge: false,
        buttonText: "Buy Tokens",
        features: [
            "~750 generations",
            "Member discount applied",
            "One time purchase",
            "Member access only",
        ],
    },
];

// ===========================================================================
// CANÔNICO — AGG-Subscription + gating. Fonte: target_domain_model.md.
// ===========================================================================

/** Preços canônicos (BR-MIGRAR-026 / DEC-011). */
export const MEMBER_PRICE = '8.00';
export const BASE_PRICE = '12.00';
export const REFILL_PRICE = '4.50';

export type PlanId = 'member' | 'base' | 'refill';

export interface Subscription {
  userId: string;
  /** Mesma string de User.subscription (`'member'` é especial). */
  tier: string | null;
  /** Mirror de User.cap. */
  cap: number;
  currentPeriodEnd?: string;
  stripeCustomerId?: string;
}

/** Refill é gated em `subscription === 'member'` (BR-MIGRAR-027 / R-PAY-2). */
export function canPurchaseRefill(subscription: string | null | undefined): boolean {
  return isMember(subscription);
}

/** Member card mostra "Current Plan" desabilitado se o user já é member (BR-MIGRAR-028). */
export function isCurrentPlan(plan: PlanId, subscription: string | null | undefined): boolean {
  return plan === 'member' && isMember(subscription);
}

