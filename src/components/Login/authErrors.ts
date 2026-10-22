// components/Login/authErrors.ts  (FIL-665)
//
// Writer-facing text for the sign-up errors the abuse checks raise. Cognito
// wraps a pre-signup refusal as "PreSignUp failed with error <message>." (the
// message is already written for the writer, in
// backend/cognito-pre-signup-link/signup-guard.mjs), and the per-IP WAF rule
// on sign-up, resend-code and confirm arrives as a ForbiddenException.

export const TOO_MANY_ATTEMPTS = 'Too many attempts from your network. Wait a few minutes, then try again.';

export function friendlyAuthError(err: any, fallback: string): string {
  const name = String(err?.name ?? err?.code ?? '');
  const message = String(err?.message ?? '');
  if (name === 'ForbiddenException' || /\bwaf\b/i.test(message)) return TOO_MANY_ATTEMPTS;
  const refused = message.match(/PreSignUp failed with error ([\s\S]+)$/);
  if (refused) return refused[1].trim().replace(/\.\.$/, '.');
  return message || fallback;
}
