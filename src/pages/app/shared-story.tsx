// pages/app/shared-story.tsx — a página de um link compartilhado (/share/:token).
//
// Um PREVIEW somente leitura: lê o retrato que o dono gerou (lib/shareLinks) e
// o mostra. Não há nada editável aqui e nenhuma chamada que escreva: a história
// original não é sequer alcançada, só a cópia guardada sob o token. Rota
// pública; se o serviço exigir login (REQUIRE_LOGIN), a página pede o sign-in.
//
// O que se vê é o que o app mostra ao roteirista, sem as ferramentas:
//   Board   o palco do corkboard (components/Share/SharedBoardCanvas): Master,
//           com os cards onde ele os deixou, ou Beats, as cenas em ordem. Dá
//           para arrumar os dois; a arrumação fica só no navegador de quem a fez.
//   Script  o roteiro em folhas, paginado como no editor, com o painel de
//           navegação à esquerda (SharedScriptPages).
// O tema claro/escuro é o mesmo do board (`ff-theme`), com o mesmo botão.
//
// Um link pode ser um RETRATO (a história como estava quando ele foi criado) ou
// AO VIVO (o serviço lê a história a cada abertura). Para a página os dois
// chegam no mesmo formato; o ao vivo diz de quando é a leitura, tem um botão de
// atualizar e se atualiza sozinho quando o leitor volta para a aba.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import { MoonIcon, SunIcon, THEME_STORE_KEY, storedTheme, type ThemeMode } from '../../components/Freeform/corkboard/theme';
import { SharedBeats, SharedBoardCanvas } from '../../components/Share/SharedBoardCanvas';
import { SharedScriptPages } from '../../components/Share/SharedScriptPages';
import { SharedStoryError, fetchSharedStory, type SharedStory as SharedStoryData } from '../../lib/shareLinks';

type View =
  | { status: 'loading' }
  | { status: 'ready'; story: SharedStoryData }
  | { status: 'error'; kind: 'not-found' | 'sign-in' | 'failed'; message: string };
type BoardView = 'master' | 'beats';

const FONT = 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
/** A altura da tela. No celular `100vh` inclui a barra de endereço e o rodapé do
 *  palco some atrás dela; `100dvh` é a parte que se vê. */
const FULL_H = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('height', '100dvh') ? '100dvh' : '100vh';

function palette(dark: boolean) {
  return dark
    ? { panel: 'rgba(16,16,19,0.92)', ink: '#ededf1', mute: '#8a8a93', hair: '#26262b', accent: '#ff8c42', btn: '#1a1a1e', btnHair: '#2a2a30', btnInk: '#c8c8d0', on: '#d8d8de', onHair: '#d8d8de', onInk: '#16161a' }
    : { panel: 'rgba(255,255,255,0.94)', ink: '#1d2230', mute: '#736b5e', hair: '#ece5d7', accent: '#c2410c', btn: '#ffffff', btnHair: '#e6dfd2', btnInk: '#3d4250', on: '#ebe4d6', onHair: '#b5a98f', onInk: '#1d2230' };
}

/** O fundo do Shell do corkboard: a lâmpada e a vinheta no escuro, o creme no claro. */
const stageWash = (dark: boolean): React.CSSProperties => (dark
  ? {
    backgroundColor: '#0a0a0b',
    backgroundImage: [
      'radial-gradient(ellipse 80% 60% at 15% 20%, rgba(255,147,30,0.05) 0%, rgba(255,107,53,0.02) 30%, transparent 70%)',
      'radial-gradient(ellipse 70% 60% at 50% 45%, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 25%, transparent 55%)',
      'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 40%, rgba(0,0,0,0.45) 100%)',
    ].join(', '),
    backgroundAttachment: 'fixed',
  }
  : { backgroundImage: 'linear-gradient(170deg, #ffffff 0%, #fffefb 55%, #faf4e9 100%)', backgroundAttachment: 'fixed' });

async function sessionToken(): Promise<string | null> {
  try {
    return (await fetchAuthSession()).tokens?.idToken?.toString() ?? null;
  } catch {
    return null; // sem sessão: o link público abre do mesmo jeito
  }
}

/** Voltando à aba, um link ao vivo só relê se a leitura tiver mais que isto. */
const STALE_MS = 30_000;
const readAt = (iso?: string): string => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
};

const sharedOn = (iso: string): string => {
  const d = new Date(iso);
  // 'en-US' fixo: a frase em volta é em inglês, e a data no idioma do navegador
  // ("on 17 de novembro de 2026") ficava mestiça.
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { dateStyle: 'long' });
};

