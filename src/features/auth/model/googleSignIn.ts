// features/auth/model/googleSignIn.ts — "Continue with Google" nos dois alvos.
//
//   web      → signInWithRedirect do Amplify (Hosted UI + redirect na mesma origem).
//   desktop  → fluxo PKCE próprio (googleOAuth.ts): abre o Hosted UI no navegador
//              do SISTEMA, recebe filmassistant://auth/callback?code=…&state=…
//              pelo deep link do shell, troca o code por tokens e os entrega ao
//              Amplify do MESMO jeito que o completeOAuthFlow interno faz:
//              tokenOrchestrator.setTokens(...) + Hub 'signInWithRedirect' + 'signedIn'.
//
// O Authenticator do ui-react vira `authenticated` ao ouvir 'signedIn'
// (AuthenticatorProvider.onSignIn), então os guards de rota do App reagem como
// no login por senha. O refresh posterior é o do próprio Amplify: o refresh
// token do Hosted UI é aceito pelo InitiateAuth REFRESH_TOKEN_AUTH do app client.
//
// Por que o navegador do sistema e não uma BrowserWindow: o Google bloqueia o
// OAuth em webviews embutidas ("disallowed_useragent").
//
// Sign-out: NÃO marcamos oauthSignIn no Amplify, então signOut() revoga e limpa
// localmente, sem tentar o /logout do Hosted UI (que em file:// não tem para
// onde voltar). A sessão Google no navegador do sistema permanece.

import { getCurrentUser, signInWithRedirect } from 'aws-amplify/auth';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { Hub } from 'aws-amplify/utils';
import { AMPLIFY_SYMBOL } from '@aws-amplify/core/internals/utils';
import awsmobile from '../../../aws-exports';
import { isDesktop, onDeepLink, openExternal } from '../../../lib/ipcClient';
import {
  DESKTOP_OAUTH_REDIRECT_URI,
  OAuthFlowError,
  type OAuthSettings,
  type OAuthTokenResponse,
  type PendingOAuth,
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
} from './googleOAuth';

// ---------------------------------------------------------------------------
// Configuração (aws-exports.js, vinda de REACT_APP_COGNITO_OAUTH_DOMAIN)
// ---------------------------------------------------------------------------

interface AwsExportsLike {
  oauth?: { domain?: string };
  aws_user_pools_web_client_id?: string;
}

export function getOAuthSettings(): OAuthSettings | null {
  const cfg = awsmobile as unknown as AwsExportsLike;
  const domain = normalizeDomain(cfg?.oauth?.domain);
  const clientId = cfg?.aws_user_pools_web_client_id ?? '';
  return domain && clientId ? { domain, clientId } : null;
}

/** False quando o build não tem domínio do Hosted UI: o botão não é renderizado. */
export function isGoogleSignInConfigured(): boolean {
  return getOAuthSettings() !== null;
}

// ---------------------------------------------------------------------------
// Status observável (o botão mostra "aguardando o navegador…" / erro)
// ---------------------------------------------------------------------------

export type GoogleSignInPhase = 'idle' | 'waiting-browser' | 'exchanging' | 'error';
export interface GoogleSignInStatus {
  phase: GoogleSignInPhase;
  message?: string;
}

/** Texto do botão enquanto o app refaz o fluxo depois de o Cognito vincular a conta. */
export const LINK_RETRY_MESSAGE = 'Linking Google to your existing account. Finish in the browser window we just opened.';

let status: GoogleSignInStatus = { phase: 'idle' };
const listeners = new Set<(s: GoogleSignInStatus) => void>();

function setStatus(next: GoogleSignInStatus): void {
  status = next;
  listeners.forEach((l) => l(next));
}

export function getGoogleSignInStatus(): GoogleSignInStatus {
  return status;
}

