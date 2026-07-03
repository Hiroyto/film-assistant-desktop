// Servidor estático da suíte de paridade (Tarefa 17/19 — habilitação de runtime).
//
// Serve o build/ do renderer (CRA) sobre HTTP para que:
//   1. o Electron em modo teste carregue o renderer via ELECTRON_START_URL (o main.ts,
//      desempacotado, já cai no branch isDev=true → loadURL(ELECTRON_START_URL));
//   2. page.goto('/?screen=…&fixture=…') dos specs resolva contra um baseURL http.
//
// Sem dependência externa além de express (já presente no projeto). Porta via env PORT
// (default 3100). Fallback SPA para robustez (as rotas do CRA são todas '/').
const path = require('path');
const express = require('express');

const PORT = Number(process.env.PORT) || 3100;
const BUILD_DIR = path.join(__dirname, '..', 'build');

const app = express();
app.use(express.static(BUILD_DIR));
// SPA fallback — funciona em express 4 e 5 (evita o pattern '*' que quebra no 5).
app.use((_req, res) => res.sendFile(path.join(BUILD_DIR, 'index.html')));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[parity static-server] serving ${BUILD_DIR} at http://localhost:${PORT}`);
});