export default function SharedStory(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<View>({ status: 'loading' });
  const [tab, setTab] = useState<'board' | 'script'>('board');
  const [boardView, setBoardView] = useState<BoardView>('beats');
  const [theme, setTheme] = useState<ThemeMode>(() => storedTheme());
  const dark = theme === 'dark';
  const c = palette(dark);

  const toggleTheme = (): void => {
    const next: ThemeMode = dark ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem(THEME_STORE_KEY, next); } catch { /* sem storage: vale só para esta visita */ }
  };

  const load = useCallback(async () => {
    if (!token) { setView({ status: 'error', kind: 'not-found', message: 'This link is not available.' }); return; }
    setView({ status: 'loading' });
    try {
      const story = await fetchSharedStory(token, await sessionToken());
      setTab(story.snapshot.board ? 'board' : 'script');
      // O palco pede largura: numa tela estreita a leitura começa pelos Beats.
      setBoardView(window.innerWidth > 720 ? 'master' : 'beats');
      setView({ status: 'ready', story });
    } catch (e) {
      const err = e instanceof SharedStoryError ? e : new SharedStoryError('failed', 'Could not open this link.');
      setView({ status: 'error', kind: err.kind, message: err.message });
    }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  // AO VIVO: reler a história sem sair de onde o leitor está (a aba, a vista e
  // o que ele arrumou ficam). Se o link deixou de existir, a página diz; uma
  // falha de rede não derruba o que já está na tela.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const lastRead = useRef(0);
  const isLive = view.status === 'ready' && view.story.mode === 'live';
  useEffect(() => { if (view.status === 'ready') lastRead.current = Date.now(); }, [view]);
  const refresh = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    setRefreshFailed(false);
    try {
      const story = await fetchSharedStory(token, await sessionToken());
      setView({ status: 'ready', story });
    } catch (e) {
      const err = e instanceof SharedStoryError ? e : new SharedStoryError('failed', 'Could not open this link.');
      if (err.kind === 'failed') setRefreshFailed(true);
      else setView({ status: 'error', kind: err.kind, message: err.message });
    } finally {
      setRefreshing(false);
    }
  }, [token]);
  useEffect(() => {
    if (!isLive) return undefined;
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && Date.now() - lastRead.current > STALE_MS) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isLive, refresh]);

  // Um link privado não é assunto de buscador.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);
  const title = view.status === 'ready' ? view.story.title || 'Untitled story' : '';
  useEffect(() => {
    if (!title) return undefined;
    const before = document.title;
    document.title = `${title} · FilmAssistant`;
    return () => { document.title = before; };
  }, [title]);

  /** O botão do toolbar do board: 30px, contorno fino; o ativo é a tinta neutra. */
  const button = (on: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', fontSize: 12, fontWeight: 600, letterSpacing: 0.1,
    border: `1px solid ${on ? c.onHair : c.btnHair}`, borderRadius: 7, background: on ? c.on : c.btn, color: on ? c.onInk : c.btnInk,
    cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap',
  });
  const themeToggle = (
    <button
      type="button"
      data-testid="shared-theme-toggle"
      onClick={toggleTheme}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{ ...button(false), padding: '0 9px' }}
    >
      {/* A lua no claro (ir para o escuro), o sol no escuro: como no board. */}
      <span style={{ display: 'inline-flex', lineHeight: 1 }}>{dark ? SunIcon : MoonIcon}</span>
    </button>
  );

  const shell = (children: React.ReactNode, header?: React.ReactNode, fill = false): JSX.Element => (
    <div
      data-theme={theme}
      style={{ minHeight: FULL_H, height: fill ? FULL_H : undefined, display: 'flex', flexDirection: 'column', color: c.ink, fontFamily: FONT, ...stageWash(dark) }}
    >
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 150, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0,
          padding: '10px clamp(12px, 3vw, 20px)', background: c.panel, borderBottom: `1px solid ${c.hair}`, backdropFilter: 'blur(8px)',
        }}
      >
        <span style={{ fontWeight: 800, letterSpacing: 0.2, color: c.accent }}>FilmAssistant</span>
        {header}
        {header ? null : <span style={{ flex: 1 }} />}
        {themeToggle}
      </div>
      {children}
    </div>
  );
  const page: React.CSSProperties = { padding: '22px clamp(12px, 4vw, 22px) 60px' };

  if (view.status === 'loading') return shell(<main style={page}><p role="status" style={{ color: c.mute }}>Opening the shared story…</p></main>);

  if (view.status === 'error') {
    return shell(
      <main style={page}>
        <div role="alert" style={{ maxWidth: 520, margin: '60px auto', textAlign: 'center', lineHeight: 1.6 }}>
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>
            {view.kind === 'not-found' ? 'This link is no longer available' : view.kind === 'sign-in' ? 'Sign in to open this link' : 'Could not open this link'}
          </h1>
          <p style={{ margin: 0, color: c.mute }}>
            {view.kind === 'not-found'
              ? 'The writer may have revoked it, or the address is incomplete.'
              : view.kind === 'sign-in'
                ? 'This story is shared with FilmAssistant accounts. Sign in, then open the link again.'
                : view.message}
          </p>
          <div style={{ marginTop: 18 }}>
            {view.kind === 'sign-in' ? (
              <Link to="/login" style={{ color: c.accent, fontWeight: 700 }}>Sign in</Link>
            ) : view.kind === 'failed' ? (
              <button type="button" onClick={() => void load()} style={{ ...button(false), color: c.accent, fontWeight: 700 }}>Try again</button>
            ) : null}
          </div>
        </div>
      </main>,
    );
  }

  const { story } = view;
  const { board, script } = story.snapshot;
  const both = !!board && !!script;
  const onBoard = tab === 'board' && !!board;
  const master = onBoard && boardView === 'master';
  // O que o visitante arruma neste link fica no navegador dele, por link.
  const memory = (what: string): string => `ff-share-${what}:${story.token}`;
  const asOf = sharedOn(story.createdAt);
  const tabBtn = (id: 'board' | 'script', label: string): JSX.Element => (
    <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} style={button(tab === id)}>{label}</button>
  );
  const viewBtn = (id: BoardView, label: string, hint: string): JSX.Element => (
    <button key={id} type="button" aria-pressed={boardView === id} onClick={() => setBoardView(id)} title={hint} style={button(boardView === id)}>{label}</button>
  );
  const live = story.mode === 'live';
  const note = live ? (
    <span style={{ fontSize: 12, color: c.mute, display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
      <span>
        A read-only preview of the story as it is now{readAt(story.asOf) ? ` (read at ${readAt(story.asOf)})` : ''}.
        {refreshFailed ? ' Could not refresh just now.' : ''}
      </span>
      <button type="button" onClick={() => void refresh()} disabled={refreshing} style={{ ...button(false), height: 26, padding: '0 10px', opacity: refreshing ? 0.6 : 1 }}>
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </span>
  ) : (
    <span style={{ fontSize: 12, color: c.mute }}>
      A read-only preview{asOf ? `, as the story was on ${asOf}` : ''}. Later changes are not shown here.
    </span>
  );

  return shell(
    <>
      {onBoard && board ? (
        <main
          data-testid="shared-board"
          style={master ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px clamp(8px, 2vw, 14px) 12px' } : page}
        >
          {/* As vistas do board, com os nomes do original. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: master ? 10 : 18, maxWidth: master ? undefined : 1180, marginInline: master ? undefined : 'auto', width: '100%' }}>
            <div role="group" aria-label="Board view" style={{ display: 'flex', gap: 6 }}>
              {viewBtn('master', 'Master', 'The board as the writer arranged it')}
              {viewBtn('beats', 'Beats', 'Every scene as a card, in story order')}
            </div>
            <span style={{ flex: 1 }} />
            {note}
          </div>
          {master
            ? <SharedBoardCanvas board={board} dark={dark} memoryKey={memory('stage')} />
            : <SharedBeats board={board} dark={dark} memoryKey={memory('beats')} />}
        </main>
      ) : null}
      {tab === 'script' && script ? (
        // O roteiro ocupa a tela como no editor: o painel de navegação à esquerda
        // e as folhas rolando ao lado.
        <main style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <SharedScriptPages script={script} dark={dark} board={board} footer={note} />
        </main>
      ) : null}
    </>,
    <>
      <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: -0.2, color: c.ink }}>{title}</h1>
      <span
        data-testid="shared-readonly"
        style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 999, border: `1px solid ${c.hair}`, color: c.mute }}
      >
        Read-only preview
      </span>
      {live ? (
        <span
          data-testid="shared-live"
          title="This link always shows the current story"
          style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 999, border: `1px solid ${c.accent}`, color: c.accent }}
        >
          Live
        </span>
      ) : null}
      <span style={{ flex: 1 }} />
      {both ? <div role="tablist" aria-label="What to read" style={{ display: 'flex', gap: 6 }}>{tabBtn('board', 'Board')}{tabBtn('script', 'Script')}</div> : null}
    </>,
    master || (tab === 'script' && !!script),
  );
}
