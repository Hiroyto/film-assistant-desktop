// node --test backend/cognito-post-confirmation-seed/
// Testes de unidade do trigger, sem AWS: putUserIfAbsent é injetado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INITIAL_CAP, buildUserItem, createHandler, initialCap, seedUserRecord, signUpDay } from './index.mjs';

const EMAIL = 'ana@example.com';
const NOW = new Date('2026-10-05T21:30:34.543Z');
const SUB = '3b6d0f0e-7c1a-4f2b-9e2d-1a2b3c4d5e6f';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Conta nativa: com e-mail como atributo de username, o Cognito usa o próprio sub como userName.
const nativeEvent = (over = {}) => ({
  triggerSource: 'PostConfirmation_ConfirmSignUp',
  userPoolId: 'us-east-1_TEST1234',
  userName: SUB,
  request: { userAttributes: { sub: SUB, email: EMAIL, email_verified: 'true', preferred_username: 'ana' } },
  response: {},
  ...over,
});

// Conta federada: userName `google_<id do Google>`, sub é OUTRO UUID, e vem a claim `identities`.
const googleEvent = (over = {}) => nativeEvent({
  userName: 'google_1029384756',
  request: {
    userAttributes: {
      sub: SUB,
      email: EMAIL,
      email_verified: 'true',
      identities: '[{"userId":"1029384756","providerName":"Google","providerType":"Google","primary":"true"}]',
    },
  },
  ...over,
});

const fakeDeps = ({ exists = false } = {}) => {
  const puts = [];
  return { puts, putUserIfAbsent: async (item) => { puts.push(item); return !exists; } };
};

const quietLog = { log() {}, error() {} };
const opts = { env: {}, now: NOW };

test('cadastro nativo: grava o item completo com a chave = userName e cap 25', async () => {
  const deps = fakeDeps();
  const out = await seedUserRecord(nativeEvent(), deps, opts);
  assert.deepEqual(out, { action: 'created', userId: SUB, cap: 25, federated: false });
  assert.equal(deps.puts.length, 1);
  const { subscription_id, ...item } = deps.puts[0];
  assert.match(subscription_id, UUID_V4);
  assert.deepEqual(item, {
    userId: SUB,
    email: EMAIL,
    cognito_sub: SUB,
    subscription: 'free',
    cap: 25,
    gpt_tokens: 100,
    haiku_tokens: 100,
    sonnet_usage: 100,
    total_cost: 300,
    sign_up_date: '10/5/2026',
    last_token_reset_date: '10/5/2026',
    token_reset_date: '10/5/2026',
    privacy: false,
    works: {},
  });
});

test('login Google: a chave é o cognito:username (google_…), NÃO o sub; o sub fica em cognito_sub', async () => {
  const deps = fakeDeps();
  const out = await seedUserRecord(googleEvent(), deps, opts);
  assert.deepEqual(out, { action: 'created', userId: 'google_1029384756', cap: 25, federated: true });
  assert.equal(deps.puts[0].userId, 'google_1029384756');
  assert.equal(deps.puts[0].cognito_sub, SUB);
  assert.equal(deps.puts[0].cap, 25);
  assert.equal(deps.puts[0].email, EMAIL);
});

test('confirmação de "esqueci a senha" e outros gatilhos passam sem gravar', async () => {
  for (const triggerSource of ['PostConfirmation_ConfirmForgotPassword', 'PreSignUp_SignUp', 'PostAuthentication_Authentication', undefined]) {
    const deps = fakeDeps();
    const out = await seedUserRecord(nativeEvent({ triggerSource }), deps, opts);
    assert.deepEqual(out, { action: 'skip', reason: 'not_confirm_signup' });
    assert.equal(deps.puts.length, 0);
  }
});

test('item já existente não é sobrescrito (PutItem condicional devolve false)', async () => {
  const deps = fakeDeps({ exists: true });
  const out = await seedUserRecord(googleEvent(), deps, opts);
  assert.deepEqual(out, { action: 'skip', reason: 'already_exists', userId: 'google_1029384756' });
  assert.equal(deps.puts.length, 1);
});

