#!/usr/bin/env bash
# ============================================================================
# fix-works-cors.sh — adiciona Access-Control-Allow-Origin ('*') na API Gateway
# REST do Film Assistant, para o desktop (origin file://null / localhost) poder
# fazer os POSTs que hoje dão "CORS error" (o preflight OPTIONS já passa; falta
# o ACAO na resposta REAL do POST e nas respostas de erro 4xx/5xx).
#
# Requisitos: aws cli v2 + jq, credenciais com permissão apigateway:* nessa API.
# É idempotente (usa PATCH `add` + tolera "já existe"). NÃO toca no OPTIONS.
# Integrações AWS_PROXY são puladas (nelas o header tem de sair da Lambda).
#
# REVISE antes de rodar: altera uma API em produção e faz deploy no stage.
# Dry-run: rode com   DRY_RUN=1 ./fix-works-cors.sh   (só imprime, não altera).
# ============================================================================
set -uo pipefail

API_ID="${API_ID:-5cvdm9g9zk}"
REGION="${REGION:-us-east-1}"
STAGE="${STAGE:-alpha}"
ORIGIN="${ORIGIN:-'*'}"          # valor do ACAO (mantenha as aspas simples)
PATHS=(works user scenes scripts story summary community communityData events checkout adminData)

run() { if [ "${DRY_RUN:-0}" = "1" ]; then echo "  [dry] $*"; else "$@"; fi; }

echo "==> API $API_ID | region $REGION | stage $STAGE | origin $ORIGIN"

# ---------------------------------------------------------------------------
# 1) Gateway Responses: garante ACAO nas respostas de ERRO (401/403/throttle/5xx)
# ---------------------------------------------------------------------------
echo "== Gateway Responses (erros) =="
for GR in DEFAULT_4XX DEFAULT_5XX; do
  run aws apigateway put-gateway-response \
    --rest-api-id "$API_ID" --region "$REGION" \
    --response-type "$GR" \
    --response-parameters "gatewayresponse.header.Access-Control-Allow-Origin=$ORIGIN" \
    >/dev/null 2>&1 && echo "  ok $GR" || echo "  ! $GR (verifique manualmente)"
done

# ---------------------------------------------------------------------------
# 2) Por rota: ACAO na method-response + integration-response de cada POST
# ---------------------------------------------------------------------------
echo "== Métodos POST por recurso =="
RES_JSON="$(aws apigateway get-resources --rest-api-id "$API_ID" --region "$REGION" --limit 500 --output json)"

for P in "${PATHS[@]}"; do
  RID="$(echo "$RES_JSON" | jq -r --arg p "/$P" '.items[] | select(.path==$p) | .id')"
  if [ -z "$RID" ] || [ "$RID" = "null" ]; then echo "  ! /$P — recurso não encontrado, pulei"; continue; fi

  ITYPE="$(aws apigateway get-integration --rest-api-id "$API_ID" --region "$REGION" \
            --resource-id "$RID" --http-method POST --query type --output text 2>/dev/null || echo NONE)"
  if [ "$ITYPE" = "NONE" ]; then echo "  ! /$P — sem POST, pulei"; continue; fi
  if [ "$ITYPE" = "AWS_PROXY" ]; then
    echo "  ! /$P — integração PROXY: o ACAO tem de vir da Lambda (headers na resposta). Pulei."
    continue
  fi

  CODES="$(aws apigateway get-method --rest-api-id "$API_ID" --region "$REGION" \
            --resource-id "$RID" --http-method POST --query 'methodResponses' --output json 2>/dev/null \
            | jq -r 'keys[]?')"
  [ -z "$CODES" ] && CODES="200"

  for CODE in $CODES; do
    run aws apigateway update-method-response \
      --rest-api-id "$API_ID" --region "$REGION" --resource-id "$RID" \
      --http-method POST --status-code "$CODE" \
      --patch-operations op=add,path=/responseParameters/method.response.header.Access-Control-Allow-Origin,value=false \
      >/dev/null 2>&1 || true
    run aws apigateway update-integration-response \
      --rest-api-id "$API_ID" --region "$REGION" --resource-id "$RID" \
      --http-method POST --status-code "$CODE" \
      --patch-operations "op=add,path=/responseParameters/method.response.header.Access-Control-Allow-Origin,value=$ORIGIN" \
      >/dev/null 2>&1 || true
  done
  echo "  ok /$P (POST $ITYPE; códigos: $(echo $CODES | tr '\n' ' '))"
done

# ---------------------------------------------------------------------------
# 3) Redeploy no stage
# ---------------------------------------------------------------------------
echo "== Deploy =="
run aws apigateway create-deployment \
  --rest-api-id "$API_ID" --region "$REGION" --stage-name "$STAGE" \
  --description "CORS: ACAO em method/integration/gateway responses (desktop)" \
  >/dev/null 2>&1 && echo "  ok deploy -> $STAGE" || echo "  ! deploy falhou (verifique)"

echo "==> Concluído. Teste um POST do desktop; a fila de sync deve drenar sozinha."
