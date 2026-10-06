// features/auth/model/googleOAuth.ts — primitivas do fluxo authorization-code +
// PKCE contra o Hosted UI do Cognito, usadas pelo "Continue with Google" do
// desktop. SEM imports do Amplify: tudo aqui é puro e testável em unidade. A
// ponta Amplify (injeção dos tokens, eventos do Hub) vive em googleSignIn.ts.
//
// Por que um fluxo próprio no desktop: o renderer roda em file:// e o
// signInWithRedirect do Amplify só sabe concluir o OAuth lendo window.location
// de volta na própria origem. Aqui o navegador do SISTEMA faz o login e o
// Cognito devolve o code por deep link (filmassistant://auth/callback); o app
// troca o code por tokens no /oauth2/token e os entrega ao Amplify.

export const GOOGLE_IDENTITY_PROVIDER = 'Google';

/** `aws.cognito.signin.user.admin` é obrigatório: fetchUserAttributes/GetUser
 *  exigem esse escopo no access token emitido pelo Hosted UI. */
export const OAUTH_SCOPES = ['openid', 'email', 'profile', 'aws.cognito.signin.user.admin'] as const;

/** Redirect do desktop — precisa estar na lista de callback URLs do app client. */
export const DESKTOP_OAUTH_REDIRECT_URI = 'filmassistant://auth/callback';
export const AUTH_DEEP_LINK_HOST = 'auth';
export const AUTH_DEEP_LINK_CALLBACK_PATH = '/callback';

/** Chave do pedido pendente (state + verifier) enquanto o navegador está aberto.
 *  localStorage, não sessionStorage: um deep link em cold start abre OUTRA
 *  instância do renderer e precisa reencontrar o verifier. */
export const PENDING_OAUTH_KEY = 'fa.auth.google.pending';
export const PENDING_OAUTH_TTL_MS = 10 * 60_000;

// RFC 7636 §4.1: 43–128 chars de [A-Za-z0-9-._~]; o Amplify usa só alfanuméricos.
const VERIFIER_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const CODE_VERIFIER_LENGTH = 128;
export const STATE_LENGTH = 32;

export class OAuthFlowError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'OAuthFlowError';
  }
}

