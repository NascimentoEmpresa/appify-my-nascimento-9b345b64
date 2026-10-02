#!/usr/bin/env bash
# ============================================================================
#  Promove a replica de "copia somente leitura" para "producao de verdade"
#  ou devolve ela para somente leitura (reverter).
# ============================================================================
#
#  O PROBLEMA QUE ISTO RESOLVE: SPLIT-BRAIN
#  Quando a Supabase cai, a tentacao e mandar todo mundo para a replica
#  imediatamente. O risco de fazer isso sem trava:
#
#    1. a Supabase nao caiu de verdade - ficou LENTA por 2 minutos;
#    2. metade dos navegadores decide que caiu e passa a escrever na replica;
#    3. a outra metade continua escrevendo na Supabase;
#    4. a Supabase volta. Agora existem duas verdades, e a proxima recarga da
#       replica APAGA tudo que foi escrito nela.
#
#  Resultado: pedido aprovado que desaparece, hora extra lancada que nao
#  existe mais. Pior que o sistema ter ficado fora do ar, porque o usuario viu
#  "salvo com sucesso".
#
#  A SOLUCAO: AUTOMATICO LE, HUMANO ESCREVE
#  A replica nasce e vive em SOMENTE LEITURA. Isso nao e combinacao nem
#  convencao de codigo - o Postgres recusa:
#
#      revoke insert, update, delete, truncate on all tables in schema public
#        from authenticated, anon;
#
#  POR QUE REVOKE E NAO default_transaction_read_only: a primeira tentativa
#  usava aquela configuracao por papel. Testado contra a API real em
#  02/10/2026, o POST voltou 201 e o PATCH voltou 204 com a configuracao
#  ativa nos tres papeis - o PostgREST abre a transacao declarando o modo
#  conforme o metodo HTTP, e esse READ WRITE sobrescreve o default. REVOKE e
#  verificado independente do modo da transacao.
#
#  COBRE escrita direta pela API REST (a enorme maioria das telas). NAO cobre
#  RPC SECURITY DEFINER, que roda como o dono - anotado no README.
#
#  Entao a troca automatica pode ser agressiva sem risco: o pior caso de um
#  falso positivo e um usuario consultando dados de algumas horas atras em uma
#  tela que avisa isso. Nada se perde, porque nada se escreve.
#
#  Liberar escrita e DECISAO HUMANA, com este script. Quem roda assume que a
#  Supabase nao vai voltar sozinha em minutos, e que a partir daqui a verdade
#  mora aqui.
#
#  POR QUE O GOTRUE FICA DE FORA DA TRAVA
#  Login ESCREVE: sessao, refresh token, last_sign_in_at. Travar o banco
#  inteiro tiraria o login, e uma replica onde ninguem entra nao serve de
#  nada. A trava e por ROLE: authenticated e anon (o app) ficam em leitura;
#  supabase_auth_admin (o GoTrue) e supabase_storage_admin seguem escrevendo
#  o que e deles. Entao: login funciona, consulta funciona, gravar dado do ERP
#  e recusado.
#
#  USO
#      promover.sh status      o que esta valendo agora
#      promover.sh promover    libera escrita (para a recarga automatica)
#      promover.sh reverter    volta para somente leitura
# ============================================================================
set -uo pipefail

MARCA=/var/lib/postgresql/data/PROMOVIDA
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=postgres
export PGPASSWORD="${POSTGRES_PASSWORD:-}"

sql() { psql -v ON_ERROR_STOP=1 -At -c "$1"; }

# Conta em quantas tabelas o app ainda pode gravar. Le o privilegio DE VERDADE
# (information_schema), nao um arquivo de marca nem uma configuracao: o que
# vale e o que o Postgres faz.
tabelas_gravaveis() {
  psql -At -c "select count(distinct table_name)
                 from information_schema.role_table_grants
                where grantee = authenticated
                  and table_schema = public
                  and privilege_type in (INSERT,UPDATE,DELETE)" 2>/dev/null
}

