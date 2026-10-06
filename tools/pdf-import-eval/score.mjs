// Score PDF import against FDX truth: LCS over (type, text) blocks.
import fs from 'fs'; import path from 'path'; import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const repo = process.cwd();
require(repo + '/node_modules/sucrase/register/ts');
const { pagesFromPdf } = require(repo + '/src/lib/pdfText.ts');
const sp = require(repo + '/src/lib/screenplayParse.ts');
const pdfjs = await import(repo + '/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
const dir = process.argv[2];
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
function lcs(a, b) {
  const m = a.length, n = b.length; let prev = new Uint16Array(n + 1), cur = new Uint16Array(n + 1);
  for (let i = 1; i <= m; i++) { for (let j = 1; j <= n; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]); [prev, cur] = [cur, prev]; }
  return prev[n];
}
const variants = ['fdstyle', 'word', 'docs0', 'docs0-untagged', 'docsblank'];
const tot = Object.fromEntries(variants.map((v) => [v, { truth: 0, got: 0, typed: 0, seg: 0 }]));
const rows = [];
for (const tf of fs.readdirSync(dir).filter((f) => f.endsWith('.truth.json'))) {
  const name = tf.replace('.truth.json', '');
  const truth = JSON.parse(fs.readFileSync(path.join(dir, tf), 'utf8')).filter((b) => norm(b.text));
  const row = [name.padEnd(24)];
  for (const v of variants) {
    const f = path.join(dir, `${name}.${v}.pdf`);
    if (!fs.existsSync(f)) { row.push('-'); continue; }
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), disableFontFace: true, verbosity: 0 }).promise;
    const text = sp.pdfPagesToIndentedText(await pagesFromPdf(pdf));
    const got = sp.repairScriptBlocks(sp.classifyScriptText(text)).filter((b) => norm(b.text) && !/^\(?more\)?$/i.test(b.text));
    if (process.env.DUMP === name + '.' + v) fs.writeFileSync(path.join(dir, `${name}.${v}.txt`), text);
    const typed = lcs(truth.map((b) => b.type + '|' + norm(b.text)), got.map((b) => b.type + '|' + norm(b.text)));
    const seg = lcs(truth.map((b) => norm(b.text)), got.map((b) => norm(b.text)));
    const t = tot[v]; t.truth += truth.length; t.got += got.length; t.typed += typed; t.seg += seg;
    row.push(`${(100 * typed / truth.length).toFixed(0).padStart(3)}%`);
  }
  rows.push(row.join(' '));
}
console.log(''.padEnd(24), variants.map((v) => v.padStart(4)).join(' '));
rows.forEach((r) => console.log(r));
console.log('\nTOTAL (blocks exactly right, type + text) / (paragraph boundaries right, text only):');
for (const v of variants) { const t = tot[v]; console.log(`  ${v.padEnd(15)} typed ${(100 * t.typed / t.truth).toFixed(1)}%   paragraphs ${(100 * t.seg / t.truth).toFixed(1)}%   (truth ${t.truth}, got ${t.got})`); }
