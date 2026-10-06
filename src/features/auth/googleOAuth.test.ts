// Primitivas do fluxo PKCE do "Continue with Google" (desktop). Puras: sem Amplify.
import { webcrypto } from 'crypto';
import {
  CODE_VERIFIER_LENGTH,
  DESKTOP_OAUTH_REDIRECT_URI,
  OAUTH_SCOPES,
  OAuthFlowError,
  PENDING_OAUTH_KEY,
  PENDING_OAUTH_TTL_MS,
  STATE_LENGTH,
  base64UrlEncode,
  buildAuthorizeUrl,
  clearPendingOAuth,
  codeChallengeS256,
  decodeJwtPayload,
  exchangeCodeForTokens,
  generateCodeVerifier,
  generateState,
  isAccountLinkedRetryError,
  loadPendingOAuth,
  normalizeDomain,
  parseAuthCallback,
  savePendingOAuth,
} from './model/googleOAuth';

const cryptoImpl = webcrypto as unknown as Crypto;
const settings = { domain: 'https://app.auth.us-east-1.amazoncognito.com/', clientId: 'client-123' };

const fakeJwt = (payload: Record<string, unknown>) => {
  const enc = (o: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(payload)}.sig`;
};

describe('PKCE (RFC 7636)', () => {
  it('verifier tem 128 chars alfanuméricos; state tem 32', () => {
    const v = generateCodeVerifier(cryptoImpl);
    expect(v).toHaveLength(CODE_VERIFIER_LENGTH);
    expect(v).toMatch(/^[A-Za-z0-9]+$/);
    expect(generateState(cryptoImpl)).toHaveLength(STATE_LENGTH);
    expect(generateCodeVerifier(cryptoImpl)).not.toBe(v);
  });

  it('rejeita tamanho fora de 43–128', () => {
    expect(() => generateCodeVerifier(cryptoImpl, 20)).toThrow(OAuthFlowError);
  });

  it('code_challenge S256 bate com o vetor do RFC 7636 (Apêndice B)', async () => {
    const challenge = await codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', cryptoImpl);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('URL de autorização', () => {
  it('normaliza o domínio e carrega todos os parâmetros do code flow com Google', () => {
    expect(normalizeDomain(' https://x.auth.us-east-1.amazoncognito.com// ')).toBe('x.auth.us-east-1.amazoncognito.com');
    const url = new URL(buildAuthorizeUrl({ settings, redirectUri: DESKTOP_OAUTH_REDIRECT_URI, state: 'st4te', codeChallenge: 'ch4ll' }));
    expect(url.origin + url.pathname).toBe('https://app.auth.us-east-1.amazoncognito.com/oauth2/authorize');
    const q = url.searchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe('client-123');
    expect(q.get('redirect_uri')).toBe('filmassistant://auth/callback');
    expect(q.get('identity_provider')).toBe('Google');
    expect(q.get('scope')).toBe(OAUTH_SCOPES.join(' '));
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toBe('ch4ll');
    expect(q.get('state')).toBe('st4te');
  });

  it('o escopo inclui aws.cognito.signin.user.admin (fetchUserAttributes depende dele)', () => {
    expect(OAUTH_SCOPES).toContain('aws.cognito.signin.user.admin');
  });
});

describe('parseAuthCallback (deep link)', () => {
  it('ignora deep links de outros hosts/paths', () => {
    expect(parseAuthCallback({ host: 'stripe', path: '/success', query: { code: 'x', state: 'y' } })).toBeNull();
    expect(parseAuthCallback({ host: 'auth', path: '/other', query: {} })).toBeNull();
  });
  it('reconhece code+state, erro e cancelamento', () => {
    expect(parseAuthCallback({ host: 'auth', path: '/callback', query: { code: 'c', state: 's' } })).toEqual({ kind: 'code', code: 'c', state: 's' });
    expect(parseAuthCallback({ host: 'auth', path: '/callback/', query: { error: 'access_denied', error_description: 'nope' } })).toEqual({ kind: 'error', error: 'access_denied', description: 'nope' });
    expect(parseAuthCallback({ host: 'auth', path: '/callback', query: {} })).toEqual({ kind: 'cancelled' });
  });
});

describe('exchangeCodeForTokens', () => {
  it('faz POST form-urlencoded no /oauth2/token com code_verifier e devolve os tokens', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ access_token: 'A', id_token: 'I', refresh_token: 'R', expires_in: 3600, token_type: 'Bearer' }) } as Response;
    }) as unknown as typeof fetch;

    const out = await exchangeCodeForTokens({ settings, redirectUri: DESKTOP_OAUTH_REDIRECT_URI, code: 'the code', codeVerifier: 'ver', fetchImpl });

    expect(out).toEqual({ access_token: 'A', id_token: 'I', refresh_token: 'R', expires_in: 3600, token_type: 'Bearer' });
    expect(calls[0].url).toBe('https://app.auth.us-east-1.amazoncognito.com/oauth2/token');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(String(calls[0].init.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_id')).toBe('client-123');
    expect(body.get('code')).toBe('the code');
    expect(body.get('redirect_uri')).toBe('filmassistant://auth/callback');
    expect(body.get('code_verifier')).toBe('ver');
  });

  it('propaga o erro do Cognito como OAuthFlowError com o código do serviço', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'expired' }) })) as unknown as typeof fetch;
    await expect(exchangeCodeForTokens({ settings, redirectUri: 'r', code: 'c', codeVerifier: 'v', fetchImpl }))
      .rejects.toMatchObject({ name: 'OAuthFlowError', code: 'invalid_grant', message: 'expired' });
  });

  it('falha de rede e resposta sem tokens viram erros tipados', async () => {
    const offline = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    await expect(exchangeCodeForTokens({ settings, redirectUri: 'r', code: 'c', codeVerifier: 'v', fetchImpl: offline }))
      .rejects.toMatchObject({ code: 'network' });
    const empty = (async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(exchangeCodeForTokens({ settings, redirectUri: 'r', code: 'c', codeVerifier: 'v', fetchImpl: empty }))
      .rejects.toMatchObject({ code: 'bad_token_response' });
  });
});

describe('pedido pendente (state + verifier)', () => {
  const storage = window.localStorage;
  beforeEach(() => clearPendingOAuth(storage));

  it('salva, lê de volta e limpa', () => {
    const p = { state: 's', codeVerifier: 'v', redirectUri: DESKTOP_OAUTH_REDIRECT_URI, startedAt: 1_000 };
    savePendingOAuth(storage, p);
    expect(loadPendingOAuth(storage, 2_000)).toEqual(p);
    clearPendingOAuth(storage);
    expect(loadPendingOAuth(storage, 2_000)).toBeNull();
  });

  it('expira após o TTL e descarta JSON inválido', () => {
    savePendingOAuth(storage, { state: 's', codeVerifier: 'v', redirectUri: 'r', startedAt: 0 });
    expect(loadPendingOAuth(storage, PENDING_OAUTH_TTL_MS + 1)).toBeNull();
    expect(storage.getItem(PENDING_OAUTH_KEY)).toBeNull();
    storage.setItem(PENDING_OAUTH_KEY, '{not json');
    expect(loadPendingOAuth(storage, 0)).toBeNull();
    expect(storage.getItem(PENDING_OAUTH_KEY)).toBeNull();
  });
});

describe('decodeJwtPayload', () => {
  it('decodifica base64url com unicode e rejeita não-JWT', () => {
    const token = fakeJwt({ 'cognito:username': 'google_123', name: 'Ana Júlia ✨' });
    expect(decodeJwtPayload(token)).toEqual({ 'cognito:username': 'google_123', name: 'Ana Júlia ✨' });
    expect(() => decodeJwtPayload('nope')).toThrow(OAuthFlowError);
  });
});

describe('erro de primeiro login pós-vínculo de conta', () => {
  it('reconhece a mensagem do Cognito em qualquer caixa e ignora as demais', () => {
    expect(isAccountLinkedRetryError('Already found an entry for username google_1029384756')).toBe(true);
    expect(isAccountLinkedRetryError('already found an entry for username Google_1')).toBe(true);
    expect(isAccountLinkedRetryError('User denied')).toBe(false);
    expect(isAccountLinkedRetryError(undefined)).toBe(false);
    expect(isAccountLinkedRetryError(null)).toBe(false);
  });

  it('o callback de erro carrega o state, para o app só repetir o pedido que ele mesmo abriu', () => {
    expect(parseAuthCallback({ host: 'auth', path: '/callback', query: { error: 'invalid_request', error_description: 'Already found an entry for username google_1', state: 'abc' } }))
      .toEqual({ kind: 'error', error: 'invalid_request', description: 'Already found an entry for username google_1', state: 'abc' });
  });
});
