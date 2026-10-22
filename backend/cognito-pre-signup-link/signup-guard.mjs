// signup-guard.mjs  (FIL-665, 2026-10-16)
//
// Sign-up abuse checks. The free allowance is per account, so an account must
// not be cheap to make. For an email-and-password sign-up (PreSignUp_SignUp):
//   1. A known throwaway-inbox domain is refused (disposable-domains.txt, a
//      snapshot of github.com/disposable-email-domains; README has the
//      refresh command). Subdomains of a listed domain match too.
//   2. One inbox, one account. The address is folded to its inbox (lowercase,
//      a +tag dropped, dots dropped for Gmail) and the sign-up is refused while
//      a live account already holds that inbox. Cognito already refuses the
//      exact same address (email is the username); this catches the variants
//      that land in the same mailbox, and an inbox that signs in with Google
//      (the reverse path index.mjs's README lists as not covered).
// A Google sign-up is never refused here: Google verified the address and
// index.mjs links it to the matching account. When it creates a new account,
// that account reserves its inbox (reserveExternal).
//
// Reservations live in FilmUsage<env>: PK userId = "inbox#<folded>", SK
// "account", with the username that holds the inbox. A holder that never
// confirmed, was deleted or is disabled is stale and gets taken over.
//
// Fails OPEN on any lookup error: a guard outage must not lock real writers
// out. The per-IP WAF rule on the pool is the backstop.

import { readFileSync } from 'node:fs';

export const DISPOSABLE_MESSAGE = "Please use a permanent email address. Temporary inboxes can't hold a FilmAssistant account.";
export const TAKEN_MESSAGE = 'An account already uses this email inbox. Sign in instead, or reset your password if you have forgotten it.';
export const GOOGLE_MESSAGE = 'This email already signs in with Google. Use Continue with Google.';

// The pool decides which usage table holds its reservations.
const ENV_OF_POOL = {
  'us-east-1_NXkJWCDUF': 'prod',
  'us-east-1_00T6W3NmV': 'dev',
};
export const usageTable = (userPoolId) => {
  const env = ENV_OF_POOL[userPoolId];
  return env === 'prod' ? 'FilmUsageProd' : env === 'dev' ? 'FilmUsageDev' : null;
};

