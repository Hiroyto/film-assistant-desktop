// BC-06 Pricing — API pública.
export { createCheckout, PLAN_EVENT } from './api/checkout';
export * from './model/checkoutFlow';
// Gating + catálogo vivem no modelo canônico (Tarefa 04):
export { canPurchaseRefill, isCurrentPlan, products, REFILL_PRICE, MEMBER_PRICE, BASE_PRICE } from '../../models/products';
export type { PlanId, Subscription } from '../../models/products';
