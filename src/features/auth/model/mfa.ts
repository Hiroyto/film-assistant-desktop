// MFA dormente (DEC-007 / BR-HUMANA-001). O dado é populado a partir do Cognito,
// mas NENHUMA UI o lê — fica para um futuro ciclo de segurança.
import { getMfaState } from '../api/cognito';
import { deriveMfaConfigured } from '../../../data/sync-agent/transforms';
import type { MfaConfigured } from '../../../models/user';

/** Deriva users.mfa_configured (T-04). Não há UI de enroll/challenge nesta fase. */
export async function getMfaConfigured(): Promise<MfaConfigured> {
  const { mfaConfiguration, hasTotpEnrolled } = await getMfaState();
  return deriveMfaConfigured(mfaConfiguration, hasTotpEnrolled);
}