case "${1:-status}" in

  status)
    echo "=== estado da replica ==="
    n=$(tabelas_gravaveis)
    if [[ "${n:-0}" == "0" ]]; then
      echo "  banco:   SOMENTE LEITURA (nenhuma tabela gravavel pelo app)"
    else
      echo "  banco:   ESCRITA LIBERADA (${n} tabelas gravaveis pelo app)"
    fi
    if [[ -f "$MARCA" ]]; then
      echo "  marca:   PROMOVIDA presente - recarga automatica CANCELADA"
      echo "  desde:   $(date -r "$MARCA" '+%d/%m/%Y %H:%M:%S' 2>/dev/null || echo '?')"
    else
      echo "  marca:   ausente - recarga automatica ativa"
    fi
    # Quao velha e a copia? E a pergunta que importa na hora de decidir.
    idade=$(sql "select coalesce(to_char(max(created_at), 'DD/MM/YYYY HH24:MI'), 'sem dados')
                   from auth.users" 2>/dev/null)
    echo "  dado mais recente em auth.users: ${idade:-?}"
    ;;

  promover)
    echo "=== PROMOVENDO a replica a producao ==="
    echo
    echo "  Isto libera ESCRITA. A partir daqui o que for salvo aqui existe SO"
    echo "  aqui, e a recarga automatica para - senao ela apagaria exatamente"
    echo "  esse trabalho na proxima execucao."
    echo
    echo "  So faz sentido se a Supabase nao vai voltar em minutos. Se a duvida"
    echo "  existe, o certo e esperar: em somente leitura ninguem perde nada."
    echo
    # A marca vem ANTES de liberar a escrita. Se o container morrer no meio, o
    # pior caso e a recarga estar cancelada com o banco ainda em leitura -
    # chato, mas nao perde dado. A ordem inversa perderia.
    touch "$MARCA" || { echo "  ERRO: nao consegui criar $MARCA - abortado"; exit 1; }
    sql "grant insert, update, delete on all tables in schema public to authenticated;" >/dev/null
    sql "grant usage, select on all sequences in schema public to authenticated;" >/dev/null
    # As conexoes JA ABERTAS carregam a configuracao antiga; sem derruba-las, o
    # PostgREST continuaria recusando escrita por minutos sem explicacao.
    sql "select pg_terminate_backend(pid) from pg_stat_activity
          where usename in ('authenticated','anon','authenticator')
            and pid <> pg_backend_pid();" >/dev/null 2>&1
    sql "notify pgrst, 'reload config';" >/dev/null 2>&1
    echo "  PROMOVIDA. Escrita liberada, recarga automatica cancelada."
    echo "  Para voltar atras: promover.sh reverter"
    ;;

  reverter)
    echo "=== devolvendo a replica para SOMENTE LEITURA ==="
    echo
    echo "  ATENCAO: se alguem escreveu aqui enquanto estava promovida, esse"
    echo "  trabalho NAO volta para a Supabase sozinho. Confira antes:"
    sql "select '    ' || relname || ': ' || n_tup_ins || ' inseridos, ' || n_tup_upd || ' alterados'
           from pg_stat_user_tables
          where n_tup_ins + n_tup_upd > 0
          order by n_tup_ins + n_tup_upd desc limit 10;" 2>/dev/null
    echo
    sql "revoke insert, update, delete, truncate on all tables in schema public from authenticated, anon;" >/dev/null
    sql "revoke usage on all sequences in schema public from authenticated, anon;" >/dev/null
    sql "select pg_terminate_backend(pid) from pg_stat_activity
          where usename in ('authenticated','anon','authenticator')
            and pid <> pg_backend_pid();" >/dev/null 2>&1
    rm -f "$MARCA"
    echo "  Somente leitura de volta. Recarga automatica reativada."
    ;;

  *)
    echo "uso: promover.sh [status|promover|reverter]"
    exit 1
    ;;
esac
