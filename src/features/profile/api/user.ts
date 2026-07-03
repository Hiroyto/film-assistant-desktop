// User API (BC-06/01). Refetch do estado do usuário (POST /user) — usado após o
// checkout (deep link/polling) para hidratar cap + subscription (AD-04).
import { safeApiCall } from '../../../models/apiHelpers';

export interface UserFetchResult {
  cap: number;
  subscription: string | null;
  privacy: boolean | null;
  preferred_username?: string;
  [k: string]: unknown;
}

/** POST /user — retorna o estado de aplicação do usuário. */
export async function refetchUser(token: string): Promise<UserFetchResult | null> {
  const res = await safeApiCall('user', {}, token);
  if (!res.success) return null;
  const d = res.data ?? {};
  return {
    cap: Number(d.cap ?? 0) || 0,
    subscription: d.subscription ?? null,
    privacy: d.privacy == null ? null : Boolean(d.privacy),
    preferred_username: d.preferred_username,
    ...d,
  };
}

/** Snapshot mínimo (cap + subscription) para o polling do checkout. */
export async function pollUserSnapshot(token: string): Promise<{ cap: number; subscription: string | null }> {
  const u = await refetchUser(token);
  return { cap: u?.cap ?? 0, subscription: u?.subscription ?? null };
}
