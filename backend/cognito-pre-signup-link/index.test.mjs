// node --test backend/cognito-pre-signup-link/
// Testes de unidade do trigger, sem AWS: listUsersByEmail/linkProvider são injetados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedProviders, createHandler, linkExternalToExisting, parseExternalUserName, pickLinkTarget } from './index.mjs';

const POOL = 'us-east-1_TEST1234';
const EMAIL = 'ana@example.com';

const user = ({ username = 'native-uuid-1', status = 'CONFIRMED', email = EMAIL, verified = 'true', enabled = true } = {}) => ({
  Username: username,
  UserStatus: status,
  Enabled: enabled,
  Attributes: [
    { Name: 'email', Value: email },
    ...(verified === null ? [] : [{ Name: 'email_verified', Value: verified }]),
  ],
});

const googleEvent = (over = {}) => ({
  triggerSource: 'PreSignUp_ExternalProvider',
  userPoolId: POOL,
  userName: 'google_1029384756',
  request: { userAttributes: { email: EMAIL, email_verified: 'true' } },
  response: {},
  ...over,
});

const fakeDeps = (users = []) => {
  const calls = { list: [], link: [] };
  return {
    calls,
    listUsersByEmail: async (pool, email) => { calls.list.push({ pool, email }); return users; },
    linkProvider: async (args) => { calls.link.push(args); },
  };
};

const quietLog = { log() {}, error() {} };

test('parseExternalUserName: provedores sociais em qualquer caixa; desconhecido → null', () => {
  assert.deepEqual(parseExternalUserName('google_1029384756'), { providerName: 'Google', providerUserId: '1029384756' });
  assert.deepEqual(parseExternalUserName('Google_1029384756'), { providerName: 'Google', providerUserId: '1029384756' });
  assert.deepEqual(parseExternalUserName('signinwithapple_000111.abc.1111'), { providerName: 'SignInWithApple', providerUserId: '000111.abc.1111' });
  assert.equal(parseExternalUserName('mysaml_user@corp.com'), null);
  assert.equal(parseExternalUserName('google_'), null);
  assert.equal(parseExternalUserName('semseparador'), null);
  assert.equal(parseExternalUserName(undefined), null);
});

test('vincula a identidade Google à ÚNICA conta nativa confirmada e verificada', async () => {
  const deps = fakeDeps([user()]);
  const out = await linkExternalToExisting(googleEvent(), deps, {});
  assert.deepEqual(out, { action: 'linked', provider: 'Google', destination: 'native-uuid-1' });
  assert.deepEqual(deps.calls.list, [{ pool: POOL, email: EMAIL }]);
  assert.deepEqual(deps.calls.link, [
    { userPoolId: POOL, destinationUsername: 'native-uuid-1', providerName: 'Google', providerUserId: '1029384756' },
  ]);
});

test('cadastro nativo e AdminCreateUser passam sem consultar nada', async () => {
  for (const triggerSource of ['PreSignUp_SignUp', 'PreSignUp_AdminCreateUser']) {
    const deps = fakeDeps([user()]);
    const out = await linkExternalToExisting(googleEvent({ triggerSource, userName: 'native-uuid-9' }), deps, {});
    assert.deepEqual(out, { action: 'skip', reason: 'not_external_provider' });
    assert.equal(deps.calls.list.length, 0);
  }
});

test('IdP sem email_verified=true não vincula (e nem consulta o pool)', async () => {
  for (const email_verified of ['false', undefined, 'False', '']) {
    const deps = fakeDeps([user()]);
    const out = await linkExternalToExisting(googleEvent({ request: { userAttributes: { email: EMAIL, email_verified } } }), deps, {});
    assert.deepEqual(out, { action: 'skip', reason: 'idp_email_not_verified' });
    assert.equal(deps.calls.list.length, 0);
    assert.equal(deps.calls.link.length, 0);
  }
});

