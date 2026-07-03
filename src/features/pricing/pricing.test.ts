// Testes do BC-06 (mapeamento de plano + gating). `craco test`.
import { PLAN_EVENT } from './api/checkout';
import { canPurchaseRefill, isCurrentPlan } from '../../models/products';

describe('PLAN_EVENT (contrato Lambda legado)', () => {
  it('refill mapeia para "discount"', () => {
    expect(PLAN_EVENT.member).toBe('member');
    expect(PLAN_EVENT.base).toBe('base');
    expect(PLAN_EVENT.refill).toBe('discount');
  });
});

describe('gating (BR-MIGRAR-027/028)', () => {
  it('refill é member-only', () => {
    expect(canPurchaseRefill('member')).toBe(true);
    expect(canPurchaseRefill('base')).toBe(false);
  });
  it('Current Plan no card member quando já member', () => {
    expect(isCurrentPlan('member', 'member')).toBe(true);
    expect(isCurrentPlan('member', null)).toBe(false);
  });
});
