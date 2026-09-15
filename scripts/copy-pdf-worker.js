// Copia o worker do pdf.js (versão EXATA instalada) para public/, de onde o CRA o
// leva para build/. O renderer o carrega de `${PUBLIC_URL}/pdf.worker.min.mjs`
// (src/lib/pdfText.ts) em vez de um CDN: código remoto no renderer do desktop
// teria acesso a window.electronAPI, e a CSP (script-src 'self') o bloquearia.
// Chamado pelo craco.config.js em todo `craco start|build`. O arquivo gerado é
// gitignored (é derivado de node_modules).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs');
const DEST = path.join(ROOT, 'public', 'pdf.worker.min.mjs');

function copyPdfWorker() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`[pdf-worker] não encontrado: ${SRC} — rode npm install`);
  }
  const same =
    fs.existsSync(DEST) && fs.statSync(DEST).size === fs.statSync(SRC).size && fs.readFileSync(DEST).equals(fs.readFileSync(SRC));
  if (!same) {
    fs.copyFileSync(SRC, DEST);
    console.log(`[pdf-worker] copiado para ${path.relative(ROOT, DEST)}`);
  }
  return DEST;
}

module.exports = { copyPdfWorker };

if (require.main === module) copyPdfWorker();
