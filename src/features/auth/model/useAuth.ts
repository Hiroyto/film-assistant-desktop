// useAuth — orquestra as regras de auth (R-AUT) sobre o Cognito. Funções puras de
// orquestração (sem React) reaproveitáveis pelos modais legados (components/Login/*).
import * as cognito from '../api/cognito';
import { validatePassword } from './passwordPolicy';
import { canResend, recordResend } from './resendThrottle';
import { isValidConfirmationCode } from '../../../models/user';
import { openExternal } from '../../../lib/ipcClient';

/** Sign-in básico (email = username — BR-MIGRAR-001). */
export async function signInUser(email: string, password: string) {
  return cognito.signIn({ username: email, password });
}

/** Sign-up com policy completa (BR-MIGRAR-002) + Terms obrigatório (BR-MIGRAR-003). */
export async function signUpUser(email: string, password: string, termsAccepted: boolean) {
  if (!termsAccepted) throw new Error('É preciso aceitar os Termos de Uso.');
  const policy = validatePassword(password);
  if (!policy.valid) throw new Error(policy.errors.join('; '));
  return cognito.signUp({ username: email, password, options: { userAttributes: { email } } });
}

/** Confirm-then-sign-in atômico (BR-MIGRAR-006) com código 6 dígitos (BR-MIGRAR-004). */
export async function confirmAndSignIn(email: string, code: string, passwordToLogin: string) {
  if (!isValidConfirmationCode(code)) throw new Error('O código deve ter 6 dígitos.');
  await cognito.confirmSignUp({ username: email, confirmationCode: code });
  return cognito.signIn({ username: email, password: passwordToLogin });
}

/** Reenvio de código com throttle 60s persistente (BR-MIGRAR-005). */
export async function resendCode(email: string) {
  const { allowed, remainingMs } = await canResend();
  if (!allowed) throw new Error(`Aguarde ${Math.ceil(remainingMs / 1000)}s para reenviar.`);
  await cognito.resendSignUpCode({ username: email });
  await recordResend();
}

/** Save-on-sign-out local-first (BR-MIGRAR-008): flush ANTES de invalidar o token. */
export async function signOutWithFlush(flush?: () => Promise<void> | void) {
  try {
    await flush?.();
  } catch (e) {
    console.error('[auth] flush antes do sign-out falhou (prossegue mesmo assim)', e);
  }
  await cognito.signOut();
}

/** Abre o link dos Termos no browser externo no desktop (BR-MIGRAR-003 / AD-04). */
export async function openTerms(url: string) {
  await openExternal(url);
}
