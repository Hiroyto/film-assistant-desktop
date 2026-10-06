// Integração com o Amplify REAL (sem rede): o fluxo desktop entrega os tokens ao
// TokenOrchestrator e publica os eventos do Hub que o Authenticator ouve.
import { webcrypto } from 'crypto';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { Hub, sharedInMemoryStorage } from 'aws-amplify/utils';
import { AMPLIFY_SYMBOL } from '@aws-amplify/core/internals/utils';
import { base64UrlEncode, loadPendingOAuth, PENDING_OAUTH_KEY } from './model/googleOAuth';
import {
  LINK_RETRY_MESSAGE,
  WEB_LINK_RETRY_KEY,
  beginGoogleSignInDesktop,
  completeGoogleSignInFromDeepLink,
  getGoogleSignInStatus,
  installGoogleSignInWebRetry,
} from './model/googleSignIn';

const cryptoImpl = webcrypto as unknown as Crypto;
const settings = { domain: 'app.auth.us-east-1.amazoncognito.com', clientId: 'client-test' };

const jwt = (payload: Record<string, unknown>) => {
  const enc = (o: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));
  return `${enc({ alg: 'RS256', kid: 'k' })}.${enc(payload)}.signature`;
};

function cognitoTokens(username = 'google_1029384756') {
  const now = Math.floor(Date.now() / 1000);
  const sub = '11111111-2222-3333-4444-555555555555';
  return {
    access_token: jwt({ sub, username, token_use: 'access', iat: now, exp: now + 3600, scope: 'openid email profile aws.cognito.signin.user.admin' }),
    id_token: jwt({ sub, 'cognito:username': username, email: 'ana@example.com', token_use: 'id', iat: now, exp: now + 3600 }),
    refresh_token: 'refresh-opaque',
    expires_in: 3600,
    token_type: 'Bearer',
  };
}

beforeAll(() => {
  Amplify.configure({ Auth: { Cognito: { userPoolId: 'us-east-1_TEST1234', userPoolClientId: settings.clientId } } });
  cognitoUserPoolsTokenProvider.setKeyValueStorage(sharedInMemoryStorage);
});

beforeEach(() => {
  window.localStorage.removeItem(PENDING_OAUTH_KEY);
});

const callback = (query: Record<string, string>) => ({ scheme: 'filmassistant', host: 'auth', path: '/callback', query });

describe('Continue with Google (desktop) — ponta a ponta sem rede', () => {
  it('abre o Hosted UI, recebe o deep link, troca o code e deixa o Amplify autenticado', async () => {
    const opened: string[] = [];
    const url = await beginGoogleSignInDesktop({ settings, cryptoImpl, open: async (u) => { opened.push(u); } });
    expect(opened).toEqual([url]);
    expect(getGoogleSignInStatus().phase).toBe('waiting-browser');

    const pending = loadPendingOAuth(window.localStorage);
    expect(pending).not.toBeNull();
    const state = new URL(url).searchParams.get('state')!;
    expect(pending!.state).toBe(state);

    const events: string[] = [];
    const stop = Hub.listen('auth', ({ payload }) => { events.push(payload.event); });

    let exchangeBody = '';
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      exchangeBody = String(init.body);
      return { ok: true, status: 200, json: async () => cognitoTokens() } as Response;
    }) as unknown as typeof fetch;

    const handled = await completeGoogleSignInFromDeepLink(callback({ code: 'c0de', state }), { settings, fetchImpl });
    stop();

    expect(handled).toBe(true);
    const body = new URLSearchParams(exchangeBody);
    expect(body.get('code')).toBe('c0de');
    expect(body.get('code_verifier')).toBe(pending!.codeVerifier);
    expect(body.get('redirect_uri')).toBe('filmassistant://auth/callback');

    // O Amplify passa a responder como autenticado, sem nenhuma chamada de rede.
    const session = await fetchAuthSession();
    expect(session.tokens?.idToken?.payload.email).toBe('ana@example.com');
    expect(session.tokens?.idToken?.payload['cognito:username']).toBe('google_1029384756');
    const user = await getCurrentUser();
    expect(user.username).toBe('google_1029384756');

    // Mesma sequência do completeOAuthFlow interno: o Authenticator ouve 'signedIn'.
    expect(events).toEqual(['signInWithRedirect', 'signedIn']);
    expect(getGoogleSignInStatus().phase).toBe('idle');
    expect(loadPendingOAuth(window.localStorage)).toBeNull();
  });

  it('ignora deep links que não são o callback de auth', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    const handled = await completeGoogleSignInFromDeepLink({ scheme: 'filmassistant', host: 'stripe', path: '/success', query: {} }, { settings, fetchImpl });
    expect(handled).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('state diferente do pedido: rejeita, não troca o code, limpa o pedido e publica a falha', async () => {
    await beginGoogleSignInDesktop({ settings, cryptoImpl, open: async () => {} });
    const events: string[] = [];
    const stop = Hub.listen('auth', ({ payload }) => { events.push(payload.event); });
    const fetchImpl = jest.fn() as unknown as typeof fetch;

    await expect(completeGoogleSignInFromDeepLink(callback({ code: 'c', state: 'forged' }), { settings, fetchImpl }))
      .rejects.toMatchObject({ code: 'state_mismatch' });
    stop();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(events).toEqual(['signInWithRedirect_failure']);
    expect(loadPendingOAuth(window.localStorage)).toBeNull();
    expect(getGoogleSignInStatus().phase).toBe('error');
  });

  it('erro devolvido pelo Cognito no callback vira OAuthFlowError com o código do serviço', async () => {
    await beginGoogleSignInDesktop({ settings, cryptoImpl, open: async () => {} });
    await expect(completeGoogleSignInFromDeepLink(callback({ error: 'access_denied', error_description: 'User denied' }), { settings }))
      .rejects.toMatchObject({ code: 'access_denied', message: 'User denied' });
  });

  it('sem domínio do Hosted UI, o fluxo nem abre o navegador', async () => {
    const open = jest.fn(async () => {});
    await expect(beginGoogleSignInDesktop({ settings: null, cryptoImpl, open })).rejects.toMatchObject({ code: 'not_configured' });
    expect(open).not.toHaveBeenCalled();
  });
});