export function subscribeGoogleSignInStatus(cb: (s: GoogleSignInStatus) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ---------------------------------------------------------------------------
// Dependências injetáveis (testes rodam sem Electron, sem fetch global, sem
// WebCrypto do jsdom)
// ---------------------------------------------------------------------------

export interface GoogleSignInDeps {
  /** undefined = lê aws-exports; null = força "não configurado". */
  settings?: OAuthSettings | null;
  fetchImpl?: typeof fetch;
  cryptoImpl?: Crypto;
  /** undefined = window.localStorage; null = só memória. */
  storage?: Storage | null;
  open?: (url: string) => Promise<void>;
  now?: () => number;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function resolveDeps(d: GoogleSignInDeps) {
  return {
    settings: d.settings === undefined ? getOAuthSettings() : d.settings,
    fetchImpl: d.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined),
    cryptoImpl: d.cryptoImpl ?? (typeof crypto !== 'undefined' ? crypto : undefined),
    storage: d.storage === undefined ? safeLocalStorage() : d.storage,
    open: d.open ?? openExternal,
    now: d.now ?? Date.now,
  };
}

// Cópia em memória do pedido pendente, para ambientes sem localStorage.
let pendingInMemory: PendingOAuth | null = null;

function savePending(storage: Storage | null, p: PendingOAuth): void {
  pendingInMemory = p;
  if (storage) savePendingOAuth(storage, p);
}

function loadPending(storage: Storage | null, now: number): PendingOAuth | null {
  const fromStorage = storage ? loadPendingOAuth(storage, now) : null;
  return fromStorage ?? pendingInMemory;
}

function clearPending(storage: Storage | null): void {
  pendingInMemory = null;
  if (storage) clearPendingOAuth(storage);
}

// ---------------------------------------------------------------------------
// Entrada única para a UI
// ---------------------------------------------------------------------------

/** Clique em "Continue with Google". Web: redirect do Amplify. Desktop: abre o navegador. */
export async function signInWithGoogle(deps: GoogleSignInDeps = {}): Promise<void> {
  if (isDesktop()) {
    await beginGoogleSignInDesktop(deps);
    return;
  }
  await signInWithRedirect({ provider: 'Google' });
}

/** Desktop: gera PKCE + state, guarda o pedido e abre o Hosted UI no navegador do OS.
 *  A conclusão chega pelo deep link (installGoogleSignInDeepLink). Devolve a URL aberta. */
export async function beginGoogleSignInDesktop(
  deps: GoogleSignInDeps = {},
  opts: { linkRetry?: boolean } = {},
): Promise<string> {
  const { settings, cryptoImpl, storage, open, now } = resolveDeps(deps);
  if (!settings) {
    throw new OAuthFlowError('not_configured', 'Google sign-in is not configured for this build (REACT_APP_COGNITO_OAUTH_DOMAIN).');
  }
  if (!cryptoImpl?.subtle) {
    throw new OAuthFlowError('no_crypto', 'WebCrypto is not available in this environment.');
  }
  const codeVerifier = generateCodeVerifier(cryptoImpl);
  const state = generateState(cryptoImpl);
  const codeChallenge = await codeChallengeS256(codeVerifier, cryptoImpl);
  savePending(storage, {
    state,
    codeVerifier,
    redirectUri: DESKTOP_OAUTH_REDIRECT_URI,
    startedAt: now(),
    ...(opts.linkRetry ? { linkRetry: true } : {}),
  });
  const url = buildAuthorizeUrl({ settings, redirectUri: DESKTOP_OAUTH_REDIRECT_URI, state, codeChallenge });
  setStatus(opts.linkRetry ? { phase: 'waiting-browser', message: LINK_RETRY_MESSAGE } : { phase: 'waiting-browser' });
  try {
    await open(url);
  } catch (err) {
    clearPending(storage);
    setStatus({ phase: 'error', message: 'Could not open your browser.' });
    throw err;
  }
  return url;
}

/** Usuário desistiu enquanto o navegador estava aberto: descarta o pedido. */
export function cancelGoogleSignInDesktop(deps: GoogleSignInDeps = {}): void {
  const { storage } = resolveDeps(deps);
  clearPending(storage);
  setStatus({ phase: 'idle' });
}

/**
 * Conclui o fluxo a partir do deep link. Devolve false (e não toca em nada)
 * quando o payload não é o callback de auth. Lança OAuthFlowError nas falhas,
 * depois de limpar o pedido pendente e publicar 'signInWithRedirect_failure'.
 */
export async function completeGoogleSignInFromDeepLink(
  payload: { scheme?: string; host: string; path: string; query: Record<string, string> },
  deps: GoogleSignInDeps = {},
): Promise<boolean> {
  const callback = parseAuthCallback(payload);
  if (!callback) return false;
  const { settings, fetchImpl, storage, now } = resolveDeps(deps);
  try {
    if (callback.kind === 'error' && isAccountLinkedRetryError(callback.description)) {
      // O trigger de pre sign-up acabou de vincular esta identidade Google a uma
      // conta existente. O Cognito falha ESTA tentativa; a próxima entra na conta
      // vinculada. Refaz o fluxo uma única vez, sem pedir novo clique — e só para
      // o pedido que nós mesmos abrimos (state confere) e que ainda não é repetição.
      const pending = loadPending(storage, now());
      if (pending && (!callback.state || callback.state === pending.state) && !pending.linkRetry) {
        await beginGoogleSignInDesktop(deps, { linkRetry: true });
        return true;
      }
      throw new OAuthFlowError(
        'account_link_retry_failed',
        'Google was linked to your existing account. Please click "Continue with Google" once more.',
      );
    }
    if (callback.kind === 'error') throw new OAuthFlowError(callback.error, callback.description ?? callback.error);
    if (callback.kind === 'cancelled') throw new OAuthFlowError('cancelled', 'Sign-in was cancelled in the browser.');
    const pending = loadPending(storage, now());
    if (!pending) throw new OAuthFlowError('no_pending', 'No sign-in in progress (it may have expired). Please try again.');
    if (pending.state !== callback.state) throw new OAuthFlowError('state_mismatch', 'The sign-in response did not match the request.');
    if (!settings) throw new OAuthFlowError('not_configured', 'Google sign-in is not configured for this build.');
    if (!fetchImpl) throw new OAuthFlowError('no_fetch', 'fetch is not available in this environment.');

    setStatus({ phase: 'exchanging' });
    const tokens = await exchangeCodeForTokens({
      settings,
      redirectUri: pending.redirectUri,
      code: callback.code,
      codeVerifier: pending.codeVerifier,
      fetchImpl,
    });
    await cacheOAuthTokensInAmplify(tokens);
    clearPending(storage);
    await announceSignedIn();
    setStatus({ phase: 'idle' });
    return true;
  } catch (err) {
    clearPending(storage);
    const message = err instanceof Error ? err.message : String(err);
    setStatus({ phase: 'error', message });
    Hub.dispatch('auth', { event: 'signInWithRedirect_failure', data: { error: err } }, 'Auth', AMPLIFY_SYMBOL);
    throw err;
  }
}

/**
 * Entrega os tokens do /oauth2/token ao Amplify. Espelha o cacheCognitoTokens
 * interno (clockDrift pelo iat do access token, username do access token) e
 * usa o setTokens público do TokenOrchestrator — o mesmo caminho que o
 * signInWithRedirect do Amplify percorre ao concluir o code flow.
 */
export async function cacheOAuthTokensInAmplify(t: OAuthTokenResponse): Promise<void> {
  const accessPayload = decodeJwtPayload<{ iat?: number; username?: string }>(t.access_token);
  const idPayload = decodeJwtPayload<{ 'cognito:username'?: string }>(t.id_token);
  const issuedAtMs = (accessPayload.iat ?? 0) * 1000;
  const clockDrift = issuedAtMs > 0 ? issuedAtMs - Date.now() : 0;
  const username = accessPayload.username ?? idPayload['cognito:username'] ?? 'username';
  const tokens = {
    accessToken: { payload: accessPayload, toString: () => t.access_token },
    idToken: { payload: idPayload, toString: () => t.id_token },
    refreshToken: t.refresh_token,
    clockDrift,
    username,
  };
  // O tipo CognitoAuthTokens não é exportado pelo pacote; o shape acima é o que
  // cacheCognitoTokens monta (ver node_modules/@aws-amplify/auth/.../cacheTokens.mjs).
  await cognitoUserPoolsTokenProvider.tokenOrchestrator.setTokens({ tokens: tokens as never });
}

/** Mesma sequência de eventos do completeOAuthFlow do Amplify. */
export async function announceSignedIn(): Promise<void> {
  Hub.dispatch('auth', { event: 'signInWithRedirect' }, 'Auth', AMPLIFY_SYMBOL);
  Hub.dispatch('auth', { event: 'signedIn', data: await getCurrentUser() }, 'Auth', AMPLIFY_SYMBOL);
}

/** Liga o callback ao deep link do shell. No-op na web (onDeepLink devolve unsubscribe vazio). */
export function installGoogleSignInDeepLink(deps: GoogleSignInDeps = {}): () => void {
  return onDeepLink((payload) => {
    void completeGoogleSignInFromDeepLink(payload, deps).catch((err) => {
      console.warn('[auth] Google sign-in callback failed:', err);
    });
  });
}

// ---------------------------------------------------------------------------
// Web: a mesma repetição pós-vínculo. Lá o Amplify conclui o redirect sozinho e
// publica 'signInWithRedirect_failure' com a mensagem do Cognito; refazemos o
// signInWithRedirect uma vez. A marca fica em sessionStorage, que atravessa o
// redirect na mesma aba; sem storage não há como evitar laço, então não repete.
// ---------------------------------------------------------------------------

export const WEB_LINK_RETRY_KEY = 'fa.auth.google.linkRetry';

function safeSessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function installGoogleSignInWebRetry(
  deps: { desktop?: boolean; storage?: Storage | null; redirect?: () => Promise<void> | void } = {},
): () => void {
  if (deps.desktop ?? isDesktop()) return () => {};
  const storage = deps.storage === undefined ? safeSessionStorage() : deps.storage;
  const redirect = deps.redirect ?? (() => signInWithRedirect({ provider: 'Google' }));
  const read = () => { try { return storage?.getItem(WEB_LINK_RETRY_KEY) === '1'; } catch { return false; } };
  const write = (on: boolean) => {
    try {
      if (on) storage?.setItem(WEB_LINK_RETRY_KEY, '1');
      else storage?.removeItem(WEB_LINK_RETRY_KEY);
    } catch {
      /* ignore */
    }
  };
  return Hub.listen('auth', ({ payload }) => {
    const p = payload as { event: string; data?: { error?: { message?: string } } };
    if (p.event === 'signedIn') {
      write(false);
      return;
    }
    if (p.event !== 'signInWithRedirect_failure' || !isAccountLinkedRetryError(p.data?.error?.message)) return;
    if (!storage || read()) {
      write(false); // já repetiu uma vez (ou não dá para marcar): deixa o erro aparecer
      return;
    }
    write(true);
    void Promise.resolve()
      .then(() => redirect())
      .catch((err) => console.warn('[auth] Google sign-in retry failed:', err));
  });
}
