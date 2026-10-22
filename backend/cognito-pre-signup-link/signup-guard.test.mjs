// node --test signup-guard.test.mjs   (FIL-665)
// Unit tests for the sign-up abuse checks, no AWS: the reservation table and
// the pool lookup are injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISPOSABLE_MESSAGE, GOOGLE_MESSAGE, TAKEN_MESSAGE,
  foldInbox, guardSignUp, holdsInbox, isDisposable, reserveExternal, usageTable,
} from './signup-guard.mjs';
import { createHandler } from './index.mjs';

const DEV_POOL = 'us-east-1_00T6W3NmV';
const quietLog = { log() {}, error() {} };

const signUp = (email, over = {}) => ({
  triggerSource: 'PreSignUp_SignUp',
  userPoolId: DEV_POOL,
  userName: 'new-uuid',
  request: { userAttributes: { email } },
  response: {},
  ...over,
});

/** In-memory reservations + pool users. */
const fakeGuard = ({ reservations = {}, users = {}, failGet = false } = {}) => {
  const calls = { put: [], getUser: [] };
  return {
    calls,
    reservations,
    async getReservation(table, inbox) {
      assert.equal(table, 'FilmUsageDev');
      if (failGet) throw Object.assign(new Error('ddb down'), { name: 'ServiceUnavailable' });
      return reservations[inbox] ? { username: reservations[inbox] } : null;
    },
    async putReservation(table, inbox, username) { calls.put.push({ inbox, username }); reservations[inbox] = username; },
    async getUser(pool, username) {
      calls.getUser.push(username);
      if (!users[username]) throw Object.assign(new Error('nope'), { name: 'UserNotFoundException' });
      return users[username];
    },
  };
};

test('foldInbox: lowercase, +tag dropped, Gmail dots dropped, googlemail is gmail', () => {
  assert.equal(foldInbox('J.Smith+fa@GoogleMail.com'), 'jsmith@gmail.com');
  assert.equal(foldInbox(' ana.b@gmail.com '), 'anab@gmail.com');
  assert.equal(foldInbox('ana.b+x@outlook.com'), 'ana.b@outlook.com');
  assert.equal(foldInbox('Rosa@Example.com'), 'rosa@example.com');
  assert.equal(foldInbox('+only@example.com'), '+only@example.com');
  assert.equal(foldInbox('not-an-email'), 'not-an-email');
});

test('isDisposable: listed domains and their subdomains; mainstream providers pass', () => {
  assert.ok(isDisposable('mailinator.com'));
  assert.ok(isDisposable('inbox.mailinator.com'));
  assert.ok(isDisposable('10MinuteMail.com'));
  for (const d of ['gmail.com', 'outlook.com', 'icloud.com', 'proton.me', 'yahoo.com', 'example.com', 'com']) {
    assert.equal(isDisposable(d), false, d);
  }
});

test('a throwaway-inbox domain is refused before anything is looked up', async () => {
  const g = fakeGuard();
  await assert.rejects(guardSignUp(signUp('x@mailinator.com'), g, quietLog), (e) => e.message === DISPOSABLE_MESSAGE && e.refusal === 'disposable_domain');
  assert.equal(g.calls.put.length, 0);
});

test('a new inbox is reserved for the new account', async () => {
  const g = fakeGuard();
  assert.deepEqual(await guardSignUp(signUp('Ana.B@gmail.com'), g, quietLog), { action: 'reserved' });
  assert.deepEqual(g.calls.put, [{ inbox: 'anab@gmail.com', username: 'new-uuid' }]);
});

test('a variant of an inbox a confirmed account holds is refused', async () => {
  const g = fakeGuard({ reservations: { 'anab@gmail.com': 'old-uuid' }, users: { 'old-uuid': { UserStatus: 'CONFIRMED', Enabled: true } } });
  await assert.rejects(guardSignUp(signUp('a.n.a.b+2@gmail.com'), g, quietLog), (e) => e.message === TAKEN_MESSAGE && e.refusal === 'inbox_taken');
  assert.equal(g.calls.put.length, 0);
});

test('an inbox that signs in with Google points the writer to Google', async () => {
  const g = fakeGuard({ reservations: { 'anab@gmail.com': 'google_123' }, users: { google_123: { UserStatus: 'EXTERNAL_PROVIDER', Enabled: true } } });
  await assert.rejects(guardSignUp(signUp('anab@gmail.com'), g, quietLog), (e) => e.message === GOOGLE_MESSAGE);
});

test('a stale holder (unconfirmed, deleted or disabled) is taken over', async () => {
  for (const users of [{ 'old-uuid': { UserStatus: 'UNCONFIRMED', Enabled: true } }, {}, { 'old-uuid': { UserStatus: 'CONFIRMED', Enabled: false } }]) {
    const g = fakeGuard({ reservations: { 'rosa@example.com': 'old-uuid' }, users });
    assert.deepEqual(await guardSignUp(signUp('rosa@example.com'), g, quietLog), { action: 'reserved' });
    assert.equal(g.reservations['rosa@example.com'], 'new-uuid');
  }
});