const LINKED = { error: 'invalid_request', error_description: 'Already found an entry for username google_1029384756' };

describe('conta existente com o mesmo e-mail (vínculo no pre sign-up)', () => {
  it('desktop: refaz o fluxo UMA vez sozinho e entra na conta nativa vinculada', async () => {
    const opened: string[] = [];
    const open = async (u: string) => { opened.push(u); };
    const first = await beginGoogleSignInDesktop({ settings, cryptoImpl, open });
    const state1 = new URL(first).searchParams.get('state')!;

    // 1ª volta: o Cognito criou o vínculo e falhou esta tentativa.
    const fetchNever = jest.fn() as unknown as typeof fetch;
    const handled = await completeGoogleSignInFromDeepLink(callback({ ...LINKED, state: state1 }), { settings, cryptoImpl, open, fetchImpl: fetchNever });
    expect(handled).toBe(true);
    expect(fetchNever).not.toHaveBeenCalled();
    expect(opened).toHaveLength(2); // reabriu o navegador sem novo clique
    expect(getGoogleSignInStatus()).toEqual({ phase: 'waiting-browser', message: LINK_RETRY_MESSAGE });
    const pending = loadPendingOAuth(window.localStorage)!;
    const state2 = new URL(opened[1]).searchParams.get('state')!;
    expect(state2).not.toBe(state1);
    expect(pending.state).toBe(state2);
    expect(pending.linkRetry).toBe(true);

    // 2ª volta: agora o code resolve para a conta nativa (mesmo cognito:username de antes).
    const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => cognitoTokens('native-user-uuid') })) as unknown as typeof fetch;
    expect(await completeGoogleSignInFromDeepLink(callback({ code: 'c2', state: state2 }), { settings, fetchImpl })).toBe(true);
    expect((await getCurrentUser()).username).toBe('native-user-uuid');
    expect((await fetchAuthSession()).tokens?.idToken?.payload['cognito:username']).toBe('native-user-uuid');
    expect(getGoogleSignInStatus().phase).toBe('idle');
  });

  it('desktop: se a repetição falhar com o mesmo erro, para com mensagem acionável (sem laço)', async () => {
    const opened: string[] = [];
    const open = async (u: string) => { opened.push(u); };
    const first = await beginGoogleSignInDesktop({ settings, cryptoImpl, open });
    const state1 = new URL(first).searchParams.get('state')!;
    await completeGoogleSignInFromDeepLink(callback({ ...LINKED, state: state1 }), { settings, cryptoImpl, open });
    const state2 = new URL(opened[1]).searchParams.get('state')!;

    await expect(completeGoogleSignInFromDeepLink(callback({ ...LINKED, state: state2 }), { settings, cryptoImpl, open }))
      .rejects.toMatchObject({ code: 'account_link_retry_failed' });
    expect(opened).toHaveLength(2); // não abriu uma terceira vez
    expect(loadPendingOAuth(window.localStorage)).toBeNull();
    expect(getGoogleSignInStatus().phase).toBe('error');
  });

  it('desktop: não repete para um callback que não é do pedido em curso', async () => {
    const open = jest.fn(async () => {});
    await beginGoogleSignInDesktop({ settings, cryptoImpl, open });
    await expect(completeGoogleSignInFromDeepLink(callback({ ...LINKED, state: 'de-outro-pedido' }), { settings, cryptoImpl, open }))
      .rejects.toMatchObject({ code: 'account_link_retry_failed' });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('web: refaz o redirect uma vez pelo Hub e não entra em laço', async () => {
    window.sessionStorage.removeItem(WEB_LINK_RETRY_KEY);
    const redirect = jest.fn();
    const stop = installGoogleSignInWebRetry({ desktop: false, storage: window.sessionStorage, redirect });
    const fail = (message: string) =>
      Hub.dispatch('auth', { event: 'signInWithRedirect_failure', data: { error: new Error(message) } }, 'Auth', AMPLIFY_SYMBOL);

    fail('User denied');
    await Promise.resolve();
    expect(redirect).not.toHaveBeenCalled();

    fail('Already found an entry for username google_1');
    await Promise.resolve();
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(WEB_LINK_RETRY_KEY)).toBe('1');

    fail('Already found an entry for username google_1'); // a repetição também falhou
    await Promise.resolve();
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(WEB_LINK_RETRY_KEY)).toBeNull();
    stop();
  });

  it('web: no desktop o listener nem é instalado, e sem storage não repete', async () => {
    const redirect = jest.fn();
    const stopDesktop = installGoogleSignInWebRetry({ desktop: true, storage: window.sessionStorage, redirect });
    const stopNoStorage = installGoogleSignInWebRetry({ desktop: false, storage: null, redirect });
    Hub.dispatch('auth', { event: 'signInWithRedirect_failure', data: { error: new Error('Already found an entry for username google_1') } }, 'Auth', AMPLIFY_SYMBOL);
    await Promise.resolve();
    expect(redirect).not.toHaveBeenCalled();
    stopDesktop();
    stopNoStorage();
  });
});
