// Botões de download do app desktop (Windows + macOS) para a versão WEB.
//
// Os instaladores são publicados no GitHub Releases pelo Electron Forge
// (publisher-github, AD-09). O Windows tem nome estável (FilmAssistantSetup.exe,
// forge.config.js §maker-squirrel); o macOS .dmg é versionado e sai um por
// arquitetura (…-arm64.dmg e …-x64.dmg). Por isso resolvemos
// os assets DINAMICAMENTE pela API do GitHub. Preferimos a release CHEIA mais
// recente (canal prod); sem nenhuma, a pre-release mais recente (canal beta) —
// o atalho /releases/latest/download não enxergaria o canal beta.
//
// Só renderiza na web: dentro do próprio app desktop retorna null (isDesktop()).

import React, { useEffect, useState } from 'react';
import { isDesktop } from '../lib/ipcClient';
import './DesktopDownloadButtons.css';

// Repo público dos releases. Configurável por env (CRA exige prefixo REACT_APP_);
// fallback alinhado ao forge.config.js. Se não for setado/for privado, o fetch
// falha graciosamente e os botões mostram "indisponível".
const REPO_OWNER = process.env.REACT_APP_GITHUB_REPO_OWNER || 'TODO-owner';
const REPO_NAME = process.env.REACT_APP_GITHUB_REPO_NAME || 'film-assistant-desktop';

type OS = 'windows' | 'mac' | 'other';

interface GhAsset {
  name: string;
  browser_download_url: string;
}
interface GhRelease {
  tag_name?: string;
  name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GhAsset[];
}

// Um botão de Mac por instalador. `arch` decide o rótulo: 'arm64' / 'x64' quando
// o nome do dmg diz a arquitetura; 'any' para um dmg universal ou sem ela no nome.
export type MacArch = 'arm64' | 'x64' | 'any';
export interface MacDownload {
  arch: MacArch;
  url: string;
}

export interface DesktopReleaseInfo {
  loading: boolean;
  error: string | null;
  version: string | null;
  windowsUrl: string | null;
  macDownloads: MacDownload[]; // Apple Silicon primeiro; vazio = nenhum dmg publicado
}

function detectOS(): OS {
  if (typeof navigator === 'undefined') return 'other';
  const s = `${navigator.userAgent} ${navigator.platform || ''}`.toLowerCase();
  if (s.includes('win')) return 'windows';
  if (s.includes('mac') || s.includes('darwin')) return 'mac';
  return 'other';
}

function pickWindows(assets: GhAsset[]): string | null {
  const exact = assets.find(a => /FilmAssistantSetup\.exe$/i.test(a.name));
  const anyExe = assets.find(a => /\.exe$/i.test(a.name));
  return (exact || anyExe)?.browser_download_url || null;
}

// A UA não revela Apple Silicon de forma confiável (o Safari se apresenta como
// Intel em qualquer Mac), então não adivinhamos: com um dmg por arquitetura a
// página oferece os dois e o visitante escolhe. O errado custa caro nos dois
// sentidos — o arm64 não abre num Mac Intel; o x64 roda num Apple Silicon só via
// Rosetta, e o auto-update mantém a pessoa nele.
export function pickMac(assets: GhAsset[]): MacDownload[] {
  const dmgs = assets.filter(a => /\.dmg$/i.test(a.name));
  const universal = dmgs.find(a => /universal/i.test(a.name));
  if (universal) return [{ arch: 'any', url: universal.browser_download_url }];
  const arm = dmgs.find(a => /(arm64|aarch64|apple[-_ ]?silicon)/i.test(a.name));
  const intel = dmgs.find(a => a !== arm && /(x64|x86_64|intel)/i.test(a.name));
  const picks: MacDownload[] = [];
  if (arm) picks.push({ arch: 'arm64', url: arm.browser_download_url });
  if (intel) picks.push({ arch: 'x64', url: intel.browser_download_url });
  if (picks.length === 0 && dmgs[0]) picks.push({ arch: 'any', url: dmgs[0].browser_download_url });
  return picks;
}