export interface OAuthSettings {
  /** Domínio do Hosted UI, sem protocolo (ex.: app.auth.us-east-1.amazoncognito.com). */
  domain: string;
  clientId: string;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecodeToString(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Payload de um JWT SEM validar assinatura (os tokens vêm direto do Cognito por TLS). */
export function decodeJwtPayload<T extends Record<string, unknown> = Record<string, unknown>>(token: string): T {
  const parts = token.split('.');
  if (parts.length < 2) throw new OAuthFlowError('invalid_token', 'Token is not a JWT.');
  return JSON.parse(base64UrlDecodeToString(parts[1])) as T;
}

// ---------------------------------------------------------------------------
// PKCE + state
// ---------------------------------------------------------------------------

function randomString(cryptoImpl: Crypto, length: number): string {
  const bytes = new Uint8Array(length);
  cryptoImpl.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += VERIFIER_CHARSET.charAt(bytes[i] % VERIFIER_CHARSET.length);
  return out;
}

export function generateCodeVerifier(cryptoImpl: Crypto, length = CODE_VERIFIER_LENGTH): string {
  if (length < 43 || length > 128) throw new OAuthFlowError('bad_verifier_length', 'PKCE verifier must be 43–128 chars.');
  return randomString(cryptoImpl, length);
}

export function generateState(cryptoImpl: Crypto, length = STATE_LENGTH): string {
  return randomString(cryptoImpl, length);
}

/** code_challenge = BASE64URL(SHA-256(code_verifier)) — RFC 7636 §4.2. */
export async function codeChallengeS256(codeVerifier: string, cryptoImpl: Crypto): Promise<string> {
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return base64UrlEncode(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/** Aceita o domínio com ou sem https:// e barra final; devolve só o host. */
export function normalizeDomain(raw: string | undefined | null): string {
  return (raw ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export function buildAuthorizeUrl(p: {
  settings: OAuthSettings;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  identityProvider?: string;
  scopes?: readonly string[];
}): string {
  const query = formEncode({
    response_type: 'code',
    client_id: p.settings.clientId,
    redirect_uri: p.redirectUri,
    identity_provider: p.identityProvider ?? GOOGLE_IDENTITY_PROVIDER,
    scope: (p.scopes ?? OAUTH_SCOPES).join(' '),
    code_challenge_method: 'S256',
    code_challenge: p.codeChallenge,
    state: p.state,
  });
  return `https://${normalizeDomain(p.settings.domain)}/oauth2/authorize?${query}`;
}

export function tokenEndpoint(settings: OAuthSettings): string {
  return `https://${normalizeDomain(settings.domain)}/oauth2/token`;
}

// ---------------------------------------------------------------------------
// Callback (deep link) → code
// ---------------------------------------------------------------------------

export interface AuthCallbackPayload {
  host: string;
  path: string;
  query: Record<string, string>;
}

export type AuthCallback =
  | { kind: 'code'; code: string; state: string }
  | { kind: 'error'; error: string; description?: string; state?: string }
  | { kind: 'cancelled' };

/** null quando o deep link não é o callback de auth (ex.: filmassistant://stripe/...). */
export function parseAuthCallback(payload: AuthCallbackPayload): AuthCallback | null {
  if (payload.host !== AUTH_DEEP_LINK_HOST) return null;
  const path = payload.path.replace(/\/+$/, '') || '/';
  if (path !== AUTH_DEEP_LINK_CALLBACK_PATH) return null;
  const q = payload.query ?? {};
  if (q.error) return { kind: 'error', error: q.error, description: q.error_description, state: q.state };
  if (q.code && q.state) return { kind: 'code', code: q.code, state: q.state };
  return { kind: 'cancelled' };
}

/**
 * O Cognito devolve este erro no PRIMEIRO login federado em que o trigger de pre
 * sign-up vinculou a identidade a uma conta já existente (AdminLinkProviderForUser,
 * backend/cognito-pre-signup-link): o vínculo foi criado, mas a tentativa em curso
 * falha com "Already found an entry for username google_…". É uma limitação
 * conhecida do serviço; refazer o fluxo uma vez entra na conta vinculada.
 */
export function isAccountLinkedRetryError(description?: string | null): boolean {
  return /already found an entry for username/i.test(description ?? '');
}

// ---------------------------------------------------------------------------
// code → tokens
// ---------------------------------------------------------------------------

export interface OAuthTokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export async function exchangeCodeForTokens(p: {
  settings: OAuthSettings;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  fetchImpl: typeof fetch;
}): Promise<OAuthTokenResponse> {
  const body = formEncode({
    grant_type: 'authorization_code',
    client_id: p.settings.clientId,
    code: p.code,
    redirect_uri: p.redirectUri,
    code_verifier: p.codeVerifier,
  });
  let res: Response;
  try {
    res = await p.fetchImpl(tokenEndpoint(p.settings), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (err) {
    throw new OAuthFlowError('network', `Could not reach the sign-in service: ${(err as Error)?.message ?? err}`);
  }
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* corpo vazio/inválido cai nos checks abaixo */
  }
  if (json.error) {
    throw new OAuthFlowError(String(json.error), String(json.error_description ?? json.error));
  }
  if (!res.ok || typeof json.access_token !== 'string' || typeof json.id_token !== 'string') {
    throw new OAuthFlowError('bad_token_response', `Token endpoint returned ${res.status} without tokens.`);
  }
  return {
    access_token: json.access_token,
    id_token: json.id_token,
    refresh_token: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
    expires_in: typeof json.expires_in === 'number' ? json.expires_in : undefined,
    token_type: typeof json.token_type === 'string' ? json.token_type : undefined,
  };
}

// ---------------------------------------------------------------------------
// Pedido pendente (entre abrir o navegador e receber o deep link)
// ---------------------------------------------------------------------------

export interface PendingOAuth {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  startedAt: number;
  /** true quando este pedido JÁ é a repetição automática pós-vínculo de conta:
   *  um segundo erro igual não dispara outra repetição (sem laço). */
  linkRetry?: boolean;
}

export function savePendingOAuth(storage: Storage, pending: PendingOAuth): void {
  try {
    storage.setItem(PENDING_OAUTH_KEY, JSON.stringify(pending));
  } catch {
    /* storage indisponível: o chamador mantém cópia em memória */
  }
}

export function loadPendingOAuth(storage: Storage, now = Date.now(), ttlMs = PENDING_OAUTH_TTL_MS): PendingOAuth | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(PENDING_OAUTH_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<PendingOAuth>;
    if (!p || typeof p.state !== 'string' || typeof p.codeVerifier !== 'string' || typeof p.redirectUri !== 'string' || typeof p.startedAt !== 'number') {
      clearPendingOAuth(storage);
      return null;
    }
    if (now - p.startedAt > ttlMs) {
      clearPendingOAuth(storage);
      return null;
    }
    return p as PendingOAuth;
  } catch {
    clearPendingOAuth(storage);
    return null;
  }
}

export function clearPendingOAuth(storage: Storage): void {
  try {
    storage.removeItem(PENDING_OAUTH_KEY);
  } catch {
    /* ignore */
  }
}
