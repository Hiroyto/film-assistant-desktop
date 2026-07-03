# BC-06 — Billing & Subscription (`features/pricing` + `features/profile`)

Profile e Pricing são duas vistas da mesma realidade (subscription). Stripe é uma só
integração. UI legada (`components/Pricing`, `components/Profile`, `pages/app/*`)
**preservada** (Op3); esta camada provê o model/api que ela adota.

## Construído na Tarefa 09

| Arquivo | Papel | Regras |
|---|---|---|
| `pricing/api/checkout.ts` | `POST /checkout` → URL Stripe; mapeia plano→event (refill=`discount`). | BR-MIGRAR-029 |
| `pricing/model/checkoutFlow.ts` | **AD-04**: abre Stripe externo + RACE deep link × polling /user (5s/2min). | BR-MIGRAR-029, RISK-006 |
| `profile/api/user.ts` | refetch `POST /user` (hidrata cap/subscription após checkout). | R-PAY-4 |
| `profile/model/customerPortal.ts` | abre Customer Portal via `shell.openExternal`. | BR-MIGRAR-029 |
| catálogo + gating | `models/products.ts` (Tarefa 04): $8/$12/**$4.50** + `canPurchaseRefill`/`isCurrentPlan`. | BR-MIGRAR-026/027/028, DEC-011 |

## Preservados literalmente (sem refactor)

- **Privacy dialog** (DEC-008 / BR-HUMANA-002): porta 1:1 — inputs `disabled`/`readOnly`,
  `user.privacy` fetched-mas-não-wired. UI legada mantida; nenhuma mudança visual.
- **Subscription string free-form** (BR-MIGRAR-031): só `'member'` é especial; sem enum.

## Header token delta overlay (BR-MIGRAR-030)

O cálculo do delta `+N/-N` é `capDelta` em `models/user.tsx` (Tarefa 04). A animação
(500ms + 2000ms hold + histórico de 5) vive no `widgets/header` legado (preservado);
ele consome `user.cap.changed`/`capDelta`.

## Integração (na montagem do App / adoção pelos modais)

```ts
const { cancel } = await startCheckout({
  plan, email, userId, token,
  pollUser: () => pollUserSnapshot(token),
  onResolved: (r) => { if (r.outcome === 'success') refetchUser(token).then(applyToUser); },
});
```
Customer Portal: `openCustomerPortal()`. Ambos abrem no browser externo no desktop.
