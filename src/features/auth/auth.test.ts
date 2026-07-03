// Testes das regras de auth puras (R-AUT). `craco test`.
import { validatePassword, PASSWORD_MIN_LENGTH } from './model/passwordPolicy';
import { cooldownState, RESEND_COOLDOWN_MS } from './model/resendThrottle';

describe('validatePassword (BR-MIGRAR-002 — fix lowercase)', () => {
  it('aceita senha completa', () => {
    expect(validatePassword('Abcdef1!').valid).toBe(true);
  });
  it('rejeita sem minúscula (drift corrigido)', () => {
    const r = validatePassword('ABCDEF1!');
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/minúscula/);
  });
  it('rejeita curta / sem número / sem símbolo / sem maiúscula', () => {
    expect(validatePassword('Ab1!').valid).toBe(false); // curta
    expect(validatePassword('Abcdefg!').valid).toBe(false); // sem número
    expect(validatePassword('Abcdefg1').valid).toBe(false); // sem símbolo
    expect(validatePassword('abcdef1!').valid).toBe(false); // sem maiúscula
  });
  it('exige no mínimo PASSWORD_MIN_LENGTH', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });
});

describe('cooldownState resend (BR-MIGRAR-005)', () => {
  const now = 1_000_000;
  it('permite quando nunca reenviou', () => {
    expect(cooldownState(null, now).allowed).toBe(true);
  });
  it('bloqueia dentro de 60s e reporta remaining', () => {
    const r = cooldownState(now - 10_000, now);
    expect(r.allowed).toBe(false);
    expect(r.remainingMs).toBe(RESEND_COOLDOWN_MS - 10_000);
  });
  it('permite após 60s', () => {
    expect(cooldownState(now - RESEND_COOLDOWN_MS, now).allowed).toBe(true);
  });
});