let disposable = null;
/** The bundled throwaway-domain set, read once per container. */
export function disposableDomains() {
  if (disposable) return disposable;
  const text = readFileSync(new URL('./disposable-domains.txt', import.meta.url), 'utf8');
  disposable = new Set(text.split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#')));
  return disposable;
}

/** True when the domain or any parent of it is on the list. */
export function isDisposable(domain, set = disposableDomains()) {
  const parts = String(domain ?? '').toLowerCase().split('.').filter(Boolean);
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (set.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

const GMAIL = new Set(['gmail.com', 'googlemail.com']);

/** The mailbox an address delivers to: "J.Smith+fa@GoogleMail.com" -> "jsmith@gmail.com". */
export function foldInbox(email) {
  const addr = String(email ?? '').trim().toLowerCase();
  const at = addr.lastIndexOf('@');
  if (at <= 0 || at === addr.length - 1) return addr;
  let local = addr.slice(0, at);
  let domain = addr.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return local ? `${local}@${domain}` : addr;
}

const LIVE = new Set(['CONFIRMED', 'EXTERNAL_PROVIDER']);
/** A holder still owns its inbox while it exists, is enabled and finished signing up. */
export const holdsInbox = (user) => !!user && user.Enabled !== false && LIVE.has(String(user.UserStatus ?? ''));

const refuse = (message, reason) => Object.assign(new Error(message), { refusal: reason });

/**
 * The check for an email-and-password sign-up. Throws a writer-facing Error
 * (Cognito shows its message) when the sign-up is refused; returns
 * { action } otherwise. deps: { getReservation, putReservation, getUser }.
 */
export async function guardSignUp(event, deps, log = console) {
  if (event?.triggerSource !== 'PreSignUp_SignUp') return { action: 'skip', reason: 'not_native_sign_up' };
  const email = String(event.request?.userAttributes?.email ?? '').trim();
  const domain = email.slice(email.lastIndexOf('@') + 1);
  if (email && isDisposable(domain)) throw refuse(DISPOSABLE_MESSAGE, 'disposable_domain');

  const table = usageTable(event.userPoolId);
  if (!email || !table) return { action: 'skip', reason: !email ? 'no_email' : 'unknown_pool' };
  const inbox = foldInbox(email);
  try {
    const held = await deps.getReservation(table, inbox);
    if (held?.username && held.username !== event.userName) {
      let holder = null;
      try {
        holder = await deps.getUser(event.userPoolId, held.username);
      } catch (err) {
        if (err?.name !== 'UserNotFoundException') throw err;
      }
      if (holdsInbox(holder)) {
        throw refuse(holder.UserStatus === 'EXTERNAL_PROVIDER' ? GOOGLE_MESSAGE : TAKEN_MESSAGE, 'inbox_taken');
      }
    }
    await deps.putReservation(table, inbox, event.userName);
    return { action: 'reserved' };
  } catch (err) {
    if (err?.refusal) throw err;
    // Fail open; the address stays out of the log.
    log.error(JSON.stringify({ msg: 'signup-guard lookup failed (allowed)', userName: event.userName, error: err?.name, detail: err?.message }));
    return { action: 'allowed_on_error' };
  }
}

/**
 * A Google sign-up that became a NEW account reserves its inbox, so a later
 * email-and-password sign-up for the same mailbox is pointed to Google.
 * Never throws.
 */
export async function reserveExternal(event, deps, log = console) {
  const table = usageTable(event?.userPoolId);
  const email = String(event?.request?.userAttributes?.email ?? '').trim();
  if (!table || !email) return { action: 'skip' };
  try {
    const inbox = foldInbox(email);
    const held = await deps.getReservation(table, inbox);
    if (held?.username && held.username !== event.userName) {
      let holder = null;
      try {
        holder = await deps.getUser(event.userPoolId, held.username);
      } catch (err) {
        if (err?.name !== 'UserNotFoundException') throw err;
      }
      if (holdsInbox(holder)) return { action: 'kept' };
    }
    await deps.putReservation(table, inbox, event.userName);
    return { action: 'reserved' };
  } catch (err) {
    log.error(JSON.stringify({ msg: 'signup-guard external reserve failed', userName: event?.userName, error: err?.name }));
    return { action: 'allowed_on_error' };
  }
}

// --- AWS (imported lazily: the local tests have no SDK) ----------------------
let clients;
async function aws() {
  if (!clients) {
    const ddb = await import('@aws-sdk/client-dynamodb');
    const idp = await import('@aws-sdk/client-cognito-identity-provider');
    clients = { ddb, idp, db: new ddb.DynamoDBClient({}), cognito: new idp.CognitoIdentityProviderClient({}) };
  }
  return clients;
}

const key = (inbox) => ({ userId: { S: `inbox#${inbox}` }, sk: { S: 'account' } });

export function guardAwsDeps() {
  return {
    async getReservation(table, inbox) {
      const { ddb, db } = await aws();
      const out = await db.send(new ddb.GetItemCommand({ TableName: table, Key: key(inbox), ConsistentRead: true }));
      return out.Item ? { username: out.Item.username?.S ?? '' } : null;
    },
    async putReservation(table, inbox, username) {
      const { ddb, db } = await aws();
      await db.send(new ddb.PutItemCommand({
        TableName: table,
        Item: { ...key(inbox), username: { S: String(username) }, at: { S: new Date().toISOString() } },
      }));
    },
    async getUser(userPoolId, username) {
      const { idp, cognito } = await aws();
      return cognito.send(new idp.AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }));
    },
  };
}
