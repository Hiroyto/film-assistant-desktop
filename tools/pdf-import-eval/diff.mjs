import fs from 'fs'; import path from 'path'; import { createRequire } from 'module';
const require = createRequire(import.meta.url); const repo = process.cwd();
require(repo + '/node_modules/sucrase/register/ts');
const { pagesFromPdf } = require(repo + '/src/lib/pdfText.ts'); const sp = require(repo + '/src/lib/screenplayParse.ts');
const pdfjs = await import(repo + '/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
const [dir, name, v, limit = 30] = process.argv.slice(2);
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
const truth = JSON.parse(fs.readFileSync(path.join(dir, `${name}.truth.json`), 'utf8')).filter((b) => norm(b.text));
const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, `${name}.${v}.pdf`))), disableFontFace: true, verbosity: 0 }).promise;
const got = sp.repairScriptBlocks(sp.classifyScriptText(sp.pdfPagesToIndentedText(await pagesFromPdf(pdf)))).filter((b) => norm(b.text) && !/^\(?more\)?$/i.test(b.text));
const A = truth.map((b) => b.type + '|' + norm(b.text)), B = got.map((b) => b.type + '|' + norm(b.text));
const m = A.length, n = B.length; const L = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
let i = 0, j = 0, shown = 0; const cats = {};
while ((i < m || j < n) && shown < +limit) {
  if (i < m && j < n && A[i] === B[j]) { i++; j++; continue; }
  const tw = [], gw = [];
  while (i < m && (j >= n || L[i + 1][j] >= L[i][j + 1]) && !(j < n && A[i] === B[j])) { tw.push(truth[i++]); if (tw.length > 6) break; }
  while (j < n && (i >= m || L[i][j + 1] > L[i + 1][j]) && !(i < m && A[i] === B[j])) { gw.push(got[j++]); if (gw.length > 6) break; }
  if (!tw.length && !gw.length) { i++; j++; continue; }
  const k = `${tw.map((b) => b.type).join('+')} -> ${gw.map((b) => b.type).join('+')}`; cats[k] = (cats[k] || 0) + 1;
  if (shown++ < +limit) console.log('TRUTH', tw.map((b) => `[${b.type}] ${b.text.slice(0, 70)}`).join('\n      '), '\nGOT  ', gw.map((b) => `[${b.type}] ${b.text.slice(0, 70)}`).join('\n      '), '\n');
}
console.log(Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 15));
