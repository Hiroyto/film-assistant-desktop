// Cognito/Amplify v6 wrappers (BC-01). Single source das chamadas de auth.
// Preserva o uso legado de aws-amplify/auth; adiciona getFreshToken (JIT — AD-03).
import {
  signIn as amplifySignIn,
  signUp as amplifySignUp,
  confirmSignUp as amplifyConfirmSignUp,
  signOut as amplifySignOut,
  resendSignUpCode as amplifyResendCode,
  fetchAuthSession,
  fetchUserAttributes,
  fetchMFAPreference,
} from 'aws-amplify/auth';

/** Janela de refresh JIT: token a menos de 5 min de expirar é renovado (AD-03). */
export const JIT_REFRESH_WINDOW_SEC = 300;

// ---------------------------------------------------------------------------
// Fonte de sessão injetável (seam de teste — AD-03). Em produção lê o Cognito
// (fetchAuthSession). A suíte de paridade injeta uma sessão virtual via
// setAuthSessionReaderForTest para que getFreshToken/forceRefreshToken exercitem
// a MESMA lógica de JIT sobre uma expiração de token controlável, sem backend
// Cognito vivo. Inerte em produção (reader default = amplifyReader).
// ---------------------------------------------------------------------------
export interface IdTokenLike {
  payload: { exp?: number };
  toString(): string;
}
export interface AuthSessionLike {
  tokens?: { idToken?: IdTokenLike };
}
export type AuthSessionReader = (opts?: { forceRefresh?: boolean }) => Promise<AuthSessionLike>;

const amplifyReader: AuthSessionReader = async (opts) =>
  (await fetchAuthSession(opts)) as unknown as AuthSessionLike;

let sessionReader: AuthSessionReader = amplifyReader;

/** Substitui a fonte de sessão (parity test). `null` restaura o leitor do Cognito. */
export function setAuthSessionReaderForTest(reader: AuthSessionReader | null): void {
  sessionReader = reader ?? amplifyReader;
}

/** Retorna o id token atual como string, com refresh JIT se perto de expirar (AD-03). */
export async function getFreshToken(): Promise<string | null> {
  const session = await sessionReader();
  const idToken = session.tokens?.idToken;
  if (!idToken) return null;

  const exp = (idToken.payload as { exp?: number })?.exp;
  const nowSec = Date.now() / 1000;
  if (exp && exp - nowSec < JIT_REFRESH_WINDOW_SEC) {
    const refreshed = await sessionReader({ forceRefresh: true });
    return refreshed.tokens?.idToken?.toString() ?? null;
  }
  return idToken.toString();
}

/** Força refresh (usado no listener de OS resume — AD-03 / Implicação 5). */
export async function forceRefreshToken(): Promise<string | null> {
  const refreshed = await sessionReader({ forceRefresh: true });
  return refreshed.tokens?.idToken?.toString() ?? null;
}

export async function getUserAttributes(): Promise<Record<string, string | undefined>> {
  return fetchUserAttributes();
}

/** Estado MFA p/ T-04 (DEC-007 dormente). mfaConfiguration vem da config Cognito. */
export async function getMfaState(): Promise<{ mfaConfiguration: string | null; hasTotpEnrolled: boolean }> {
  try {
    const pref = await fetchMFAPreference();
    const hasTotpEnrolled = pref.enabled?.includes('TOTP') ?? false;
    return { mfaConfiguration: 'OPTIONAL', hasTotpEnrolled };
  } catch {
    return { mfaConfiguration: 'OPTIONAL', hasTotpEnrolled: false };
  }
}

export const signIn = amplifySignIn;
export const signUp = amplifySignUp;
export const confirmSignUp = amplifyConfirmSignUp;
export const signOut = amplifySignOut;
export const resendSignUpCode = amplifyResendCode;
