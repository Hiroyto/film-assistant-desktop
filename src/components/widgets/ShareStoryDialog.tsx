// ShareStoryDialog — "Share" dentro de uma história: cria links de PREVIEW
// somente leitura. O roteirista escolhe o que vai no link (só o board, roteiro
// e board, ou só o roteiro); o app monta um retrato do que está salvo agora e a
// Lambda `backend/share-links` o guarda sob um token. Quem abre o link lê a
// cópia: não edita nada e não toca a história original (lib/shareLinks).
import React, { useCallback, useEffect, useState } from 'react';
import { getCardLayouts, listProjectEntities, listSceneTexts } from '../../lib/freeformApi';
import { isDesktop } from '../../lib/ipcClient';
import {
  SHARE_MODES, SHARE_SCOPES, buildShareSnapshot, createShareLink, isEmptySnapshot, listShareLinks, revokeShareLink, scopeLabel, shareUrl,
  type ShareMode,
  type ShareLink, type ShareScope,
} from '../../lib/shareLinks';

interface Props {
  storyId: string;
  title: string;
  auth: { userId: string; token: string };
  dark?: boolean;
  onClose: () => void;
}

const FONT = 'system-ui, sans-serif';

/** A cópia pelo caminho antigo: seleciona o texto num campo fora da tela e manda
 *  copiar. Não pede permissão a ninguém, só um gesto do usuário. */
function copyBySelection(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false;
  const back = document.activeElement as HTMLElement | null;
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, { position: 'fixed', top: '0', left: '-9999px', opacity: '0' });
  document.body.appendChild(el);
  el.focus(); // a seleção que se copia é a do elemento em foco
  el.select();
  el.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  el.remove();
  if (back && typeof back.focus === 'function') back.focus();
  return ok;
}

/** Copia para a área de transferência. No DESKTOP vai direto pela seleção: o
 *  shell nega todo pedido de permissão do navegador (shell/src/main.ts,
 *  setPermissionRequestHandler), e `navigator.clipboard` pede uma para escrever,
 *  então lá ele sempre falhava ("Could not copy"). Na web tenta a API nova e,
 *  se ela não estiver disponível ou recusar, cai na seleção. */