test('destino não elegível não vincula: não confirmado, e-mail não verificado, desabilitado, só externo', async () => {
  const cases = [
    [user({ status: 'UNCONFIRMED' })],
    [user({ verified: 'false' })],
    [user({ verified: null })],
    [user({ enabled: false })],
    [user({ status: 'FORCE_CHANGE_PASSWORD' })],
    [user({ username: 'google_999', status: 'EXTERNAL_PROVIDER' })],
    [user({ email: 'outra@example.com' })],
  ];
  for (const users of cases) {
    const deps = fakeDeps(users);
    const out = await linkExternalToExisting(googleEvent(), deps, {});
    assert.deepEqual(out, { action: 'skip', reason: 'no_eligible_native_user' });
    assert.equal(deps.calls.link.length, 0);
  }
});

test('sem conta existente: segue o cadastro federado normal', async () => {
  const deps = fakeDeps([]);
  assert.deepEqual(await linkExternalToExisting(googleEvent(), deps, {}), { action: 'skip', reason: 'no_existing_user' });
});

test('dois destinos elegíveis é ambíguo: não vincula', async () => {
  const deps = fakeDeps([user({ username: 'a' }), user({ username: 'b' })]);
  assert.deepEqual(await linkExternalToExisting(googleEvent(), deps, {}), { action: 'skip', reason: 'no_eligible_native_user' });
  assert.equal(deps.calls.link.length, 0);
});

test('e-mail compara sem diferenciar caixa; convive com o usuário externo de outro provedor', () => {
  const target = pickLinkTarget([user({ email: 'Ana@Example.com' }), user({ username: 'facebook_1', status: 'EXTERNAL_PROVIDER' })], 'ana@example.com');
  assert.equal(target.Username, 'native-uuid-1');
});

test('provedor fora de LINK_PROVIDERS, e-mail ausente ou com aspas: não vincula', async () => {
  assert.deepEqual(allowedProviders({}), ['Google']);
  assert.deepEqual(allowedProviders({ LINK_PROVIDERS: 'Google, Facebook' }), ['Google', 'Facebook']);

  const fb = fakeDeps([user()]);
  assert.deepEqual(await linkExternalToExisting(googleEvent({ userName: 'facebook_55' }), fb, {}), { action: 'skip', reason: 'provider_not_enabled' });
  assert.deepEqual((await linkExternalToExisting(googleEvent({ userName: 'facebook_55' }), fakeDeps([user()]), { LINK_PROVIDERS: 'Google,Facebook' })).action, 'linked');

  for (const email of [undefined, '', 'a"b@example.com', 'a\\b@example.com']) {
    const deps = fakeDeps([user()]);
    const out = await linkExternalToExisting(googleEvent({ request: { userAttributes: { email, email_verified: 'true' } } }), deps, {});
    assert.deepEqual(out, { action: 'skip', reason: 'no_usable_email' });
    assert.equal(deps.calls.list.length, 0);
  }
});

test('handler devolve o MESMO evento (o Cognito exige) em vínculo e em skip', async () => {
  const event = googleEvent();
  assert.equal(await createHandler(fakeDeps([user()]), {}, quietLog)(event), event);
  const native = googleEvent({ triggerSource: 'PreSignUp_SignUp' });
  assert.equal(await createHandler(fakeDeps(), {}, quietLog)(native), native);
});

test('falha ao consultar ou vincular derruba o login (fail closed) e não vaza o e-mail no log', async () => {
  const logged = [];
  const log = { log() {}, error: (line) => logged.push(line) };

  const listFails = { listUsersByEmail: async () => { throw Object.assign(new Error('throttled'), { name: 'TooManyRequestsException' }); }, linkProvider: async () => {} };
  await assert.rejects(createHandler(listFails, {}, log)(googleEvent()), /Could not verify your existing account/);

  const linkFails = { listUsersByEmail: async () => [user()], linkProvider: async () => { throw Object.assign(new Error('nope'), { name: 'InvalidParameterException' }); } };
  await assert.rejects(createHandler(linkFails, {}, log)(googleEvent()), /Could not verify your existing account/);

  assert.equal(logged.length, 2);
  assert.ok(logged.every((line) => !line.includes(EMAIL)));
  assert.ok(logged[1].includes('InvalidParameterException'));
});
