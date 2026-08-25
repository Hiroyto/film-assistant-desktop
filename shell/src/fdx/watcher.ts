// Cowork .fdx (SOMENTE LEITURA). Observa um arquivo Final Draft (.fdx) editado
// por OUTRO app e faz push das cenas parseadas para o renderer a cada save.
//
// - chokidar com awaitWriteFinish: só dispara quando o arquivo ESTABILIZA, o que
//   cobre save em curso e save atômico (temp -> rename) sem debounce manual.
// - parse puro em ./parse (fast-xml-parser; imune a XXE).
// - "Tempo real" = a cada SAVE do outro app (granularidade de disco), não por tecla.
import { dialog, ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { watch, FSWatcher } from 'chokidar';
import { IPC, FdxPayload } from '../ipc/channels';
import { sendToRenderer } from '../ipc/bridge';
import { parseFdx } from './parse';

let watcher: FSWatcher | null = null;
let watchedPath: string | null = null;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Lê + parseia; retry curto se o XML parecer incompleto (save em curso). */
async function readFdx(filePath: string, tries = 3): Promise<FdxPayload> {
  const base: FdxPayload = {
    path: filePath,
    fileName: path.basename(filePath),
    ok: false,
    sceneCount: 0,
    paragraphCount: 0,
    scenes: [],
    fullText: '',
    updatedAt: new Date().toISOString(),
  };
  for (let t = 0; t < tries; t++) {
    let xml: string;
    try {
      xml = await fs.promises.readFile(filePath, 'utf8');
    } catch (e) {
      return { ...base, error: `read falhou: ${(e as Error).message}` };
    }
    if (!/<FinalDraft\b[\s\S]*<\/FinalDraft>/i.test(xml)) {
      if (t < tries - 1) { await delay(120); continue; }
      return { ...base, error: 'arquivo .fdx incompleto (mid-write?)' };
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
      return { ...base, error: `parse falhou: ${(e as Error).message}` };
    }
  }
  return base;
}

function startWatch(filePath: string, getWindow: () => BrowserWindow | null): void {
  stopWatch();
  watchedPath = filePath;
  watcher = watch(filePath, {
    ignoreInitial: true, // a leitura inicial vai no fdx:open
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  const push = async (): Promise<void> => {
    if (!watchedPath) return;
    sendToRenderer(getWindow(), IPC.FDX_CHANGED, await readFdx(watchedPath));
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

/** Registra os handlers IPC do cowork .fdx. Chamar uma vez no boot do main. */
export function registerFdx(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.FDX_OPEN, async (): Promise<FdxPayload | null> => {
    const win = getWindow();
    const opts: Electron.OpenDialogOptions = {
      title: 'Abrir .fdx (Final Draft) — modo leitura',
      filters: [
        { name: 'Final Draft', extensions: ['fdx'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
      properties: ['openFile'],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || res.filePaths.length === 0) return null;
    const filePath = res.filePaths[0];
    startWatch(filePath, getWindow);
    return readFdx(filePath); // leitura inicial imediata
  });

  ipcMain.handle(IPC.FDX_CLOSE, async (): Promise<void> => {
    stopWatch();
  });
}
