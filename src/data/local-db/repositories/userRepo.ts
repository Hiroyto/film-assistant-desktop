// userRepo (BC-01/08). CRUD de users + subscriptions. Implementa parte da
// interface InitialPullRepos (Tarefa 03).
import { get, run } from '../db';
import type { UserRow, SubscriptionRow } from '../rows';

export async function isUserPresent(userId: string): Promise<boolean> {
  const row = await get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE user_id = ?', [userId]);
  return (row?.n ?? 0) > 0;
}

export async function getUser(userId: string): Promise<UserRow | null> {
  return get<UserRow>('SELECT * FROM users WHERE user_id = ?', [userId]);
}

export async function upsertUser(u: UserRow): Promise<void> {
  await run(
    `INSERT INTO users
       (user_id, email, preferred_username, cap, subscription, privacy, mfa_configured,
        last_signed_in_at, created_at, updated_at, synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET
       email=excluded.email,
       preferred_username=excluded.preferred_username,
       cap=excluded.cap,
       subscription=excluded.subscription,
       privacy=excluded.privacy,
       mfa_configured=excluded.mfa_configured,
       last_signed_in_at=excluded.last_signed_in_at,
       updated_at=excluded.updated_at,
       synced_at=excluded.synced_at`,
    [
      u.user_id, u.email, u.preferred_username, u.cap, u.subscription, u.privacy,
      u.mfa_configured, u.last_signed_in_at, u.created_at, u.updated_at, u.synced_at,
    ],
  );
}

export async function markUserSynced(userId: string, at: string): Promise<void> {
  await run('UPDATE users SET synced_at = ? WHERE user_id = ?', [at, userId]);
}

/** Atualiza apenas o token balance (BR-MIGRAR-044). */
export async function updateCap(userId: string, cap: number, at: string): Promise<void> {
  await run('UPDATE users SET cap = ?, updated_at = ? WHERE user_id = ?', [cap, at, userId]);
}

export async function upsertSubscription(s: SubscriptionRow): Promise<void> {
  await run(
    `INSERT INTO subscriptions
       (user_id, tier, cap_mirror, current_period_end, stripe_customer_id,
        last_checkout_session, updated_at, synced_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET
       tier=excluded.tier,
       cap_mirror=excluded.cap_mirror,
       current_period_end=excluded.current_period_end,
       stripe_customer_id=excluded.stripe_customer_id,
       last_checkout_session=excluded.last_checkout_session,
       updated_at=excluded.updated_at,
       synced_at=excluded.synced_at`,
    [
      s.user_id, s.tier, s.cap_mirror, s.current_period_end, s.stripe_customer_id,
      s.last_checkout_session, s.updated_at, s.synced_at,
    ],
  );
}

export async function getSubscription(userId: string): Promise<SubscriptionRow | null> {
  return get<SubscriptionRow>('SELECT * FROM subscriptions WHERE user_id = ?', [userId]);
}
