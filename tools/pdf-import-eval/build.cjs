// Ground truth = FDX blocks. Render each script as HTML in several house
// styles, print with headless Chrome (tagged and untagged), plus our jsPDF
// export. Writes <name>.<variant>.pdf and <name>.truth.json.
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom'); global.DOMParser = new JSDOM('').window.DOMParser;
const ex = require(path.resolve('src/lib/screenplayExport.ts'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out = process.argv[2]; const files = process.argv.slice(3);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
// Element geometry from the left margin (in), as a Word/Docs screenplay template sets it.
const IND = { scene: [0, 6], description: [0, 6], character: [2.2, 3.8], parenthetical: [1.6, 2.3], dialogue: [1.0, 3.5], transition: [4.0, 2.0] };
const STYLES = {
  // Word default Normal: 1.08 spacing, 8pt after every paragraph.
  word: { lh: '1.08', after: (t) => '8pt', blankLines: false },
  // Docs, writer pressed Enter once: no paragraph spacing at all.
  docs0: { lh: '1.15', after: () => '0', blankLines: false },
  // Docs, writer typed an empty line between elements (classic manual formatting).
  docsblank: { lh: '1.15', after: () => '0', blankLines: true },
};
function html(blocks, st) {
  const caps = (b) => ['scene', 'character', 'transition'].includes(b.type) ? b.text.toUpperCase() : b.text;
  const titles = blocks.filter((b) => b.type === 'title');
  const body = blocks.filter((b) => b.type !== 'title');
  let h = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: letter; margin: 1in 1in 1in 1.5in; }
body { margin: 0; font: 12pt/${st.lh} "Courier New", Courier, monospace; }
p { margin: 0 0 ${st.after()} 0; white-space: normal; }
.title { text-align: center; } .tp { break-after: page; padding-top: 3in; }
</style></head><body>`;
  if (titles.length) h += `<div class="tp">${titles.map((t) => `<p class="title">${esc(t.text)}</p>`).join('')}</div>`;
  let prev = null;
  for (const b of body) {
    const [l, w] = IND[b.type] ?? IND.description;
    const needsBlank = prev && !['dialogue', 'parenthetical'].includes(b.type);
    if (st.blankLines && needsBlank) h += `<p>&nbsp;</p>`;
    const align = b.type === 'transition' ? 'text-align:right;' : '';
    h += `<p style="margin-left:${l}in;width:${w}in;${align}">${esc(caps(b))}</p>`;
    prev = b.type;
  }
  return h + '</body></html>';
}
(async () => {
  for (const f of files) {
    const name = path.basename(f, '.fdx').replace(/[^A-Za-z0-9]+/g, '_');
    const blocks = ex.fdxToBlocks(fs.readFileSync(f, 'utf8'));
    fs.writeFileSync(path.join(out, `${name}.truth.json`), JSON.stringify(blocks));
    for (const [v, st] of Object.entries(STYLES)) {
      const hp = path.join(out, `${name}.${v}.html`);
      fs.writeFileSync(hp, html(blocks, st));
      for (const tagged of v === 'docs0' ? [true, false] : [true]) {
        const pdf = path.join(out, `${name}.${v}${tagged ? '' : '-untagged'}.pdf`);
        execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-pdf-header-footer', ...(tagged ? [] : ['--disable-pdf-tagging']), `--print-to-pdf=${pdf}`, 'file://' + hp], { stdio: 'ignore' });
      }
    }
    const doc = await ex.buildScreenplayPdf(blocks, name);
    fs.writeFileSync(path.join(out, `${name}.fdstyle.pdf`), Buffer.from(doc.output('arraybuffer')));
    console.log('built', name, blocks.length, 'blocks');
  }
})();