async function copyText(text: string): Promise<boolean> {
  if (isDesktop()) return copyBySelection(text);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyBySelection(text);
  }
}

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export function ShareStoryDialog({ storyId, title, auth, dark = true, onClose }: Props): JSX.Element {
  const [scope, setScope] = useState<ShareScope>('board');
  // Retrato (o padrão) ou ao vivo: o que o link mostra depois que a história muda.
  const [mode, setMode] = useState<ShareMode>('snapshot');
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [busy, setBusy] = useState<'create' | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null); // token do link recém-criado
  const [copied, setCopied] = useState<string | null>(null);
  const [arming, setArming] = useState<string | null>(null); // token à espera do 2º clique em "Revoke"

  useEffect(() => {
    let alive = true;
    listShareLinks({ storyId }, auth.token)
      .then((l) => { if (alive) setLinks(l); })
      .catch((e: Error) => { if (alive) { setLinks([]); setError(e.message); } });
    return () => { alive = false; };
  }, [storyId, auth.token]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = useCallback(async (token: string) => {
    if (await copyText(shareUrl(token))) {
      setCopied(token);
      window.setTimeout(() => setCopied((c) => (c === token ? null : c)), 1800);
    } else {
      setError('Could not copy. Select the link and copy it by hand.');
    }
  }, []);

  const create = async (): Promise<void> => {
    setBusy('create');
    setError(null);
    try {
      const live = mode === 'live';
      // O retrato sai do que está SALVO agora: lê de novo, não do que está na tela.
      // Um link ao vivo não leva retrato (o serviço lê a história a cada
      // abertura), mas a leitura ainda diz se há o que mostrar.
      const [graph, texts, layouts] = await Promise.all([
        listProjectEntities({ projectId: storyId }, auth.token),
        scope === 'board' ? Promise.resolve({ sceneTexts: [] }) : listSceneTexts({ projectId: storyId }, auth.token),
        // Onde o roteirista deixou cada card. Sem isso (rede, backend antigo) o
        // palco do link sai no auto-layout do board, que é o que ele veria também.
        scope === 'script' || live ? Promise.resolve(null) : getCardLayouts({ userId: auth.userId, projectId: storyId }, auth.token).catch(() => null),
      ]);
      const stored = Object.fromEntries((layouts?.layouts ?? []).map((l) => [l.cardId, { x: l.x, y: l.y }]));
      const snapshot = buildShareSnapshot(scope, graph, texts.sceneTexts, scope === 'script' ? undefined : { stored, boardWidth: window.innerWidth });
      if (isEmptySnapshot(snapshot)) {
        setError(scope === 'script' ? 'There are no script pages to share yet.' : 'There is nothing on the board to share yet.');
        return;
      }
      const link = await createShareLink(live ? { storyId, scope, title, mode: 'live' } : { storyId, scope, title, snapshot }, auth.token);
      setLinks((cur) => [link, ...(cur ?? [])]);
      setFresh(link.token);
      void copy(link.token);
    } catch (e) {
      setError((e as Error).message || 'Could not create the link.');
    } finally {
      setBusy(null);
    }
  };

  // Revogar não tem volta e derruba o link para todo mundo que o recebeu: pede
  // um segundo clique. O primeiro arma o botão por alguns segundos.
  useEffect(() => {
    if (!arming) return undefined;
    const t = window.setTimeout(() => setArming(null), 5000);
    return () => window.clearTimeout(t);
  }, [arming]);

  const revoke = async (token: string): Promise<void> => {
    if (arming !== token) { setArming(token); return; }
    setArming(null);
    setBusy(token);
    setError(null);
    try {
      await revokeShareLink({ token }, auth.token);
      setLinks((cur) => (cur ?? []).filter((l) => l.token !== token));
      if (fresh === token) setFresh(null);
    } catch (e) {
      setError((e as Error).message || 'Could not revoke the link.');
    } finally {
      setBusy(null);
    }
  };

  const ink = dark ? 'rgba(255,255,255,0.9)' : '#2c2c28';
  const mute = dark ? 'rgba(255,255,255,0.6)' : '#736b5e';
  const hair = dark ? 'rgba(255,255,255,0.12)' : '#e3dbcb';
  const accent = dark ? '#ff8c42' : '#c2410c';
  const danger = dark ? '#f87171' : '#b91c1c'; // o vermelho claro some no fundo creme
  const btn: React.CSSProperties = {
    border: `1px solid ${hair}`, background: 'transparent', color: ink, borderRadius: 7, padding: '5px 10px',
    fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share this story"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)', fontFamily: FONT,
      }}
    >
      <div
        style={{
          width: 520, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
          background: dark ? '#1f1f22' : '#fffdf8', color: ink, border: `1px solid ${hair}`, borderRadius: 12, padding: 20,
          fontSize: 13, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Share “{title || 'this story'}”</div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ ...btn, border: 'none', padding: '0 4px', fontSize: 16, color: mute }}>✕</button>
        </div>
        <p style={{ margin: '6px 0 14px', lineHeight: 1.5, color: mute }}>
          A link opens a read-only preview. People who have it can read, not edit, and nothing they do touches your story.
        </p>

        <div role="radiogroup" aria-label="What to share" style={{ display: 'grid', gap: 8 }}>
          {SHARE_SCOPES.map((s) => {
            const on = scope === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setScope(s.id)}
                style={{
                  textAlign: 'left', padding: '9px 12px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', color: ink,
                  border: `1px solid ${on ? accent : hair}`, background: on ? (dark ? 'rgba(255,140,66,0.10)' : 'rgba(194,65,12,0.07)') : 'transparent',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</div>
                <div style={{ fontSize: 12, color: mute, marginTop: 2 }}>{s.blurb}</div>
              </button>
            );
          })}
        </div>

        {/* O que acontece com o link quando a história muda. */}
        <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700, color: mute, margin: '14px 0 6px' }}>When the story changes</div>
        <div role="radiogroup" aria-label="When the story changes" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
          {SHARE_MODES.map((m) => {
            const on = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setMode(m.id)}
                style={{
                  textAlign: 'left', padding: '9px 12px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', color: ink,
                  border: `1px solid ${on ? accent : hair}`, background: on ? (dark ? 'rgba(255,140,66,0.10)' : 'rgba(194,65,12,0.07)') : 'transparent',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{m.label}</div>
                <div style={{ fontSize: 12, color: mute, marginTop: 2, lineHeight: 1.4 }}>{m.blurb}</div>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy !== null}
            style={{
              ...btn, border: 'none', background: '#e67e22', color: '#fff', padding: '8px 14px', fontSize: 13,
              opacity: busy !== null ? 0.6 : 1, cursor: busy !== null ? 'default' : 'pointer',
            }}
          >
            {busy === 'create' ? 'Creating link…' : 'Create link'}
          </button>
          {error ? <span role="alert" style={{ color: danger, lineHeight: 1.4 }}>{error}</span> : null}
        </div>

        <div style={{ marginTop: 18, borderTop: `1px solid ${hair}`, paddingTop: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700, color: mute, marginBottom: 8 }}>
            Links for this story
          </div>
          {links === null ? (
            <div style={{ color: mute }}>Loading…</div>
          ) : links.length === 0 ? (
            <div style={{ color: mute }}>No links yet.</div>
          ) : (
            // minmax(0, 1fr): sem isso a coluna do grid cresce até o conteúdo
            // mínimo da linha e o diálogo ganha rolagem horizontal.
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 }}>
              {links.map((l) => (
                <li
                  key={l.token}
                  data-testid="share-link-row"
                  style={{
                    border: `1px solid ${l.token === fresh ? accent : hair}`, borderRadius: 9, padding: '8px 10px',
                    display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {/* Quem cede espaço é a data (base 0, reticências): o botão
                        armado ("Revoke for everyone?") cresce sem quebrar a linha
                        nem sair de baixo do cursor. Só na largura de celular ele
                        desce para a linha de baixo. */}
                    <strong style={{ fontSize: 12.5, whiteSpace: 'nowrap', flexShrink: 0 }}>{scopeLabel(l.scope)}</strong>
                    {l.mode === 'live' ? (
                      <span
                        data-testid="share-link-live"
                        title="Always shows the current story"
                        style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', padding: '1px 6px', borderRadius: 999, flexShrink: 0, color: accent, border: `1px solid ${accent}` }}
                      >
                        Live
                      </span>
                    ) : null}
                    <span style={{ color: mute, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 0', minWidth: 0 }}>{when(l.createdAt)}</span>
                    <button type="button" style={btn} onClick={() => void copy(l.token)}>{copied === l.token ? 'Copied' : 'Copy link'}</button>
                    <button
                      type="button"
                      style={{ ...btn, marginLeft: 'auto', color: arming === l.token ? '#fff' : danger, ...(arming === l.token ? { background: '#b91c1c', borderColor: '#b91c1c' } : {}) }}
                      disabled={busy !== null}
                      onClick={() => void revoke(l.token)}
                      title="The link stops working for everyone who has it"
                    >
                      {busy === l.token ? 'Revoking…' : arming === l.token ? 'Revoke for everyone?' : 'Revoke'}
                    </button>
                  </div>
                  <input
                    readOnly
                    aria-label="Share link"
                    value={shareUrl(l.token)}
                    onFocus={(e) => e.currentTarget.select()}
                    style={{
                      width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 12, padding: '5px 8px', borderRadius: 6,
                      border: `1px solid ${hair}`, background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', color: ink,
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default ShareStoryDialog;
