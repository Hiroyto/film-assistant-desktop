// FdxImportButton — ação DENTRO do corkboard: abre um .fdx e importa via o
// pipeline de EXTRAÇÃO POR IA (o mesmo do drop de PDF: runBraindumpExtraction,
// sourceFormat 'screenplay'), que gera TODOS os tipos de card (Character, Event,
// Location, Arc, Information) + edges. Um-shot (não observa o arquivo).
import React, { useState } from 'react';
import { openFdx, closeFdx } from '../../lib/fdxClient';
import { flushPushNow } from '../../data/desktop-lifecycle';

interface Props {
  /** Recebe o roteiro como texto e dispara a extração por IA no corkboard. */
  onImportScreenplay: (text: string, fileName: string) => void | Promise<void>;
}

export function FdxImportButton({ onImportScreenplay }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [summary, setSummary] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    if (busy) return;
    setSummary(null);
    const payload = await openFdx(); // seletor + leitura
    if (!payload) return; // cancelado
    void closeFdx(); // import é um-shot: não precisamos observar o arquivo
    if (!payload.ok) {
      setSummary(payload.error || 'não foi possível ler o .fdx');
      return;
    }
    if (payload.fullText.trim().length < 40) {
      setSummary('roteiro muito curto ou vazio');
      return;
    }
    setBusy(true);
    try {
      // A extração escreve no backend do freeform → precisa da ownership; garante
      // que a história (local-first) já esteja registrada no /works antes.
      setProgress('registrando história…');
      await flushPushNow();
      setProgress('enviando p/ extração…');
      await onImportScreenplay(payload.fullText, payload.fileName);
      setSummary('Extração iniciada — os cards vão aparecer conforme a IA lê o roteiro.');
    } catch (e) {
      setSummary(`falhou: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <div style={{ position: 'fixed', right: 20, bottom: 66, zIndex: 129, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
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
        title="Importar um roteiro .fdx (Final Draft) — extração por IA gera cards de personagem, cena, local, arco e informação"
        style={{ background: busy ? '#8a8a8a' : '#e67e22', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 600, cursor: busy ? 'default' : 'pointer', boxShadow: '0 6px 18px rgba(0,0,0,0.35)', fontSize: 13 }}
      >
        {busy ? `Importando ${progress}` : '⬇ Importar .fdx'}
      </button>
    </div>
  );
}

export default FdxImportButton;
