// O retrato que roda nos dois lados (app e Lambda de share). Aqui: o leitor de
// HTML sem DOM (o do servidor) tem de dar o mesmo que o do app, e o arquivo
// gerado para a Lambda tem de ser este código, em dia. `craco test`.
import fs from 'fs';
import ts from 'typescript';
import { blocksFromScreenplayHtml } from './screenplayExport';
import { blocksFromHtmlText, buildShareSnapshot, buildSharedScript, type ShareGraph } from './shareSnapshot';
import type { ProjectEntity } from './freeformApi';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const lambdaBuild = require('../../scripts/build-share-lambda') as { generate: () => string; OUT: string };

const ent = (id: string, type: ProjectEntity['type'], over: Partial<ProjectEntity> = {}): ProjectEntity => ({ id, type, ...over });
const p = (type: string, text: string): string => `<p data-line-type="${type}">${text}</p>`;

/** Uma história com tudo que o retrato trata: solta + sequências, relação,
 *  cores, sub-eventos, e o que tem de ficar de fora. */
function story(): ShareGraph {
  const pair = (from: string, to: string) => ({ from, to });
  return {
    entities: [
      ent('e1', 'event', { working_title: 'Empty crate', summary: 'Voss finds nothing.', int_ext: 'INT', sub_events: [{ slugline: 'The crowbar', description: 'Nail by nail.' }], evidence_quote: 'PRIVATE' }),
      ent('e2', 'event', { working_title: 'The courier', card_color: '#4d7c0f' }),
      ent('e3', 'event', { working_title: 'The pier', description: 'Nina watches.' }),
      ent('e4', 'event', { working_title: 'The chase' }),
      ent('e5', 'event', { working_title: 'Low tide' }),
      ent('gone', 'event', { working_title: 'Deleted', deleted_at: '2026-11-01T00:00:00Z' }),
      ent('parked', 'event', { working_title: 'Parked', state: 'parked' }),
      ent('staged', 'event', { working_title: 'Staged', staged: '1' }),
      ent('back', 'event', { working_title: 'Backstory', narrative_status: 'backstory' }),
      ent('s1', 'sequence', { working_title: 'Act II', summary: 'The net closes.' }),
      ent('s2', 'sequence', { working_title: 'Act III', color: '#b45309' }),
      ent('s3', 'sequence', { working_title: 'Epilogue' }),
      ent('c1', 'character', { working_name: 'Voss', description: 'A tired detective.' }),
      ent('c2', 'character', { working_name: 'Nina' }),
      ent('c3', 'character', { working_name: 'Marrow' }),
      ent('r1', 'relationship', { character_a: 'Voss', character_b: 'Nina', kind: 'works_with' }),
      ent('l1', 'location', { working_name: 'Harbor warehouse' }),
    ],
    edges: {
      precedes: [pair('e1', 'e2'), pair('e3', 'e4')],
      contains: [pair('s1', 'e3'), pair('s1', 'e4'), pair('s2', 'e5')],
      sequence_precedes: [pair('s1', 's2'), pair('s2', 's3')],
      cross_precedes: [pair('e2', 's1')],
      involves: [pair('e1', 'c1'), pair('e3', 'c2'), pair('e4', 'c2'), pair('e4', 'c1'), pair('e5', 'c3')],
      occurs_in: [pair('e1', 'l1')],
    },
  };
}
const TEXTS = [
  { eventId: 'e4', html: p('scene', 'EXT. MARKET - NIGHT') + p('description', 'Nina runs.') },
  { eventId: 'e1', html: p('scene', 'INT. WAREHOUSE - NIGHT') + p('character', 'VOSS') + p('dialogue', 'It&#39;s <em>empty</em>.') },
  { eventId: '__scratch__', html: p('description', 'Loose pages.') },
];

