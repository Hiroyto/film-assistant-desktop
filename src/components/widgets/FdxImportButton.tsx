// FdxImportButton — ação DENTRO do corkboard de uma história: abre um .fdx e
// importa as cenas como cards REAIS (eventos + locais), sincronizando sob demanda
// (dedup pula o que já existe). Auto-contido: toda a UI (botão, progresso, resumo)
// e a lógica vivem aqui, para o freeform-corkboard.tsx só montar uma linha.
import React, { useState } from 'react';
import { openFdx } from '../../lib/fdxClient';
import { importFdxIntoStory, FdxImportResult } from '../../lib/fdxImport';

interface Props {
  projectId: string;
  userId: string;
  token: string;
  /** Chamado após o import com as entidades criadas (para insert otimista) +
   *  em seguida o board recarrega via refresh. */
  onImported: (created: FdxImportResult['created']) => void | Promise<void>;
}

export function FdxImportButton({ projectId, userId, token, onImported }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [summary, setSummary] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    if (busy) return;
    setSummary(null);
    const payload = await openFdx(); // seletor de arquivo + leitura inicial (main)
    if (!payload) return; // cancelado
    setBusy(true);
    setProgress('lendo…');
    try {
      const r: FdxImportResult = await importFdxIntoStory(payload, {
        projectId, userId, token, onProgress: setProgress,
      });
      await onImported(r.created);
      setSummary(
        `${r.eventsCreated} cenas novas · ${r.locationsCreated} locais` +
          (r.eventsExisting || r.locationsExisting ? ` · ${r.eventsExisting + r.locationsExisting} já existiam` : '') +
          (r.errors.length ? ` · ${r.errors.length} erro(s)` : ''),
      );
    } catch (e) {
      setSummary(`falhou: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <div style={{ position: 'fixed', right: 14, bottom: 44, zIndex: 130, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      {summary ? (
        <div
          style={{ maxWidth: 320, background: '#1f1f22', color: 'rgba(255,255,255,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 10px', fontSize: 12, boxShadow: '0 6px 18px rgba(0,0,0,0.35)' }}
          onClick={() => setSummary(null)}
          role="status"
        >
          {summary}
        </div>
      ) : null}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title="Importar cenas de um roteiro .fdx (Final Draft) como cards desta história"
        style={{ background: busy ? '#8a8a8a' : '#e67e22', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 600, cursor: busy ? 'default' : 'pointer', boxShadow: '0 6px 18px rgba(0,0,0,0.35)', fontSize: 13 }}
      >
        {busy ? `Importando ${progress}` : '⬇ Importar .fdx'}
      </button>
    </div>
  );
}

export default FdxImportButton;
