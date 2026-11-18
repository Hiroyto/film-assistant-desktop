// node --test backend/share-links/
import test from 'node:test';
import assert from 'node:assert/strict';
import { callerOf, createHandler } from './index.mjs';

function memoryStore() {
  const map = new Map();
  return {
    map,
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async put(key, text) { map.set(key, text); },
    async del(key) { map.delete(key); },
    async list(prefix) { return [...map.keys()].filter((k) => k.startsWith(prefix)).sort(); },
  };
}

const as = (user) => ({ authorizer: { claims: { 'cognito:username': user } } });
const post = (body, requestContext = {}) => ({ httpMethod: 'POST', body: JSON.stringify(body), requestContext });
const parse = (res) => ({ status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, headers: res.headers });

function setup(env = {}) {
  const store = memoryStore();
  let n = 0;
  const handler = createHandler({
    store,
    env,
    now: () => new Date('2026-11-17T12:00:00.000Z'),
    newToken: () => `tok_${String(++n).padStart(4, '0')}_abcdefghijklmnop`,
    log: { error() {} },
  });
  return { store, handler };
}

const BOARD = { sections: [{ id: 's', title: 'Act I', scenes: [{ id: 'e1', number: 1, title: 'Opening', summary: 'x', characters: [] }] }], characters: [], locations: [] };
const SCRIPT = { scenes: [{ id: 'e1', title: 'Opening', blocks: [{ type: 'scene', text: 'INT. BAR - NIGHT' }] }] };
const create = (handler, over = {}, user = 'ana') =>
  handler(post({ event: 'create', storyId: 'story_1', scope: 'both', title: 'My Story', snapshot: { v: 1, board: BOARD, script: SCRIPT }, ...over }, as(user)));

test('callerOf lê o login do authorizer (REST e HTTP API)', () => {
  assert.equal(callerOf({ requestContext: as('ana') }), 'ana');
  assert.equal(callerOf({ requestContext: { authorizer: { jwt: { claims: { 'cognito:username': 'google_1' } } } } }), 'google_1');
  assert.equal(callerOf({ requestContext: {} }), null);
  assert.equal(callerOf({}), null);
});

test('create guarda o retrato e a ficha do dono; get devolve só o que o leitor precisa', async () => {
  const { store, handler } = setup();
  const made = parse(await create(handler));
  assert.equal(made.status, 200);
  assert.deepEqual(made.body, { token: 'tok_0001_abcdefghijklmnop', storyId: 'story_1', scope: 'both', title: 'My Story', createdAt: '2026-11-17T12:00:00.000Z' });
  assert.ok(store.map.has('shares/tok_0001_abcdefghijklmnop.json'));
  assert.ok(store.map.has('owners/ana/story_1/tok_0001_abcdefghijklmnop.json'));

  // Sem login: o link é público por padrão.
  const got = parse(await handler(post({ event: 'get', token: made.body.token })));
  assert.equal(got.status, 200);
  assert.deepEqual(got.body.snapshot, { v: 1, board: BOARD, script: SCRIPT });
  assert.equal(got.body.title, 'My Story');
  assert.equal(got.body.scope, 'both');
  assert.equal('ownerId' in got.body, false);
  assert.equal('storyId' in got.body, false);
});

test('o escopo é respeitado no servidor: nada fora dele é guardado', async () => {
  const { handler } = setup();
  const board = parse(await create(handler, { scope: 'board' }));
  const script = parse(await create(handler, { scope: 'script' }));
  const b = parse(await handler(post({ event: 'get', token: board.body.token })));
  const s = parse(await handler(post({ event: 'get', token: script.body.token })));
  assert.deepEqual(Object.keys(b.body.snapshot).sort(), ['board', 'v']);
  assert.deepEqual(Object.keys(s.body.snapshot).sort(), ['script', 'v']);
});

test('create recusa: sem login, escopo inválido, retrato que não bate com o escopo, grande demais', async () => {
  const { handler } = setup({ MAX_BYTES: '200' });
  assert.equal(parse(await handler(post({ event: 'create', storyId: 's', scope: 'board', snapshot: { board: BOARD } }))).status, 401);
  assert.equal(parse(await create(handler, { scope: 'everything' })).status, 400);
  assert.equal(parse(await create(handler, { scope: 'script', snapshot: { v: 1, board: BOARD } })).status, 400);
  assert.equal(parse(await create(handler, { storyId: '' })).status, 400);
  assert.equal(parse(await create(handler, { snapshot: { v: 1, board: { ...BOARD, pad: 'x'.repeat(500) }, script: SCRIPT } })).status, 413);
});