describe('blocksFromHtmlText — o leitor de HTML do servidor', () => {
  const same = (html: string) => expect(blocksFromHtmlText(html)).toEqual(blocksFromScreenplayHtml(html));

  it('dá o mesmo que o leitor do app (pelo DOM) para o que o editor grava', () => {
    same(p('scene', 'INT. WAREHOUSE - NIGHT') + p('character', 'VOSS') + p('parenthetical', '(quiet)') + p('dialogue', 'Empty.') + p('transition', 'CUT TO:'));
    // Entidades, nomeadas e numéricas, e o espaço duro no meio do texto.
    same(p('description', 'Salt &amp; pepper &lt;here&gt; &quot;now&quot; it&#39;s &#x27;fine&#x27; a&nbsp;b &eacute;'));
    // Texto importado: acentos e pontuação tipográfica por nome (maiúscula e minúscula são entidades diferentes).
    same(p('dialogue', '&Ccedil;a va&hellip; &ldquo;A&ccedil;&atilde;o&rdquo; &mdash; n&atilde;o &Eacute; &eacute; &copy; &euro;5'));
    // Marcação dentro da linha, quebras, parágrafos vazios e só de espaço.
    same(p('dialogue', 'It is <strong>very</strong> <em>empty</em>.<br>Truly.') + p('description', '') + p('description', '   ') + p('description', '&nbsp;'));
    // Sem tipo, com outros atributos, aspas simples, maiúsculas, várias linhas.
    same('<p>No type here</p><p class="x" data-line-type=\'scene\' style="margin:0">EXT. PIER - DAY</p><P DATA-LINE-TYPE="dialogue">Shouting</P>\n<p data-line-type="description">Two\nlines</p>');
    same('');
    same('<div>not a paragraph</div>');
  });

  it('uma entidade fora da tabela fica como veio, em vez de sumir', () => {
    expect(blocksFromHtmlText(p('description', 'a &zwnj; b &notanentity; c'))).toEqual([{ type: 'description', text: 'a &zwnj; b &notanentity; c' }]);
  });

  it('é o leitor padrão do retrato: o roteiro sai tipado sem DOM', () => {
    const script = buildSharedScript(story(), TEXTS);
    expect(script.scenes.map((s) => [s.id, s.number, s.sequence])).toEqual([['e1', 1, undefined], ['e4', 4, 'Act II'], ['__scratch__', undefined, undefined]]);
    expect(script.scenes[0].blocks[2]).toEqual({ type: 'dialogue', text: "It's empty." });
  });
});

describe('backend/share-links/snapshot.mjs — o retrato da Lambda', () => {
  const generated = lambdaBuild.generate();

  it('está em dia com o código do app (mudou o retrato, a ordem ou o layout? rode `npm run share:lambda` e publique a Lambda)', () => {
    expect(fs.readFileSync(lambdaBuild.OUT, 'utf8').replace(/\r\n/g, '\n')).toBe(generated);
  });

  it('dá, byte a byte, o mesmo retrato que o app: mesma ordem, mesmo layout, mesmo filtro', () => {
    // O arquivo gerado é um módulo ES; aqui ele roda como CommonJS para o jest.
    const cjs = ts.transpileModule(generated, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const mod: { exports: Record<string, (...args: unknown[]) => unknown> } = { exports: {} };
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', cjs)(mod, mod.exports);

    const layout = { stored: { e2: { x: 980.4, y: 150 }, c3: { x: 60, y: 420 } }, boardWidth: 1400 };
    for (const scope of ['board', 'both', 'script'] as const) {
      const fromApp = buildShareSnapshot(scope, story(), TEXTS, scope === 'script' ? undefined : layout);
      const fromLambda = mod.exports.buildShareSnapshot(scope, story(), TEXTS, scope === 'script' ? undefined : layout);
      expect(JSON.stringify(fromLambda)).toBe(JSON.stringify(fromApp));
    }
    const both = JSON.stringify(mod.exports.buildShareSnapshot('both', story(), TEXTS, layout));
    expect(both).not.toMatch(/PRIVATE|Deleted|Parked|Staged|Backstory/);
    expect(both).toContain('"x":980,"y":150'); // o card movido está onde o dono o deixou
  });
});
