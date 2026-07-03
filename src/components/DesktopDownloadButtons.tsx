// Botões de download do app desktop (Windows + macOS) para a versão WEB.
//
// Os instaladores são publicados no GitHub Releases pelo Electron Forge
// (publisher-github, AD-09). O Windows tem nome estável (FilmAssistantSetup.exe,
// forge.config.js §maker-squirrel); o macOS .dmg é versionado. Por isso resolvemos
// os assets DINAMICAMENTE pela API do GitHub — que também enxerga prereleases
// (canal beta, `prerelease: true`), ao contrário do atalho /releases/latest/download.
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
  assets?: GhAsset[];
}

export interface DesktopReleaseInfo {
  loading: boolean;
  error: string | null;
  version: string | null;
  windowsUrl: string | null;
  macUrl: string | null; // melhor pick por arquitetura (universal > detectada > única)
}

function detectOS(): OS {
  if (typeof navigator === 'undefined') return 'other';
  const s = `${navigator.userAgent} ${navigator.platform || ''}`.toLowerCase();
  if (s.includes('win')) return 'windows';
  if (s.includes('mac') || s.includes('darwin')) return 'mac';
  return 'other';
}

// A UA não revela Apple Silicon de forma confiável (Safari mascara como Intel).
// Então preferimos universal/Intel por padrão; um dmg arm64 explícito ainda é
// oferecido se existir. Best-effort: sem detecção agressiva.
function preferAppleSilicon(): boolean {
  return false;
}

function pickWindows(assets: GhAsset[]): string | null {
  const exact = assets.find(a => /FilmAssistantSetup\.exe$/i.test(a.name));
  const anyExe = assets.find(a => /\.exe$/i.test(a.name));
  return (exact || anyExe)?.browser_download_url || null;
}

function pickMac(assets: GhAsset[], prefArm: boolean): string | null {
  const dmgs = assets.filter(a => /\.dmg$/i.test(a.name));
  if (dmgs.length === 0) return null;
  const universal = dmgs.find(a => /universal/i.test(a.name));
  const arm = dmgs.find(a => /(arm64|aarch64|apple[-_ ]?silicon)/i.test(a.name));
  const intel = dmgs.find(a => /(x64|x86_64|intel)/i.test(a.name));
  const best = universal || (prefArm ? (arm || intel) : (intel || arm)) || dmgs[0];
  return best?.browser_download_url || null;
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
        return Array.isArray(releases) ? releases.find(r => !r.draft) || null : null;
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
    loading: true, error: null, version: null, windowsUrl: null, macUrl: null,
  });

  useEffect(() => {
    let cancelled = false;
    fetchLatestRelease()
      .then(rel => {
        if (cancelled) return;
        if (!rel) {
          setInfo({ loading: false, error: 'no-release', version: null, windowsUrl: null, macUrl: null });
          return;
        }
        const assets = rel.assets || [];
        setInfo({
          loading: false,
          error: null,
          version: rel.tag_name || rel.name || null,
          windowsUrl: pickWindows(assets),
          macUrl: pickMac(assets, preferAppleSilicon()),
        });
      })
      .catch(err => {
        if (!cancelled) {
          setInfo({ loading: false, error: err?.message || 'fetch-failed', version: null, windowsUrl: null, macUrl: null });
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
}

const DesktopDownloadButtons: React.FC<Props> = ({ className, label = 'Download the desktop app' }) => {
  // Nunca renderiza dentro do próprio app desktop.
  if (isDesktop()) return null;

  return <DownloadButtonsInner className={className} label={label} />;
};

interface Btn {
  target: OS;
  url: string;
  icon: React.ReactNode;
  text: string;
}

// Componente interno para poder chamar o hook depois do early-return de isDesktop().
const DownloadButtonsInner: React.FC<Props> = ({ className, label }) => {
  const os = detectOS();
  const { loading, version, windowsUrl, macUrl } = useLatestDesktopRelease();

  // Enquanto carrega, não mostra nada (evita botão "quebrado" piscando).
  if (loading) return null;

  // Só entra na lista o SO que tem asset publicado. Sem asset → botão some.
  const available: Btn[] = [];
  if (windowsUrl) available.push({ target: 'windows', url: windowsUrl, icon: <WindowsIcon />, text: 'Windows' });
  if (macUrl) available.push({ target: 'mac', url: macUrl, icon: <AppleIcon />, text: 'macOS' });

  // Nenhum instalador publicado ainda (ou API indisponível) → seção some por completo.
  if (available.length === 0) return null;

  return (
    <div className={['ddl-wrap', className].filter(Boolean).join(' ')}>
      <div className="ddl-label">
        {label}{version ? <span className="ddl-version"> · {version}</span> : null}
      </div>
      <div className="ddl-buttons">
        {available.map(b => (
          <a
            key={b.target}
            className={['ddl-btn', os === b.target ? 'ddl-recommended' : ''].filter(Boolean).join(' ')}
            href={b.url}
            rel="noopener"
          >
            <span className="ddl-icon">{b.icon}</span>
            <span className="ddl-text">{b.text}</span>
            {os === b.target && <span className="ddl-badge">Your OS</span>}
          </a>
        ))}
      </div>
    </div>
  );
};

export default DesktopDownloadButtons;
