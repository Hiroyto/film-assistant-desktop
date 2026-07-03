import axios from 'axios';
import { toast } from 'react-hot-toast';

interface ApiCallResult {
  success: boolean;
  data?: any;
  error?: string;
  originalError?: any;
}

// ===========================================================================
// BC-10 — HTTP client compartilhado. Single source of truth para chamadas REST.
// Alterações da migração (preservado + alterado):
//   • JIT token refresh (AD-03 / BR-MIGRAR-007): antes de cada call, se um provider
//     de token fresco estiver configurado, usa-o (cobre sleep/wake do desktop).
//   • refresh-on-401 (corrige tech-debt #17): em 401, tenta UM refresh e re-tenta.
//   • auto-retry único em 5xx/network (COD-003 / BR-MIGRAR-038 / tech-debt #26)
//     com delay curto ANTES de surfar o toast.
//   • idempotencyKey opcional -> header X-Request-Id (suporta retry seguro / COD-008).
// Compatível com a web (o JIT é no-op se nenhum provider for configurado — AD-07).
// ===========================================================================

type FreshTokenProvider = () => Promise<string | null>;

let freshTokenProvider: FreshTokenProvider | null = null;

/**
 * Wira o provedor de token fresco (Cognito fetchAuthSession). Chamado pela camada
 * de auth (Tarefa 08). Enquanto não configurado, safeApiCall usa o token passado.
 */
export function configureApi(opts: { getFreshToken?: FreshTokenProvider | null }): void {
  if (opts.getFreshToken !== undefined) freshTokenProvider = opts.getFreshToken;
}

/** Opções extras aceitas por safeApiCall (além das do axios). */
export interface SafeApiOptions {
  timeout?: number;
  /** Anexado como header X-Request-Id (idempotência server-side / COD-008). */
  idempotencyKey?: string;
  /** Desabilita o auto-retry único (default: retry habilitado). */
  noRetry?: boolean;
  [k: string]: any;
}

/** Curto delay antes do retry (ms). */
const RETRY_DELAY_MS = 800;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isRetriable(error: any): boolean {
  if (error?.code === 'ERR_NETWORK') return true;
  const status: number | undefined = error?.response?.status;
  return typeof status === 'number' && status >= 500 && status <= 599;
}

/**
 * Wrapper seguro de chamada de API. Trata erros graciosamente e nunca rejeita —
 * sempre retorna ApiCallResult.
 */
export const safeApiCall = async (
  endpoint: string,
  data: any,
  token: string,
  options: SafeApiOptions = {},
): Promise<ApiCallResult> => {
  const maxRetries = options.noRetry ? 0 : 1; // único auto-retry (COD-003)
  let attempt = 0;
  let didRefreshOn401 = false;
  let authToken = token;

  // JIT refresh upfront (AD-03): cobre token expirado após sleep do laptop.
  if (freshTokenProvider) {
    try {
      const fresh = await freshTokenProvider();
      if (fresh) authToken = fresh;
    } catch {
      /* segue com o token recebido */
    }
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const { timeout, idempotencyKey, noRetry, headers: optHeaders, ...rest } = options;
      const response = await axios.post(`${process.env.REACT_APP_URL}/${endpoint}`, data, {
        ...rest,
        timeout: timeout || 120000,
        headers: {
          ...(optHeaders || {}),
          Authorization: authToken,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'X-Request-Id': idempotencyKey } : {}),
        },
      });
      return { success: true, data: response.data };
    } catch (error: any) {
      const status: number | undefined = error?.response?.status;

      // 401 -> tenta UM refresh JIT e re-tenta (corrige tech-debt #17).
      if (status === 401 && freshTokenProvider && !didRefreshOn401) {
        didRefreshOn401 = true;
        try {
          const fresh = await freshTokenProvider();
          if (fresh) {
            authToken = fresh;
            continue; // re-tenta com token novo (sem contar como retry de 5xx)
          }
        } catch {
          /* cai no fluxo de erro normal */
        }
      }

      // 5xx / network -> auto-retry único antes de surfar o toast (COD-003).
      if (attempt < maxRetries && isRetriable(error)) {
        attempt++;
        console.warn(`API retry ${attempt}/${maxRetries} (${endpoint}) after`, error?.code || status);
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      console.error(`API error (${endpoint}):`, error);

      if (error.code === 'ERR_NETWORK') {
        toast.error('Network error. Please check your connection.');
      } else if (error.response) {
        toast.error(error.response.data?.error || 'Server error');
      } else {
        toast.error('An error occurred. Your work is still saved.');
      }

      return { success: false, error: error.message, originalError: error };
    }
  }
};