// Memoiza o fetch entre montagens (evita bater na API a cada render / rate limit).
// Em erro, limpa o cache para permitir nova tentativa depois.
let releaseCache: Promise<GhRelease | null> | null = null;
function fetchLatestRelease(): Promise<GhRelease | null> {
  if (!releaseCache) {
    releaseCache = fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=10`,
      { headers: { Accept: 'application/vnd.github+json' } }
    )
      .then(async res => {
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        const releases: GhRelease[] = await res.json();
        const list = Array.isArray(releases) ? releases.filter(r => !r.draft) : [];
        return list.find(r => !r.prerelease) || list[0] || null;
      })
      .catch(err => {
        releaseCache = null; // permite retry numa próxima montagem
        throw err;
      });
  }
  return releaseCache;
}

export function useLatestDesktopRelease(): DesktopReleaseInfo {
  const [info, setInfo] = useState<DesktopReleaseInfo>({
    loading: true, error: null, version: null, windowsUrl: null, macDownloads: [],
  });

  useEffect(() => {
    let cancelled = false;
    fetchLatestRelease()
      .then(rel => {
        if (cancelled) return;
        if (!rel) {
          setInfo({ loading: false, error: 'no-release', version: null, windowsUrl: null, macDownloads: [] });
          return;
        }
        const assets = rel.assets || [];
        setInfo({
          loading: false,
          error: null,
          version: rel.tag_name || rel.name || null,
          windowsUrl: pickWindows(assets),
          macDownloads: pickMac(assets),
        });
      })
      .catch(err => {
        if (!cancelled) {
          setInfo({ loading: false, error: err?.message || 'fetch-failed', version: null, windowsUrl: null, macDownloads: [] });
        }
      });
    return () => { cancelled = true; };
  }, []);

  return info;
}

const WindowsIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M3 5.1 10.4 4v7.3H3V5.1Zm0 13.8L10.4 20v-7.2H3v6.1ZM11.3 3.9 21 2.5v9.1h-9.7V3.9Zm0 16.2L21 21.5v-9.1h-9.7v7.7Z" />
  </svg>
);

const AppleIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M16.4 12.9c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3-1.7-1.3-.1-2.5.8-3.1.8-.6 0-1.6-.7-2.7-.7-1.4 0-2.7.8-3.4 2-1.5 2.5-.4 6.3 1 8.3.7 1 1.5 2.1 2.6 2.1 1 0 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.6 1.1 0 1.8-1 2.5-2 .8-1.1 1.1-2.2 1.1-2.3-.1 0-2.1-.8-2.2-3.3ZM14.3 6.3c.6-.7 1-1.7.9-2.7-.8 0-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.6.9.1 1.8-.5 2.5-1.2Z" />
  </svg>
);

interface Props {
  className?: string;
  /** Texto do rótulo acima dos botões. */
  label?: string;
  /** Tag on the visitor's own OS button (default "Your OS"). An ad landing
   *  can say why that download matters, e.g. "Final Draft sync". */
  badge?: string;
}

const DesktopDownloadButtons: React.FC<Props> = ({ className, label = 'Download the desktop app', badge = 'Your OS' }) => {
  // Nunca renderiza dentro do próprio app desktop.
  if (isDesktop()) return null;

  return <DownloadButtonsInner className={className} label={label} badge={badge} />;
};

interface Btn {
  key: string;
  target: OS;
  url: string;
  icon: React.ReactNode;
  text: string;
}

const MAC_LABEL: Record<MacArch, string> = {
  arm64: 'macOS · Apple Silicon',
  x64: 'macOS · Intel',
  any: 'macOS',
};

// Componente interno para poder chamar o hook depois do early-return de isDesktop().
const DownloadButtonsInner: React.FC<Props> = ({ className, label, badge }) => {
  const os = detectOS();
  const { loading, version, windowsUrl, macDownloads } = useLatestDesktopRelease();

  // Enquanto carrega, não mostra nada (evita botão "quebrado" piscando).
  if (loading) return null;

  // Só entra na lista o SO que tem asset publicado. Sem asset → botão some.
  const available: Btn[] = [];
  if (windowsUrl) available.push({ key: 'windows', target: 'windows', url: windowsUrl, icon: <WindowsIcon />, text: 'Windows' });
  for (const m of macDownloads) {
    available.push({ key: `mac-${m.arch}`, target: 'mac', url: m.url, icon: <AppleIcon />, text: MAC_LABEL[m.arch] });
  }

  // Nenhum instalador publicado ainda (ou API indisponível) → seção some por completo.
  if (available.length === 0) return null;

  // Com dois dmgs o selo "Your OS" não diz QUAL é o do visitante: sai o selo e
  // entra, para quem está num Mac, a dica de como descobrir o chip.
  const macSplit = macDownloads.length > 1;

  return (
    <div className={['ddl-wrap', className].filter(Boolean).join(' ')}>
      <div className="ddl-label">
        {label}{version ? <span className="ddl-version"> · {version}</span> : null}
      </div>
      <div className="ddl-buttons">
        {available.map(b => (
          <a
            key={b.key}
            className={['ddl-btn', os === b.target ? 'ddl-recommended' : ''].filter(Boolean).join(' ')}
            href={b.url}
            rel="noopener"
          >
            <span className="ddl-icon">{b.icon}</span>
            <span className="ddl-text">{b.text}</span>
            {os === b.target && !(b.target === 'mac' && macSplit) && <span className="ddl-badge">{badge}</span>}
          </a>
        ))}
      </div>
      {macSplit && os === 'mac' && (
        <div className="ddl-note">
          Not sure which Mac you have? Apple menu → About This Mac: “Chip” means Apple Silicon, “Processor” means Intel.
        </div>
      )}
    </div>
  );
};

export default DesktopDownloadButtons;
