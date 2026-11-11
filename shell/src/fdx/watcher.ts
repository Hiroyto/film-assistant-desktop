// Cowork de roteiro (SOMENTE LEITURA). Observa um arquivo Final Draft (.fdx) ou
// Fountain (.fountain) editado por OUTRO app e faz push para o renderer a cada save.
//
// - chokidar com awaitWriteFinish: só dispara quando o arquivo ESTABILIZA, o que
//   cobre save em curso e save atômico (temp -> rename) sem debounce manual.
// - .fdx: parse puro em ./parse (fast-xml-parser; imune a XXE), cenas prontas.
// - .fountain: o parser vive só no renderer (src/lib/fountain.ts); daqui sai o
//   texto cru (`source`) e o renderer monta as cenas (src/lib/fountainCowork.ts).
// - "Tempo real" = a cada SAVE do outro app (granularidade de disco), não por tecla.
import { dialog, ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder } from 'util';
import { watch, FSWatcher } from 'chokidar';
import { IPC, FdxPayload } from '../ipc/channels';
import { sendToRenderer } from '../ipc/bridge';
import { parseFdx } from './parse';

let watcher: FSWatcher | null = null;
let watchedPath: string | null = null;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Extensões que o cowork observa. */
const SCREENPLAY_EXT = /[.](fdx|fountain)$/i;
const isFountainPath = (filePath: string): boolean => /[.]fountain$/i.test(filePath);

const emptyPayload = (filePath: string): FdxPayload => ({
  path: filePath,
  fileName: path.basename(filePath),
  ok: false,
  sceneCount: 0,
  paragraphCount: 0,
  scenes: [],
  fullText: '',
  updatedAt: new Date().toISOString(),
});

/** Bytes de um arquivo de texto -> string: UTF-8, UTF-16 com BOM (o "Unicode"
 *  do Bloco de Notas) ou Windows-1252 quando não é UTF-8 válido.
 *  ESPELHO de decodeScriptBytes (src/lib/fountain.ts), que o import one-shot usa. */
export function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/** Lê um .fountain e manda o TEXTO: quem parseia é o renderer. Texto puro não
 *  tem marca de "arquivo completo" como o XML do .fdx; o que dá para ver é o
 *  arquivo VAZIO de um save em curso (truncar -> escrever). Sem esta guarda, um
 *  snapshot vazio marcaria todas as cenas do board como "missing". */
async function readFountain(filePath: string, tries = 3): Promise<FdxPayload> {
  const base: FdxPayload = { ...emptyPayload(filePath), format: 'fountain' };
  for (let t = 0; t < tries; t++) {
    let buf: Buffer;
    try {
      buf = await fs.promises.readFile(filePath);
    } catch (e) {
      return { ...base, error: `read failed: ${(e as Error).message}` };
    }
    const source = decodeText(buf);
    if (!source.trim()) {
      if (t < tries - 1) { await delay(120); continue; }
      return { ...base, error: 'the file is empty (mid-save?)' };
    }
    return { ...base, ok: true, source, updatedAt: new Date().toISOString() };
  }
  return base;
}

/** Lê o roteiro observado no formato dele (pela extensão). */
function readScreenplay(filePath: string): Promise<FdxPayload> {
  return isFountainPath(filePath) ? readFountain(filePath) : readFdx(filePath);
}

/** Lê + parseia; retry curto se o XML parecer incompleto (save em curso). */
async function readFdx(filePath: string, tries = 3): Promise<FdxPayload> {
  const base: FdxPayload = { ...emptyPayload(filePath), format: 'fdx' };
  for (let t = 0; t < tries; t++) {
    let xml: string;
    try {
      xml = await fs.promises.readFile(filePath, 'utf8');
    } catch (e) {
      return { ...base, error: `read failed: ${(e as Error).message}` };
    }
    if (!/<FinalDraft\b[\s\S]*<\/FinalDraft>/i.test(xml)) {
      if (t < tries - 1) { await delay(120); continue; }
      return { ...base, error: 'incomplete .fdx file (mid-write?)' };
    }
    try {
      const { title, scenes, paragraphCount, fullText } = parseFdx(xml);
      return {
        ...base,
        ok: true,
        title,
        scenes,
        sceneCount: scenes.length,
        paragraphCount,
        fullText,
        updatedAt: new Date().toISOString(),
      };
    } catch (e) {
      if (t < tries - 1) { await delay(120); continue; }
      return { ...base, error: `parse failed: ${(e as Error).message}` };
    }
  }
  return base;
}

function startWatch(filePath: string, getWindow: () => BrowserWindow | null): void {
  stopWatch();
  watchedPath = filePath;
  watcher = watch(filePath, {
    ignoreInitial: true, // a leitura inicial vai no fdx:open / fdx:watch
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  const push = async (): Promise<void> => {
    if (!watchedPath) return;
    sendToRenderer(getWindow(), IPC.FDX_CHANGED, await readScreenplay(watchedPath));
  };
  watcher.on('change', () => void push());
  watcher.on('add', () => void push()); // reaparecimento após rename atômico
  watcher.on('error', (e) => console.error('[fdx] watcher erro', e));
  console.log('[fdx] observando', filePath);
}

export function stopWatch(): void {
  if (watcher) { void watcher.close(); watcher = null; }
  watchedPath = null;
}

/** Registra os handlers IPC do cowork (.fdx / .fountain). Chamar uma vez no boot do main. */
export function registerFdx(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.FDX_OPEN, async (): Promise<FdxPayload | null> => {
    const win = getWindow();
    const opts: Electron.OpenDialogOptions = {
      title: 'Open a screenplay (.fdx or .fountain)',
      filters: [
        { name: 'Screenplays', extensions: ['fdx', 'fountain'] },
        { name: 'Final Draft', extensions: ['fdx'] },
        { name: 'Fountain', extensions: ['fountain'] },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || res.filePaths.length === 0) return null;
    const filePath = res.filePaths[0];
    startWatch(filePath, getWindow);
    return readScreenplay(filePath); // leitura inicial imediata
  });

  // Reconexão sem diálogo: o renderer guarda o caminho do arquivo por story e,
  // ao reabrir o app (ou voltar à story), pede para observar o MESMO arquivo.
  // null = o arquivo não está mais lá (movido/apagado/outra máquina); o
  // renderer oferece escolher de novo.
  ipcMain.handle(IPC.FDX_WATCH, async (_event, args: { path?: string } | undefined): Promise<FdxPayload | null> => {
    const filePath = String(args?.path ?? '');
    if (!filePath || !SCREENPLAY_EXT.test(filePath)) return null;
    try {
      if (!(await fs.promises.stat(filePath)).isFile()) return null;
    } catch {
      return null;
    }
    startWatch(filePath, getWindow);
    return readScreenplay(filePath);
  });

  ipcMain.handle(IPC.FDX_CLOSE, async (): Promise<void> => {
    stopWatch();
  });
}