test('teto de links por história', async () => {
  const { handler } = setup({ MAX_LINKS_PER_STORY: '2' });
  assert.equal(parse(await create(handler)).status, 200);
  assert.equal(parse(await create(handler)).status, 200);
  assert.equal(parse(await create(handler)).status, 409);
  // Outra história do mesmo dono não é afetada.
  assert.equal(parse(await create(handler, { storyId: 'story_2' })).status, 200);
});

test('list devolve só os links de quem chama, do mais novo ao mais antigo, com filtro por história', async () => {
  const { handler } = setup();
  await create(handler);
  await create(handler, { storyId: 'story_2', scope: 'board' });
  await create(handler, {}, 'bia');
  const mine = parse(await handler(post({ event: 'list' }, as('ana'))));
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.links.map((l) => l.storyId).sort(), ['story_1', 'story_2']);
  const one = parse(await handler(post({ event: 'list', storyId: 'story_2' }, as('ana'))));
  assert.deepEqual(one.body.links.map((l) => l.scope), ['board']);
  assert.equal(parse(await handler(post({ event: 'list' }))).status, 401);
});

test('revoke: só o dono; depois o link responde 404 e some da lista', async () => {
  const { store, handler } = setup();
  const made = parse(await create(handler));
  const token = made.body.token;
  assert.equal(parse(await handler(post({ event: 'revoke', token }, as('bia')))).status, 403);
  assert.equal(parse(await handler(post({ event: 'revoke', token }))).status, 401);
  assert.equal(parse(await handler(post({ event: 'get', token }))).status, 200);

  assert.deepEqual(parse(await handler(post({ event: 'revoke', token }, as('ana')))).body, { revoked: true, token });
  assert.equal(store.map.size, 0);
  assert.equal(parse(await handler(post({ event: 'get', token }))).status, 404);
  assert.deepEqual(parse(await handler(post({ event: 'list' }, as('ana')))).body.links, []);
  assert.equal(parse(await handler(post({ event: 'revoke', token }, as('ana')))).status, 404);
});

test('get: token malformado ou desconhecido → 404; REQUIRE_LOGIN exige login', async () => {
  const open = setup();
  assert.equal(parse(await open.handler(post({ event: 'get', token: '../shares/x' }))).status, 404);
  assert.equal(parse(await open.handler(post({ event: 'get', token: 'tok_9999_abcdefghijklmnop' }))).status, 404);

  const closed = setup({ REQUIRE_LOGIN: 'true' });
  const made = parse(await create(closed.handler));
  assert.equal(parse(await closed.handler(post({ event: 'get', token: made.body.token }))).status, 401);
  assert.equal(parse(await closed.handler(post({ event: 'get', token: made.body.token }, as('bia')))).status, 200);
});

