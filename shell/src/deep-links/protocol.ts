// Deep links — registra filmassistant:// no OS e encaminha callbacks ao renderer.
// AD-04 (Stripe success/cancel) e futuros callbacks Cognito. Cross-platform:
//   macOS  -> evento app 'open-url'
//   Windows -> deep link chega como argv (cold start) ou via 'second-instance'.
import { app } from 'electron';
import * as path from 'path';
import { DEEP_LINK_SCHEME, parseDeepLink, DeepLinkPayload } from '../ipc/channels';

type Handler = (payload: DeepLinkPayload) => void;

let handler: Handler | null = null;
const pending: DeepLinkPayload[] = []; // buffer enquanto a janela não está pronta

/** Define o sink dos deep links (main wira para enviar ao renderer). Drena o buffer. */
export function setDeepLinkHandler(h: Handler): void {
  handler = h;
  while (pending.length) {
    const p = pending.shift()!;
    handler(p);
  }
}

function emit(url: string): void {
  const payload = parseDeepLink(url);
  if (!payload) return;
  if (handler) handler(payload);
  else pending.push(payload);
}

/** Registra o app como handler do scheme e escuta open-url (macOS). */
export function registerDeepLinkProtocol(): void {
  if (process.defaultApp) {
    // Dev (electron .): precisa passar o caminho do script para o registro funcionar.
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }

  // macOS entrega o deep link por este evento.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    emit(url);
  });
}

/** Extrai e emite um deep link presente em argv (Windows). */
export function emitDeepLinkFromArgv(argv: string[]): void {
  const urlArg = argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}://`));
  if (urlArg) emit(urlArg);
}
