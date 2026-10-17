// Interruptor do LOCAL-FIRST no desktop: SQLite como fonte de verdade da grade
// e das stories, fila de push, pull periódico, resolução de conflito.
//
// DESLIGADO por padrão (out/2026). Para o teste público o desktop se comporta
// como a web: grade e saves direto no backend, uma fonte de verdade só. Foi na
// camada local-first que moraram os bugs difíceis de reproduzir (fila presa em
// in_flight, conflito a cada boot, story reabrindo como outline, 403 do
// corkboard antes do push chegar). Ligar: REACT_APP_LOCAL_FIRST=true no build
// (.env local, ou a Variable do workflow de release). É flag de BUILD: o CRA
// embute no bundle, então mudar exige reiniciar o desktop:start ou refazer o
// build.
//
// isDesktop() continua valendo para o que é do shell e não depende de dados
// locais: deep links, CSP, menu nativo, atualização, cowork .fdx, Stripe no
// navegador do sistema. Só os ramos de DADOS consultam isLocalFirst().
import { isDesktop } from './ipcClient';

/** A flag de build, lida como "true" (qualquer caixa, com espaços). Tudo o mais desliga. */
export function localFirstEnabled(flag: string | undefined = process.env.REACT_APP_LOCAL_FIRST): boolean {
  return String(flag ?? '').trim().toLowerCase() === 'true';
}

/** Local-first ligado E rodando no shell Electron. Na web é sempre false. */
export function isLocalFirst(): boolean {
  return isDesktop() && localFirstEnabled();
}
