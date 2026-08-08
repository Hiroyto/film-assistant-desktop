// Protótipo COWORKING .fdx (SOMENTE LEITURA). Observa um arquivo Final Draft
// (.fdx = XML) que OUTRO app (ex.: Final Draft) está editando, e faz push do
// conteúdo parseado para o renderer a cada vez que o arquivo é salvo no disco.
//
// Decisões do protótipo (ver conversa de arquitetura):
//  - Observa o DIRETÓRIO, não o arquivo: apps salvam de forma "atômica"
//    (escreve temp -> renomeia), o que troca o inode e faria um watch preso ao
//    arquivo silenciar após o 1º save. Observando a pasta e casando o basename
//    isso é resolvido.
//  - Parse por regex (não um parser XML) DE PROPÓSITO: zero dependência nova e
//    imune a XXE (não resolve entidades externas). Em produção, troque por
//    fast-xml-parser com resolução de entidades desligada.
//  - Leitura com retry: um save em andamento pode entregar XML truncado; se não
//    houver <FinalDraft>...</FinalDraft>, espera e re-tenta.
//  - "Tempo real" aqui = a cada SAVE do outro app (granularidade de disco), não
//    a cada tecla — é uma limitação inerente de observar arquivo.

import { dialog, ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IPC, FdxPayload, FdxScene } from '../ipc/channels';
import { sendToRenderer } from '../ipc/bridge';

let watcher: fs.FSWatcher | null = null;
let watchedPath: string | null = null;
let debounceTimer: NodeJS.Timeout | null = null;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
};
function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse do .fdx: agrupa cada cena (Scene Heading + parágrafos do corpo até a
 *  próxima cena) para virar um card no board. Regex, sem parser XML (protótipo). */
function parseFdx(xml: string): { title?: string; scenes: FdxScene[]; paragraphCount: number } {
  // O corpo do roteiro é o 1º <Content> (a TitlePage tem o seu, que vem depois).
  const contentM = /<Content\b[^>]*>([\s\S]*?)<\/Content>/i.exec(xml);
  const content = contentM ? contentM[1] : xml;

  type Para = { type: string; text: string; raw: string };
  const paras: Para[] = [];
  const paraRe = /<Paragraph\b([^>]*)>([\s\S]*?)<\/Paragraph>/gi;
  let pm: RegExpExecArray | null;
  while ((pm = paraRe.exec(content)) !== null) {
    const typeM = /\bType="([^"]*)"/i.exec(pm[1] || '');
    paras.push({ type: typeM ? typeM[1] : '', text: stripTags(pm[2] || ''), raw: pm[0] });
  }

  const scenes: FdxScene[] = [];
  let cur: FdxScene | null = null;
  let body: string[] = [];
  let idx = 0;
  const flush = (): void => {
    if (!cur) return;
    cur.lineCount = body.length;
    cur.snippet = (body.find((l) => l.length > 0) || '').slice(0, 120);
    scenes.push(cur);
  };
  for (const p of paras) {
    if (/scene heading/i.test(p.type)) {
      flush();
      const numM = /\bNumber="([^"]*)"/i.exec(p.raw);
      cur = {
        index: idx,
        number: numM && numM[1] ? numM[1] : String(idx + 1),
        heading: p.text,
        snippet: '',
        lineCount: 0,
      };
      idx++;
      body = [];
    } else if (cur && p.text) {
      body.push(p.text);
    }
  }
  flush();

  let title: string | undefined;
  const tp = /<TitlePage\b[\s\S]*?<Text[^>]*>([\s\S]*?)<\/Text>/i.exec(xml);
  if (tp) title = stripTags(tp[1]) || undefined;
  return { title, scenes, paragraphCount: paras.length };
}

/** Lê + valida + parseia. Faz retry se o XML parecer truncado (save em curso). */
async function readFdx(filePath: string, tries = 4): Promise<FdxPayload> {
  const base: FdxPayload = {
    path: filePath,
    fileName: path.basename(filePath),
    ok: false,
    sceneCount: 0,
    paragraphCount: 0,
    scenes: [],
    updatedAt: new Date().toISOString(),
  };
  for (let t = 0; t < tries; t++) {
    let xml: string;
    try {
      xml = await fs.promises.readFile(filePath, 'utf8');
    } catch (e) {
      return { ...base, error: `read falhou: ${(e as Error).message}` };
    }
    if (!/<FinalDraft\b/i.test(xml) || !/<\/FinalDraft>/i.test(xml)) {
      if (t < tries - 1) { await delay(120); continue; }
      return { ...base, error: 'arquivo não parece um .fdx completo (talvez mid-write)' };
    }
    const { title, scenes, paragraphCount } = parseFdx(xml);
    return {
      ...base,
      ok: true,
      title,
      scenes,
      sceneCount: scenes.length,
      paragraphCount,
      updatedAt: new Date().toISOString(),
    };
  }
  return base;
}

function scheduleRead(getWindow: () => BrowserWindow | null): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    if (!watchedPath) return;
    const payload = await readFdx(watchedPath);
    sendToRenderer(getWindow(), IPC.FDX_CHANGED, payload);
  }, 150);
}

function startWatch(filePath: string, getWindow: () => BrowserWindow | null): void {
  stopWatch();
  watchedPath = filePath;
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  try {
    watcher = fs.watch(dir, { persistent: true }, (_event, fname) => {
      // fname pode vir null em alguns OS; nesse caso re-lê por garantia.
      if (!fname || String(fname) === base) scheduleRead(getWindow);
    });
    console.log('[fdx] observando', filePath);
  } catch (e) {
    console.error('[fdx] fs.watch falhou', e);
  }
}

export function stopWatch(): void {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  if (watcher) { try { watcher.close(); } catch { /* noop */ } watcher = null; }
  watchedPath = null;
}

/** Registra os handlers IPC do protótipo .fdx. Chamar uma vez no boot do main. */
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
