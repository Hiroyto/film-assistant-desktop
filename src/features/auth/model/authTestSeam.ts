// Seam de teste de auth (parity specs 02 e 09 — token refresh OS-aware AD-03 /
// save-on-sign-out BR-MIGRAR-008). Expõe os hooks que os specs chamam via
// window.__TEST__: callSafeApi, setTokenExpiry, jitRefreshHappened, lastTokenRefreshed.
//
// Fidelidade: NÃO reimplementa a decisão de refresh. Injeta uma SESSÃO VIRTUAL em
// cognito.ts (setAuthSessionReaderForTest) e deixa o getFreshToken/forceRefreshToken
// de PRODUÇÃO rodarem sobre ela. A expiração do token é controlável pelo spec
// (setTokenExpiry); um refresh observado pela sessão virtual marca as flags.
// INERTE fora do modo teste: armAuthTestSeam() faz early-return e nada é injetado.
import { registerTestHook, isTestMode } from '../../../test-bridge/registry';
import {
  setAuthSessionReaderForTest,
  getFreshToken,
  type AuthSessionLike,
} from '../api/cognito';
import { startSession } from './session';
import { configureApi, safeApiCall } from '../../../models/apiHelpers';

const VIRTUAL_TOKEN = 'test-id-token';

// Expiração virtual do id token (epoch s). null = longe de expirar (sem JIT).
let expSec: number | null = null;
// Timestamp do último refresh forçado observado (lastTokenRefreshed — truthy = ok).
let lastRefreshAt = 0;
// Refresh observado durante o callSafeApi corrente (jitRefreshHappened).
let jitDuringCall = false;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function virtualSession(): AuthSessionLike {
  return {
    tokens: {
      idToken: {
        payload: { exp: expSec ?? nowSec() + 3600 },
        toString: () => VIRTUAL_TOKEN,
      },
    },
  };
}

/** Sessão virtual: um forceRefresh renova o token e marca as flags de teste. */
const testReader = async (opts?: { forceRefresh?: boolean }): Promise<AuthSessionLike> => {
  if (opts?.forceRefresh) {
    lastRefreshAt = Date.now();
    jitDuringCall = true;
    expSec = nowSec() + 3600; // token renovado fica longe de expirar
  }
  return virtualSession();
};

/** Estado reiniciável (teardown de teste unit). */
export function resetAuthTestSeam(): void {
  expSec = null;
  lastRefreshAt = 0;
  jitDuringCall = false;
}

/** Arma o seam e registra os hooks. No-op fora do modo teste. */
export function armAuthTestSeam(): void {
  if (!isTestMode()) return;
  resetAuthTestSeam();
  setAuthSessionReaderForTest(testReader);
  // Garante o provider JIT mesmo sem login prévio (App.startSession também o configura).
  configureApi({ getFreshToken });
  // Inicia o controlador de sessão REAL (session.ts) para que o listener OS `resumed`
  // → forceRefreshToken rode sobre a sessão virtual (spec 02: sleep+wake dispara refresh).
  // Sem login prévio o app de teste não o iniciaria; o seam o liga sem reimplementar nada.
  startSession();

  registerTestHook('setTokenExpiry', (s: number) => {
    expSec = nowSec() + s;
  });
  registerTestHook('callSafeApi', async (endpoint: string, data: unknown = {}) => {
    jitDuringCall = false;
    return safeApiCall(endpoint, data, VIRTUAL_TOKEN);
  });
  registerTestHook('jitRefreshHappened', () => jitDuringCall);
  registerTestHook('lastTokenRefreshed', () => lastRefreshAt || null);
}
