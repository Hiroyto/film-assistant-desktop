// Recorder de ordem de push (seam de instrumentação — parity spec 03 @ordem).
// O push-queue chama record() a cada envio ao backend; capturedPushOrder() lê a
// sequência. INERTE em produção: enquanto não for armado, record() é no-op e nada
// é acumulado (custo ~zero). A ponte de teste arma e expõe via registerTestHook.

let armed = false;
const order: string[] = [];

/** Ativa a captura e zera o histórico. Chamado só em modo teste. */
export function armPushRecorder(): void {
  armed = true;
  order.length = 0;
}

/** Registra um id (request_id) no instante em que a mutation é enviada ao backend. */
export function recordPush(id: string): void {
  if (armed) order.push(id);
}

/** Ordem de push capturada (cópia). */
export function getPushOrder(): string[] {
  return [...order];
}

/** Limpa o histórico sem desarmar (teardown de teste). */
export function resetPushRecorder(): void {
  order.length = 0;
}