test('CORS, OPTIONS, JSON inválido, evento desconhecido e falha do storage', async () => {
  const { handler } = setup();
  const opt = await handler({ httpMethod: 'OPTIONS' });
  assert.equal(opt.statusCode, 204);
  assert.equal(opt.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(parse(await handler({ httpMethod: 'POST', body: '{nope' })).status, 400);
  assert.equal(parse(await handler(post({ event: 'drop-table' }, as('ana')))).status, 400);

  const broken = createHandler({
    store: { async get() { throw new Error('S3 down'); }, async put() {}, async del() {}, async list() { return []; } },
    env: {}, log: { error() {} },
  });
  const res = parse(await broken(post({ event: 'get', token: 'tok_0001_abcdefghijklmnop' })));
  assert.equal(res.status, 500);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
});

// ---------------------------------------------------------------------------
// Links ao vivo
// ---------------------------------------------------------------------------

const ent = (id, type, over = {}) => ({ id, type, ...over });
/** O que o freeform devolve em list-project-entities: o grafo cru, com tudo que NÃO pode sair. */
const GRAPH = {
  projectId: 'story_1',
  entities: [
    ent('e1', 'event', { working_title: 'Empty crate', summary: 'Voss finds nothing.', evidence_quote: 'PRIVATE quote', open_dimensions: [{ tension: 'PRIVATE tension', why_it_matters: 'PRIVATE why' }] }),
    ent('e2', 'event', { working_title: 'The pier', description: 'Nina watches.' }),
    ent('gone', 'event', { working_title: 'Deleted scene', deleted_at: '2026-11-01T00:00:00Z' }),
    ent('parked', 'event', { working_title: 'Sandbox scene', state: 'parked' }),
    ent('staged', 'event', { working_title: 'Staged scene', staged: '1' }),
    ent('back', 'event', { working_title: 'Backstory scene', narrative_status: 'backstory' }),
    ent('s1', 'sequence', { working_title: 'Act II' }),
    ent('c1', 'character', { working_name: 'Voss', description: 'A tired detective.' }),
  ],
  edges: {
    precedes: [{ from: 'e1', to: 'e2' }], contains: [{ from: 's1', to: 'e2' }], sequence_precedes: [], cross_precedes: [],
    involves: [{ from: 'e1', to: 'c1' }], occurs_in: [],
  },
  peerQuestions: [{ text: 'PRIVATE peer question' }],
  fragments: [{ text: 'PRIVATE sticky' }],
  logs: ['PRIVATE log line'],
};
const PAGES = [
  { eventId: 'e1', html: '<p data-line-type="scene">INT. WAREHOUSE - NIGHT</p><p data-line-type="dialogue">It&#39;s <em>empty</em>.</p>', updatedAt: 'x' },
  { eventId: 'gone', html: '<p data-line-type="scene">INT. DELETED - DAY</p>', updatedAt: 'x' },
];

/** A Lambda do freeform de mentira, com o portão de verdade: um pedido com
 *  requestContext só passa para o dono da história; a chamada direta passa. */
function fakeFreeform({ owners = { story_1: 'ana' }, fail = {} } = {}) {
  const calls = [];
  return {
    calls,
    fail,
    async invoke(event) {
      const body = event.body ? JSON.parse(event.body) : event;
      calls.push({ external: !!event.requestContext, user: event.requestContext?.authorizer?.claims?.['cognito:username'] ?? null, ...body });
      if (event.requestContext) {
        const user = event.requestContext.authorizer?.claims?.['cognito:username'];
        if (!user) return { statusCode: 401, body: { error: 'Unauthorized' } };
        if (owners[body.projectId] !== user) return { statusCode: 403, body: { error: 'Not authorized for this story' } };
      }
      if (fail[body.event] === 'throw') throw new Error('freeform is down');
      if (fail[body.event]) return { statusCode: fail[body.event], body: { error: 'boom' } };
      if (body.event === 'list-project-entities') return { statusCode: 200, body: GRAPH };
      if (body.event === 'list-scene-texts') return { statusCode: 200, body: { projectId: body.projectId, sceneTexts: PAGES } };
      if (body.event === 'get-card-layouts') return { statusCode: 200, body: { layouts: [{ cardId: 'e1', x: 500.4, y: 60 }] } };
      return { statusCode: 400, body: {} };
    },
  };
}
function liveSetup(env = {}, freeformOptions) {
  const store = memoryStore();
  const freeform = fakeFreeform(freeformOptions);
  let n = 0;
  let clock = Date.parse('2026-11-18T12:00:00.000Z');
  const handler = createHandler({
    store, env, freeform,
    now: () => new Date(clock),
    newToken: () => `tok_${String(++n).padStart(4, '0')}_abcdefghijklmnop`,
    log: { error() {} },
  });
  return { store, handler, freeform, tick: (ms) => { clock += ms; } };
}
const createLive = (handler, over = {}, user = 'ana') =>
  handler(post({ event: 'create', mode: 'live', storyId: 'story_1', scope: 'both', title: 'My Story', ...over }, as(user)));
const open = async (handler, token) => parse(await handler(post({ event: 'get', token })));

test('ao vivo desligado (sem a Lambda do freeform configurada): criar responde 501 e nada é guardado', async () => {
  const { store, handler } = setup();
  const res = parse(await createLive(handler));
  assert.equal(res.status, 501);
  assert.equal(store.map.size, 0);
});

test('criar ao vivo: só o dono da história, e quem decide é o portão do freeform, com o login de quem pede', async () => {
  const { store, handler, freeform } = liveSetup();

  // Outra conta nomeando a história da Ana: recusado, nada guardado.
  const stranger = parse(await createLive(handler, {}, 'bia'));
  assert.equal(stranger.status, 403);
  assert.equal(store.map.size, 0);
  assert.deepEqual(freeform.calls, [{ external: true, user: 'bia', event: 'get-card-layouts', projectId: 'story_1', caller: 'share-links' }]);

  const made = parse(await createLive(handler));
  assert.equal(made.status, 200);
  assert.deepEqual(made.body, { token: 'tok_0001_abcdefghijklmnop', storyId: 'story_1', scope: 'both', title: 'My Story', createdAt: '2026-11-18T12:00:00.000Z', mode: 'live' });
  // O registro não guarda nada da história: só de quem é e o que mostrar.
  assert.deepEqual(JSON.parse(store.map.get('shares/tok_0001_abcdefghijklmnop.json')), { v: 1, ownerId: 'ana', ...made.body });
  assert.equal(freeform.calls[1].external, true);
  assert.equal(freeform.calls[1].user, 'ana');

  // Sem login não há link ao vivo, e o freeform nem é consultado.
  const before = freeform.calls.length;
  assert.equal(parse(await handler(post({ event: 'create', mode: 'live', storyId: 'story_1', scope: 'board', title: 't' }))).status, 401);
  assert.equal(freeform.calls.length, before);
});

test('abrir ao vivo: lê a história agora e monta o retrato aqui, com o filtro; nada cru sai', async () => {
  const { handler, freeform } = liveSetup();
  const { body: link } = parse(await createLive(handler));
  freeform.calls.length = 0;

  const got = await open(handler, link.token);
  assert.equal(got.status, 200);
  assert.equal(got.body.mode, 'live');
  assert.equal(got.body.asOf, '2026-11-18T12:00:00.000Z');
  assert.equal(got.body.title, 'My Story');
  assert.equal('ownerId' in got.body, false);
  assert.equal('storyId' in got.body, false);

  // A leitura é interna (sem requestContext), só as três leituras, com o dono do registro.
  assert.deepEqual(freeform.calls.map((c) => [c.external, c.event, c.projectId, c.caller, c.userId ?? null]).sort(), [
    [false, 'get-card-layouts', 'story_1', 'share-links', 'ana'],
    [false, 'list-project-entities', 'story_1', 'share-links', null],
    [false, 'list-scene-texts', 'story_1', 'share-links', null],
  ]);

  const { board, script } = got.body.snapshot;
  assert.deepEqual(board.sections.map((s) => [s.title, s.scenes.map((x) => `${x.number}:${x.title}`)]), [['', ['1:Empty crate']], ['Act II', ['2:The pier']]]);
  assert.deepEqual(board.characters, [{ id: 'c1', name: 'Voss', description: 'A tired detective.', scenes: 1 }]);
  // O card que o dono moveu está onde ele o deixou; o outro, no auto-layout.
  assert.deepEqual(board.canvas.cards.find((c) => c.id === 'e1'), { id: 'e1', kind: 'scene', x: 500, y: 60 });
  assert.ok(Number.isFinite(board.canvas.cards.find((c) => c.id === 'e2').y));
  assert.deepEqual(script.scenes, [{ id: 'e1', title: 'Empty crate', number: 1, blocks: [{ type: 'scene', text: 'INT. WAREHOUSE - NIGHT' }, { type: 'dialogue', text: "It's empty." }] }]);
  // Lixeira, sandbox, não aceitas, backstory e as ferramentas do roteirista ficam no servidor.
  assert.doesNotMatch(JSON.stringify(got.body), /PRIVATE|Deleted scene|Sandbox scene|Staged scene|Backstory scene|INT\. DELETED|evidence_quote|open_dimensions|logs/);
});

test('ao vivo: o escopo decide o que é lido', async () => {
  const { handler, freeform } = liveSetup();
  const board = parse(await createLive(handler, { scope: 'board' })).body.token;
  const script = parse(await createLive(handler, { scope: 'script' })).body.token;

  freeform.calls.length = 0;
  const b = await open(handler, board);
  assert.deepEqual(Object.keys(b.body.snapshot).sort(), ['board', 'v']);
  assert.deepEqual(freeform.calls.map((c) => c.event).sort(), ['get-card-layouts', 'list-project-entities']);

  freeform.calls.length = 0;
  const s = await open(handler, script);
  assert.deepEqual(Object.keys(s.body.snapshot).sort(), ['script', 'v']);
  assert.deepEqual(freeform.calls.map((c) => c.event).sort(), ['list-project-entities', 'list-scene-texts']);
});

test('ao vivo: várias aberturas seguidas reaproveitam a última leitura; passado o prazo, relê', async () => {
  const { handler, freeform, tick } = liveSetup();
  const { token } = parse(await createLive(handler)).body;
  freeform.calls.length = 0;

  await open(handler, token);
  const afterFirst = freeform.calls.length;
  tick(29_000);
  const cached = await open(handler, token);
  assert.equal(freeform.calls.length, afterFirst);
  assert.equal(cached.body.asOf, '2026-11-18T12:00:00.000Z'); // diz de quando é a leitura

  tick(2_000);
  const fresh = await open(handler, token);
  assert.equal(freeform.calls.length, afterFirst * 2);
  assert.equal(fresh.body.asOf, '2026-11-18T12:00:31.000Z');

  // LIVE_CACHE_SECONDS=0: toda abertura lê.
  const direct = liveSetup({ LIVE_CACHE_SECONDS: '0' });
  const t = parse(await createLive(direct.handler)).body.token;
  direct.freeform.calls.length = 0;
  await open(direct.handler, t);
  await open(direct.handler, t);
  assert.equal(direct.freeform.calls.length, 6);
});

test('ao vivo: revogar derruba o link na hora, mesmo com uma leitura recente guardada; a lista diz quais são ao vivo', async () => {
  const { handler } = liveSetup();
  const { token } = parse(await createLive(handler)).body;
  await create(handler); // um de retrato, na mesma história
  assert.equal((await open(handler, token)).status, 200);

  const listed = parse(await handler(post({ event: 'list', storyId: 'story_1' }, as('ana'))));
  assert.deepEqual(listed.body.links.map((l) => l.mode ?? 'snapshot').sort(), ['live', 'snapshot']);

  assert.equal(parse(await handler(post({ event: 'revoke', token }, as('bia')))).status, 403);
  assert.equal(parse(await handler(post({ event: 'revoke', token }, as('ana')))).status, 200);
  assert.equal((await open(handler, token)).status, 404);
});

test('ao vivo: quando o freeform falha o link responde 502 (e tenta de novo na próxima); sem as posições o palco sai no auto-layout', async () => {
  const { handler, freeform } = liveSetup();
  const { token } = parse(await createLive(handler)).body;

  freeform.fail['list-project-entities'] = 'throw';
  const down = await open(handler, token);
  assert.equal(down.status, 502);
  assert.equal(down.body.error, 'The story could not be read right now. Try again in a moment.');
  freeform.fail['list-project-entities'] = 500;
  assert.equal((await open(handler, token)).status, 502);
  delete freeform.fail['list-project-entities'];

  freeform.fail['get-card-layouts'] = 500;
  const noLayouts = await open(handler, token);
  assert.equal(noLayouts.status, 200);
  const crate = noLayouts.body.snapshot.board.canvas.cards.find((c) => c.id === 'e1');
  assert.notDeepEqual([crate.x, crate.y], [500, 60]);
  assert.ok(Number.isFinite(crate.x) && Number.isFinite(crate.y));
});

test('criar ao vivo: se o freeform não responde, o link não é criado (502); o teto de links vale; REQUIRE_LOGIN vale ao abrir', async () => {
  const broken = liveSetup({}, { fail: { 'get-card-layouts': 'throw' } });
  assert.equal(parse(await createLive(broken.handler)).status, 502);
  assert.equal(broken.store.map.size, 0);

  const capped = liveSetup({ MAX_LINKS_PER_STORY: '1', REQUIRE_LOGIN: 'true' });
  const { token } = parse(await createLive(capped.handler)).body;
  assert.equal(parse(await createLive(capped.handler)).status, 409);
  assert.equal((await open(capped.handler, token)).status, 401);
  assert.equal(parse(await capped.handler(post({ event: 'get', token }, as('bia')))).status, 200);
});
