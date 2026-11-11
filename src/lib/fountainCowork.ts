// fountainCowork — a ponte entre o parser Fountain (lib/fountain) e o cowork.
//
// O motor do cowork (lib/fdxSync) trabalha em cima de um FdxPayload: cenas com
// heading, número e parágrafos tipados. Para um .fdx o shell já manda isso
// pronto (shell/src/fdx/parse.ts). Para um .fountain o shell manda só o texto
// (`source`): o parser Fountain vive SÓ aqui no renderer, e este módulo monta
// as cenas com o MESMO agrupamento do parseFdx — então daqui para a frente o
// motor não sabe de que formato o arquivo é.
//
// O que muda em relação ao import one-shot do mesmo arquivo:
//   - a página de título não entra nas cenas (só dá o `title` do payload);
//   - texto antes do primeiro cabeçalho de cena fica de fora (limite do cowork,
//     igual ao do .fdx);
//   - o número de cena do Fountain (`#12A#`) é usado como identidade; sem ele,
//     vale a posição (1, 2, 3…), como num .fdx sem numeração.
import { fountainToElements } from './fountain';

/** O arquivo observado é Fountain? Pela extensão: é o que o shell também usa. */
export const isFountainFile = (name: string | null | undefined): boolean => /[.]fountain$/i.test(String(name ?? ''));

/** A extensão para os textos da UI do cowork (".fdx cowork" / ".fountain cowork"). */
export const coworkExt = (name: string | null | undefined): '.fdx' | '.fountain' => (isFountainFile(name) ? '.fountain' : '.fdx');

/** "RED (V.O.)" / "MARA (V.O.) (CONT'D)" -> "RED" / "MARA". */
const speakerOf = (cue: string): string => cue.replace(/(\s*\([^)]*\))+\s*$/, '').trim();

export interface FountainScenes {
  title?: string;
  scenes: FdxScene[];
  paragraphCount: number;
  /** Roteiro reconstruído (heading / ação / CUE / fala), a mesma forma do
   *  fullText do parseFdx. */
  fullText: string;
}

/** Texto Fountain -> cenas do cowork. Pura. */
export function fountainToScenes(source: string): FountainScenes {
  const elements = fountainToElements(source);
  const scenes: FdxScene[] = [];
  const ftLines: string[] = [];
  let cur: FdxScene | null = null;
  let body: string[] = [];
  let paragraphCount = 0;
  const flush = (): void => {
    if (!cur) return;
    cur.lineCount = body.length;
    cur.snippet = (body.find((l) => l.length > 0) || '').slice(0, 120);
    scenes.push(cur);
  };
  for (const el of elements) {
    if (el.type === 'title') continue;
    paragraphCount++;
    if (el.type === 'scene') {
      flush();
      cur = {
        index: scenes.length,
        number: el.sceneNumber || String(scenes.length + 1),
        heading: el.text,
        snippet: '',
        lineCount: 0,
        characters: [],
        paragraphs: [],
      };
      body = [];
      ftLines.push('', el.text);
    } else if (cur) {
      cur.paragraphs!.push({ type: el.type, text: el.text });
      if (el.type === 'character') {
        const name = speakerOf(el.text);
        if (name && !cur.characters.includes(name)) cur.characters.push(name);
        ftLines.push('', el.text);
      } else {
        body.push(el.text);
        ftLines.push(el.text);
      }
    }
  }
  flush();
  const title = elements.find((el) => el.type === 'title')?.text;
  return { ...(title ? { title } : {}), scenes, paragraphCount, fullText: ftLines.join('\n').trim() };
}

/** Completa o payload de um .fountain com as cenas. Qualquer outro payload
 *  (um .fdx, uma leitura que falhou, null) passa como veio. O `source` sai:
 *  o motor guarda o último payload, e o texto já virou cenas. */
export function hydrateFountainPayload<T extends FdxPayload | null>(payload: T): T {
  if (!payload || payload.format !== 'fountain' || !payload.ok || typeof payload.source !== 'string') return payload;
  const { source, ...rest } = payload;
  try {
    const parsed = fountainToScenes(source);
    return { ...rest, ...parsed, sceneCount: parsed.scenes.length } as T;
  } catch (e) {
    return { ...rest, ok: false, error: `parse failed: ${(e as Error)?.message || String(e)}` } as T;
  }
}