test('email_verified NÃO é condição: "false" e ausente também criam o registro', async () => {
  for (const email_verified of ['false', undefined, '']) {
    const deps = fakeDeps();
    const ev = googleEvent({ request: { userAttributes: { sub: SUB, email: EMAIL, email_verified } } });
    const out = await seedUserRecord(ev, deps, opts);
    assert.equal(out.action, 'created');
    assert.equal(deps.puts[0].cap, 25);
  }
});

test('IdP sem e-mail mapeado: grava sem o atributo email (e sem cognito_sub se não houver sub)', async () => {
  const deps = fakeDeps();
  const out = await seedUserRecord(googleEvent({ request: { userAttributes: { identities: '[{"providerName":"Google"}]' } } }), deps, opts);
  assert.deepEqual(out, { action: 'created', userId: 'google_1029384756', cap: 25, federated: true });
  assert.equal('email' in deps.puts[0], false);
  assert.equal('cognito_sub' in deps.puts[0], false);
  assert.equal(deps.puts[0].userId, 'google_1029384756');
});

test('userName ausente ou vazio: não grava', async () => {
  for (const userName of [undefined, '', '   ', 42]) {
    const deps = fakeDeps();
    assert.deepEqual(await seedUserRecord(nativeEvent({ userName }), deps, opts), { action: 'skip', reason: 'no_username' });
    assert.equal(deps.puts.length, 0);
  }
});

test('INITIAL_CAP pelo ambiente; valor inválido cai no padrão 25', async () => {
  assert.equal(DEFAULT_INITIAL_CAP, 25);
  assert.equal(initialCap({}), 25);
  assert.equal(initialCap({ INITIAL_CAP: '40' }), 40);
  assert.equal(initialCap({ INITIAL_CAP: '0' }), 0);
  for (const bad of ['abc', '-1', '2.5', '', ' ']) assert.equal(initialCap({ INITIAL_CAP: bad }), 25, `INITIAL_CAP=${JSON.stringify(bad)}`);

  const deps = fakeDeps();
  const out = await seedUserRecord(nativeEvent(), deps, { env: { INITIAL_CAP: '40' }, now: NOW });
  assert.equal(out.cap, 40);
  assert.equal(deps.puts[0].cap, 40);
});

test('sign_up_date no formato da versão original (M/D/YYYY), sempre em UTC', () => {
  assert.equal(signUpDay(new Date('2026-01-09T23:59:59Z')), '1/9/2026');
  assert.equal(signUpDay(new Date('2026-12-31T03:00:00Z')), '12/31/2026');
  assert.equal(buildUserItem(nativeEvent(), { env: {}, now: NOW, uuid: () => 'u' }).sign_up_date, '10/5/2026');
});

test('handler devolve o MESMO evento (o Cognito exige) em created e em skip', async () => {
  const created = googleEvent();
  assert.equal(await createHandler(fakeDeps(), {}, quietLog, () => NOW)(created), created);
  const reset = nativeEvent({ triggerSource: 'PostConfirmation_ConfirmForgotPassword' });
  assert.equal(await createHandler(fakeDeps(), {}, quietLog, () => NOW)(reset), reset);
  const existing = nativeEvent();
  assert.equal(await createHandler(fakeDeps({ exists: true }), {}, quietLog, () => NOW)(existing), existing);
});

test('log de sucesso diz a chave usada e se foi federado, sem o e-mail', async () => {
  const lines = [];
  const log = { log: (l) => lines.push(l), error() {} };
  await createHandler(fakeDeps(), {}, log, () => NOW)(googleEvent());
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), { msg: 'post-confirmation-seed', userName: 'google_1029384756', action: 'created', userId: 'google_1029384756', cap: 25, federated: true });
  assert.ok(!lines[0].includes(EMAIL));
});

test('falha ao gravar derruba a confirmação (fail closed) e não vaza o e-mail no log', async () => {
  const logged = [];
  const log = { log() {}, error: (line) => logged.push(line) };
  const putFails = { putUserIfAbsent: async () => { throw Object.assign(new Error('rate exceeded'), { name: 'ProvisionedThroughputExceededException' }); } };

  await assert.rejects(createHandler(putFails, {}, log, () => NOW)(googleEvent()), /Could not set up your account/);

  assert.equal(logged.length, 1);
  assert.ok(!logged[0].includes(EMAIL));
  assert.ok(logged[0].includes('ProvisionedThroughputExceededException'));
  assert.ok(logged[0].includes('google_1029384756'));
});
