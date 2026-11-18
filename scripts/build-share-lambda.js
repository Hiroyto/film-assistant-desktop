// Gera backend/share-links/snapshot.mjs: o construtor do retrato de um link
// compartilhado, para rodar na Lambda (links AO VIVO).
//
// A Lambda não pode ter a sua própria versão dessa lógica: é ela que decide o
// que sai da história para um link público, e é a ordem/o layout do board que
// o preview mostra. Então o arquivo é montado a partir do código do app:
//   - as constantes de medida do board   (corkboard/constants.tsx)
//   - a ordem contada e o auto-layout    (corkboard/connectors.tsx)
//   - o retrato                           (lib/shareSnapshot.ts, inteiro)
// e só tem os tipos removidos (o compilador do TypeScript faz isso). Nada é
// reescrito à mão.
//
//   npm run share:lambda        gera o arquivo
//   (o teste src/lib/shareSnapshotLambda.test.ts falha se ele estiver velho)
//
// Depois de gerar, a Lambda precisa ser publicada de novo com o arquivo novo.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'backend', 'share-links', 'snapshot.mjs');
const CONSTANTS = 'src/components/Freeform/corkboard/constants.tsx';
const CONNECTORS = 'src/components/Freeform/corkboard/connectors.tsx';
const SNAPSHOT = 'src/lib/shareSnapshot.ts';
/** As medidas que as funções abaixo usam. */
const CONSTANT_NAMES = ['COLLAPSED_W', 'COLLAPSED_H', 'REL_COLLAPSED_W', 'REL_COLLAPSED_H', 'CHAR_PILL_W', 'CHAR_PILL_H', 'EVENT_CARD_W', 'COL_GAP', 'ROW_GAP', 'CANVAS_PAD'];
/** A ordem contada e o auto-layout (as três que o retrato importa, e a que elas chamam). */
const FUNCTION_NAMES = ['topoSortEventsByPrecedes', 'orderSpineUnits', 'toldOrderEvents', 'computeAutoLayout'];

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const parse = (rel) => ts.createSourceFile(rel, read(rel), ts.ScriptTarget.ES2020, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** As declarações de topo com esses nomes, com os seus comentários, na ordem pedida. */
function pick(rel, names, kind) {
  const file = parse(rel);
  const found = new Map();
  for (const node of file.statements) {
    if (kind === 'function' && ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      found.set(node.name.text, node.getFullText(file).trim());
    }
    if (kind === 'const' && ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && names.includes(d.name.text)) found.set(d.name.text, node.getText(file));
      }
    }
  }
  const missing = names.filter((n) => !found.has(n));
  if (missing.length) throw new Error(`${rel}: não achei ${missing.join(', ')} (o arquivo mudou; atualize scripts/build-share-lambda.js)`);
  return names.map((n) => found.get(n));
}

/** O arquivo sem os imports: o que ele importava está acima dele no arquivo gerado. */
function body(rel) {
  const file = parse(rel);
  return file.statements.filter((n) => !ts.isImportDeclaration(n)).map((n) => n.getFullText(file)).join('').trim();
}

function generate() {
  const source = [
    ...pick(CONSTANTS, CONSTANT_NAMES, 'const'),
    '',
    ...pick(CONNECTORS, FUNCTION_NAMES, 'function'),
    '',
    body(SNAPSHOT),
  ].join('\n');
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, removeComments: false, newLine: ts.NewLineKind.LineFeed },
    fileName: 'snapshot.ts',
  }).outputText;
  const header = [
    '// GERADO por scripts/build-share-lambda.js (npm run share:lambda). NÃO EDITE.',
    '//',
    '// O construtor do retrato de um link compartilhado, para a Lambda de share',
    '// (links ao vivo). É o código do app sem os tipos:',
    `//   ${CONSTANTS}   (medidas do board)`,
    `//   ${CONNECTORS}  (ordem contada e auto-layout)`,
    `//   ${SNAPSHOT}                            (o retrato)`,
    '// Mudou um deles? Gere de novo e publique a Lambda outra vez.',
    '',
  ].join('\n');
  return `${header}${js.trim()}\n`;
}

module.exports = { generate, OUT };

if (require.main === module) {
  const text = generate();
  fs.writeFileSync(OUT, text);
  console.log(`ok ${path.relative(ROOT, OUT)} (${text.split('\n').length} linhas)`);
}
