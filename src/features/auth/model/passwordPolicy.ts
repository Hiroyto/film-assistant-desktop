// Password policy (BR-MIGRAR-002). Corrige o drift do cliente legado: agora também
// enforça LOWERCASE (servidor já exigia), evitando rejeição tardia do Cognito.
// Espelha aws_cognito_password_protection_settings.

export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordPolicyResult {
  const errors: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) errors.push(`Mínimo ${PASSWORD_MIN_LENGTH} caracteres`);
  if (!/[a-z]/.test(password)) errors.push('Pelo menos uma letra minúscula'); // fix do drift
  if (!/[A-Z]/.test(password)) errors.push('Pelo menos uma letra maiúscula');
  if (!/[0-9]/.test(password)) errors.push('Pelo menos um número');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('Pelo menos um símbolo');
  return { valid: errors.length === 0, errors };
}
