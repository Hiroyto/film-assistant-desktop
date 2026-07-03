# BC-01 — Identity & Session (`features/auth`)

Autenticação Cognito + sessão OS-aware. Topologia Op3: a **UI legada** (`components/Login/*Modal`,
`pages/auth/Login.tsx`) é **preservada**; esta feature provê o model/api que ela adota
incrementalmente (consolidação da camada redundante de Login é refactor de UI deferido).

## Construído na Tarefa 08

| Arquivo | Papel | Regras |
|---|---|---|
| `api/cognito.ts` | wrappers Amplify v6 + `getFreshToken` (JIT) / `forceRefreshToken` / `getMfaState`. | BR-MIGRAR-001/007 |
| `model/passwordPolicy.ts` | valida senha (agora enforça **lowercase** — fix do drift). | BR-MIGRAR-002 |
| `model/resendThrottle.ts` | cooldown 60s **persistido em SQLite** (sobrevive sleep). | BR-MIGRAR-005 |
| `model/useAuth.ts` | signIn/signUp(+Terms)/confirm-then-signin atômico/resend/**signOut com flush**/openTerms. | BR-MIGRAR-003/004/006/008 |
| `model/session.ts` | `startSession`: JIT (`configureApi`) + 20min + OS `resumed` + flush on `before-quit`/`beforeunload`. | AD-03, BR-MIGRAR-007/008 |
| `model/mfa.ts` | `getMfaConfigured` (dado populado, **sem UI** — dormente). | DEC-007 |
| `../../data/sync-agent/scheduler.ts` | `startSyncScheduler`: wira push/pull aos triggers boot/5min/resume/online/quit. | data_migration_plan |

## Pontos de integração no `App.tsx` (a fazer na montagem do App)

> Aditivos e de baixo risco; deferidos junto com a redução do `App.tsx` (Tarefa 10),
> para não perturbar o renderer web agora (Strangler Fig).

1. Em um `useEffect` pós-autenticação, chamar:
   ```ts
   const stop = startSession({ onToken: setToken, onResume: () => {/* pull */}, flush: flushAll });
   return stop; // substitui o setInterval(1_200_000) legado (linha ~420)
   ```
2. Trocar `handleSignOut` (linha ~1442) por `signOutWithFlush(flushAll)` + `navigate('/')`.
3. No desktop, após o primeiro login, `startSyncScheduler({ getToken, userId, getWorks })`
   (o `getWorks` vem da API de story-workspace — Tarefa 10).
4. Modais de Login adotam `validatePassword`, `resendCode`, `confirmAndSignIn`, `openTerms`.

`configureApi({ getFreshToken })` (chamado por `startSession`) faz o `safeApiCall`
(Tarefa 05) refrescar o token JIT e re-tentar em 401 — sem mudança nos call sites.
