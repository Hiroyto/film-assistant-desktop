// Testes do seam de auth (parity specs 02/09). Mocka só as bordas ESM/rede
// (aws-amplify/auth, axios, react-hot-toast) e exercita a lógica REAL de
// getFreshToken/forceRefreshToken + os hooks do seam sobre uma sessão virtual.
import axios from 'axios';

jest.mock('axios');
jest.mock('react-hot-toast', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
// cognito.ts importa aws-amplify/auth (ESM, não transformável sob jest) — stub das
// bordas. As funções nunca são chamadas: os testes injetam um reader virtual.
jest.mock('aws-amplify/auth', () => ({
  signIn: jest.fn(),
  signUp: jest.fn(),
  confirmSignUp: jest.fn(),
  signOut: jest.fn(),
  resendSignUpCode: jest.fn(),
  fetchAuthSession: jest.fn(),
  fetchUserAttributes: jest.fn(),
  fetchMFAPreference: jest.fn(),
}));

import {
  getFreshToken,
  forceRefreshToken,
  setAuthSessionReaderForTest,
  type AuthSessionLike,
} from '../api/cognito';
import { getRegisteredHooks } from '../../../test-bridge/registry';
import { armAuthTestSeam, resetAuthTestSeam } from './authTestSeam';

const mockedAxios = axios as jest.Mocked<typeof axios>;
const nowSec = () => Math.floor(Date.now() / 1000);
const session = (exp: number, tok: string): AuthSessionLike => ({
  tokens: { idToken: { payload: { exp }, toString: () => tok } },
});

describe('cognito session reader (getFreshToken JIT — AD-03)', () => {
  afterEach(() => setAuthSessionReaderForTest(null));

  it('faz refresh quando o token expira dentro da janela de 5min', async () => {
    let forced = 0;
    setAuthSessionReaderForTest(async (opts) => {
      if (opts?.forceRefresh) {
        forced++;
        return session(nowSec() + 3600, 'fresh');
      }
      return session(nowSec() + 120, 'old'); // 2min < 5min
    });
    const t = await getFreshToken();
    expect(forced).toBe(1);
    expect(t).toBe('fresh');
  });

  it('não faz refresh quando o token está longe de expirar', async () => {
    let forced = 0;
    setAuthSessionReaderForTest(async (opts) => {
      if (opts?.forceRefresh) forced++;
      return session(nowSec() + 3600, 'old');
    });
    const t = await getFreshToken();
    expect(forced).toBe(0);
    expect(t).toBe('old');
  });

  it('forceRefreshToken sempre pede uma sessão nova', async () => {
    let forced = 0;
    setAuthSessionReaderForTest(async (opts) => {
      if (opts?.forceRefresh) forced++;
      return session(nowSec() + 3600, 'forced');
    });
    expect(await forceRefreshToken()).toBe('forced');
    expect(forced).toBe(1);
  });
});

describe('authTestSeam hooks (window.__TEST__ — specs 02/09)', () => {
  beforeEach(() => {
    (window as any).__TEST_SHELL__ = {}; // isTestMode() = true
    mockedAxios.post.mockResolvedValue({ data: { ok: true } } as any);
    armAuthTestSeam();
  });
  afterEach(() => {
    delete (window as any).__TEST_SHELL__;
    resetAuthTestSeam();
    setAuthSessionReaderForTest(null);
    jest.clearAllMocks();
  });

  it('callSafeApi devolve o resultado do safeApiCall (success)', async () => {
    const hooks = getRegisteredHooks();
    const res = await hooks.callSafeApi('works');
    expect(res.success).toBe(true);
  });

  it('JIT dispara quando setTokenExpiry < janela (4min)', async () => {
    const hooks = getRegisteredHooks();
    hooks.setTokenExpiry(4 * 60);
    await hooks.callSafeApi('user');
    expect(hooks.jitRefreshHappened()).toBe(true);
  });

  it('sem JIT quando o token está longe de expirar', async () => {
    const hooks = getRegisteredHooks();
    hooks.setTokenExpiry(3600);
    await hooks.callSafeApi('user');
    expect(hooks.jitRefreshHappened()).toBe(false);
  });

  it('lastTokenRefreshed fica truthy após um forceRefreshToken (OS resumed)', async () => {
    const hooks = getRegisteredHooks();
    expect(hooks.lastTokenRefreshed()).toBeNull();
    await forceRefreshToken(); // o seam injetou seu reader virtual
    expect(hooks.lastTokenRefreshed()).toBeTruthy();
  });
});