test('the same account signing up again is not checked against itself', async () => {
  const g = fakeGuard({ reservations: { 'rosa@example.com': 'new-uuid' } });
  assert.deepEqual(await guardSignUp(signUp('rosa@example.com'), g, quietLog), { action: 'reserved' });
  assert.equal(g.calls.getUser.length, 0);
});

test('a lookup error lets the sign-up through (fail open) and keeps the address out of the log', async () => {
  const lines = [];
  const g = fakeGuard({ failGet: true });
  const out = await guardSignUp(signUp('rosa@example.com'), g, { log() {}, error: (l) => lines.push(l) });
  assert.deepEqual(out, { action: 'allowed_on_error' });
  assert.ok(lines.length === 1 && !lines[0].includes('rosa@example.com'));
});

test('unknown pools and Google sign-ups are not checked here', async () => {
  const g = fakeGuard();
  assert.equal((await guardSignUp(signUp('rosa@example.com', { userPoolId: 'us-east-1_OTHER' }), g, quietLog)).reason, 'unknown_pool');
  assert.equal((await guardSignUp(signUp('rosa@example.com', { triggerSource: 'PreSignUp_ExternalProvider' }), g, quietLog)).action, 'skip');
  assert.equal(usageTable('us-east-1_NXkJWCDUF'), 'FilmUsageProd');
  assert.equal(usageTable(DEV_POOL), 'FilmUsageDev');
});

test('holdsInbox: confirmed or Google, enabled', () => {
  assert.ok(holdsInbox({ UserStatus: 'CONFIRMED', Enabled: true }));
  assert.ok(holdsInbox({ UserStatus: 'EXTERNAL_PROVIDER' }));
  assert.equal(holdsInbox({ UserStatus: 'UNCONFIRMED' }), false);
  assert.equal(holdsInbox({ UserStatus: 'CONFIRMED', Enabled: false }), false);
  assert.equal(holdsInbox(null), false);
});

test('a new Google account reserves its inbox; a live holder is kept', async () => {
  const g = fakeGuard();
  const google = signUp('Ana.B@gmail.com', { triggerSource: 'PreSignUp_ExternalProvider', userName: 'google_9' });
  assert.deepEqual(await reserveExternal(google, g, quietLog), { action: 'reserved' });
  assert.equal(g.reservations['anab@gmail.com'], 'google_9');
  const kept = fakeGuard({ reservations: { 'anab@gmail.com': 'old-uuid' }, users: { 'old-uuid': { UserStatus: 'CONFIRMED' } } });
  assert.deepEqual(await reserveExternal(google, kept, quietLog), { action: 'kept' });
});

test('handler: a refusal reaches Cognito with its message; an allowed sign-up returns the same event', async () => {
  const linkDeps = { listUsersByEmail: async () => [], linkProvider: async () => {} };
  const refusing = fakeGuard({ reservations: { 'anab@gmail.com': 'old-uuid' }, users: { 'old-uuid': { UserStatus: 'CONFIRMED' } } });
  await assert.rejects(createHandler(linkDeps, {}, quietLog, refusing)(signUp('a.nab@gmail.com')), new RegExp(TAKEN_MESSAGE.slice(0, 30)));
  const ev = signUp('new@example.com');
  assert.equal(await createHandler(linkDeps, {}, quietLog, fakeGuard())(ev), ev);
});

test('handler: a Google sign-up with no account to link reserves the inbox; a linked one does not', async () => {
  const g = fakeGuard();
  const google = {
    triggerSource: 'PreSignUp_ExternalProvider', userPoolId: DEV_POOL, userName: 'google_1029384756',
    request: { userAttributes: { email: 'new@example.com', email_verified: 'true' } }, response: {},
  };
  await createHandler({ listUsersByEmail: async () => [], linkProvider: async () => {} }, {}, quietLog, g)(google);
  assert.equal(g.reservations['new@example.com'], 'google_1029384756');

  const g2 = fakeGuard();
  const native = { Username: 'native-1', UserStatus: 'CONFIRMED', Enabled: true, Attributes: [{ Name: 'email', Value: 'new@example.com' }, { Name: 'email_verified', Value: 'true' }] };
  await createHandler({ listUsersByEmail: async () => [native], linkProvider: async () => {} }, {}, quietLog, g2)(google);
  assert.equal(g2.calls.put.length, 0);
});

test('writer-facing copy: no em dash', () => {
  for (const m of [DISPOSABLE_MESSAGE, TAKEN_MESSAGE, GOOGLE_MESSAGE]) assert.ok(!m.includes(String.fromCharCode(0x2014)), m);
});
