#!/bin/bash
# ============================================================================
#  Sobe o ERP em localhost apontando para o CLUSTER, para a aceitacao pelo
#  navegador. Nao publica nada e nao encosta na producao.
#
#  POR QUE EXISTE
#  A unica coisa que falta para aceitar o cluster e abrir o ERP de verdade:
#  logar, navegar, abrir anexo. `curl` nao prova isso -- o navegador faz
#  preflight de CORS, valida certificado com o proprio repositorio de CAs e
#  executa o bundle. Ja aconteceu neste projeto de tudo passar no curl e o
#  botao nao funcionar na tela.
#
#  A SENHA E SUA, E SO VOCE DIGITA
#  O dump de `auth` ja carregou os 159 usuarios no cluster COM os hashes da
#  producao -- entao sua senha real funciona la. Ela e digitada no navegador,
#  nunca passa por aqui, por variavel de ambiente ou por arquivo.
#
#  A CHAVE ANON NAO E SEGREDO
#  Ela e embutida no bundle e vai para o navegador de todo mundo que abre o
#  ERP -- e assim que um cliente Supabase funciona. Quem protege os dados e a
#  RLS e os grants. Ver o cabecalho de src/integrations/supabase/env.ts.
#
#  O QUE NAO DA PARA TESTAR AINDA
#  SALVAR. O cluster e assinante da replicacao: escrita local pode tomar uma PK
#  que a producao ainda vai replicar, e o conflito de chave duplicada PARA a
#  replicacao. Enquanto a producao nao estiver congelada, o cluster fica com a
#  escrita revogada e o ERP vai recusar gravar -- isso e o esperado, nao e
#  defeito. Leitura, login e anexo sao o que esta em teste.
#
#  USO:
#    bash infra/ha/testar-cluster-local.sh
#  Depois abra o endereco que ele imprime. Para encerrar, Ctrl+C.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."
NO="${NO:-216.238.120.171}"
API="${API:-https://api.grpnascimento.com.br}"
SAIDA="dist-cluster"

echo "== buscando a chave anon do cluster (ela nao e gravada em arquivo nenhum)"
ANON=$(ssh -p 8443 -o BatchMode=yes "root@$NO" "grep -m1 '^ANON_KEY=' /opt/erp/infra/failover/.env | cut -d= -f2-" | tr -d '\r\n')
[ -n "$ANON" ] || { echo "nao consegui ler a ANON_KEY do $NO" >&2; exit 1; }

echo "== conferindo que a API esta de pe antes de gastar um build"
CODIGO=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "$API/auth/v1/health" || echo 000)
[ "$CODIGO" = "200" ] || { echo "$API/auth/v1/health respondeu $CODIGO -- nao vou buildar" >&2; exit 1; }

echo "== build apontando para o cluster (saida em $SAIDA/, fora do dist normal)"
# As variaveis vao pelo ambiente, nao pelo .env: o .env da raiz e RASTREADO
# no git deste repo, e um descuido ali vaza para um repositorio publico.
VITE_SUPABASE_URL="$API" \
VITE_SUPABASE_ANON_KEY="$ANON" \
  npx vite build --outDir "$SAIDA" --emptyOutDir

echo
echo "== conferindo que o bundle aponta mesmo para o cluster"
if grep -rqs "api.grpnascimento.com.br" "$SAIDA"/assets/*.js; then
  echo "   ok: o endereco do cluster esta embutido no bundle"
else
  echo "   ATENCAO: nao achei o endereco do cluster no bundle -- nao use este build" >&2
  exit 1
fi
if grep -rqs "fwmzeaztjxrxxzxzxmgc" "$SAIDA"/assets/*.js; then
  echo "   ATENCAO: o endereco da PRODUCAO tambem esta no bundle -- pare e me avise" >&2
  exit 1
fi
echo "   ok: nenhum vestigio da producao no bundle"

echo
echo "============================================================"
echo "  Abra:  http://localhost:4173"
echo "  Logue com o SEU e-mail e a SUA senha de sempre."
echo "  Salvar vai recusar -- isso e esperado, nao e defeito."
echo "  Ctrl+C aqui encerra."
echo "============================================================"
echo
npx vite preview --outDir "$SAIDA" --port 4173 --strictPort
