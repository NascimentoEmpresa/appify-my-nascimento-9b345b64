#!/bin/bash
# ============================================================================
#  Sincroniza o que a replicacao logica NAO traz e o sincronizar-colunas.sh
#  NAO olha: FUNCOES, TRIGGERS, VIEWS, RESTRICOES, NOT NULL e INDICES.
#
#  POR QUE ESTE SCRIPT EXISTE -- O ERRO DE LEITURA QUE ELE CORRIGE
#  O sincronizar-colunas.sh foi escrito para uma pergunta: "por que a
#  replicacao parou?". Ele responde bem. O problema e que ele foi usado como
#  se respondesse outra: "o cluster esta igual a producao?".
#
#  Nao responde. Ele acrescenta a COLUNA CRUA e vai embora. Fica para tras:
#    - o NOT NULL da coluna;
#    - o CHECK e a FOREIGN KEY que vieram na mesma migration;
#    - o indice (inclusive parcial) sobre a coluna nova;
#    - a VIEW que passou a expor a coluna;
#    - a FUNCAO e o TRIGGER que dao sentido a coluna.
#
#  E a replicacao continua verde, porque nada disso a interessa. Ou seja: a
#  divergencia cresce em silencio e so aparece na virada, quando o cluster
#  virar o banco de verdade e uma tela chamar uma funcao que nao existe.
#
#  Medido em 14/10/2026, depois de QUATRO derivas de coluna em dois dias, com
#  a replicacao em "647 de 647, 0 bytes de atraso" -- aparentemente perfeita:
#
#     44 funcoes faltando        (12 trn_*, 21 tvg_*, 3 ferias_*, ...)
#      5 triggers faltando
#      1 view faltando           (v_fluxo_caixa_previsto)
#      1 view desatualizada      (VW_RECRUTAMENTO_CANDIDATOS, 11 colunas atras)
#      3 restricoes faltando     (1 FK, 2 CHECK)
#      3 NOT NULL perdidos
#      1 indice parcial faltando
#      1 funcao com assinatura VELHA no cluster (rec_enxoval_informar)
#
#  O caso das 12 funcoes `trn_*` e o mais ilustrativo: as quatro tabelas
#  TREINAMENTO_* foram trazidas com cuidado, com privilegio e tudo -- e as
#  funcoes do modulo nao. O modulo Treinamentos abriria quebrado na virada, e
#  nenhum numero da replicacao reclamaria.
#
#  A ARMADILHA DO ACL, QUE JA NOS PEGOU
#  `pg_get_functiondef` devolve o corpo da funcao e NAO devolve os GRANTs.
#  Em 13/10/2026 a funcao rec_cancelar_admissao chegou ao cluster executavel
#  por PUBLIC e por anon, sendo SECURITY DEFINER, enquanto na producao so
#  authenticated e service_role podiam chama-la. Uma funcao SECURITY DEFINER
#  aberta ao anon e um buraco de permissao, nao um detalhe de estilo.
#  Por isso aqui toda funcao criada leva, logo atras, um REVOKE total e os
#  GRANTs reconstruidos a partir do `proacl` da producao, um por um.
#
#  O QUE ELE NAO FAZ DE PROPOSITO
#  - Nada na producao. A producao e so LIDA, sempre.
#  - Nao usa CASCADE em lugar nenhum. Se um DROP falhar por dependencia, eu
#    quero ver o erro, nao quero descobrir depois o que foi levado junto.
#  - Nao mexe em politica de RLS. A contagem de politicas bate (1437 = 1437) e
#    politica errada e o tipo de coisa que prefiro reportar a "consertar".
#
#  USO (roda NO banco1, que alcanca a producao e o cluster):
#    SENHA_SUPABASE=... bash sincronizar-schema.sh              # so confere
#    SENHA_SUPABASE=... bash sincronizar-schema.sh --aplicar    # aplica
#
#  Pelo gatilho, da maquina do Eduardo (ele junta a senha na hora):
#    bash infra/ha/disparar-schema.sh
#    bash infra/ha/disparar-schema.sh --aplicar
#
#  O --conferir nao escreve nada e sai com codigo 1 se achar divergencia, para
#  servir de alerta no cron ou no passo 2.1 do roteiro.
# ============================================================================
set -uo pipefail
export LC_ALL=C

ACAO="${1:---conferir}"
REF="${REF:-fwmzeaztjxrxxzxzxmgc}"
[ -n "${SENHA_SUPABASE:-}" ] || { echo "falta SENHA_SUPABASE" >&2; exit 1; }

set -a; . /opt/erp/infra/failover/.env; set +a
PROD="host=db.$REF.supabase.co port=5432 user=postgres dbname=postgres sslmode=require connect_timeout=10"
CLU="host=127.0.0.1 port=5000 user=postgres dbname=postgres"

prod() { PGPASSWORD="$SENHA_SUPABASE" psql "$PROD" -At "$@"; }
clu()  { PGPASSWORD="$PG_SENHA_SUPER"  psql "$CLU"  -At "$@"; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
DDL="$TMP/aplicar.sql"
ACHOU=0

# POR QUE check_function_bodies = off
# Funcao chama funcao. `ferias_saldo` chama `ferias_vendas_12m`, e qualquer
# ordenacao fixa que eu escolha vai errar em algum par: por nome, `saldo` vem
# antes de `vendas` e o CREATE da primeira falha com
#   ERROR: function public.ferias_vendas_12m(bigint, bigint) does not exist
# derrubando a transacao inteira (aconteceu na primeira execucao, em
# 14/10/2026). Ordenar por dependencia exigiria resolver o grafo de chamadas
# lendo o corpo de 44 funcoes -- fragil e desnecessario.
#
# Com o interruptor desligado o Postgres aceita o corpo sem resolver os nomes
# agora; eles sao resolvidos na primeira chamada, quando todas ja existem. E
# exatamente o que o proprio `pg_dump` emite, pelo mesmo motivo.
#
# O preco: um corpo genuinamente quebrado entraria calado. Aceitavel aqui,
# porque a fonte e a producao, onde essas funcoes rodam de verdade -- e porque
# o --conferir roda de novo no fim.
printf 'SET check_function_bodies = off;\n' > "$DDL"

# Transforma uma lista de chaves (uma por linha) numa lista SQL para IN (...).
# A aspa simples e duplicada; os tipos citados ("TREINAMENTOS") passam limpos
# porque dentro de um literal SQL a aspa dupla nao tem significado nenhum.
em_lista() {
  sed "s/'/''/g; s/^/'/; s/\$/'/" | paste -sd, -
}

titulo() { echo; echo "=========== $* ==========="; }

# ── FUNCOES ─────────────────────────────────────────────────────────────────
# Chave = nome + argumentos de identidade. Usar a identidade (e nao a lista
# completa de argumentos) importa: ela ignora nome de parametro e DEFAULT, que
# e exatamente o que o Postgres usa para decidir se duas funcoes sao a mesma.
QF="select p.proname||'|'||pg_get_function_identity_arguments(p.oid)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f';"

prod -c "$QF" | sort > "$TMP/f_prod"
clu  -c "$QF" | sort > "$TMP/f_clu"
comm -23 "$TMP/f_prod" "$TMP/f_clu" > "$TMP/f_falta"
comm -13 "$TMP/f_prod" "$TMP/f_clu" > "$TMP/f_sobra"

titulo "FUNCOES"
echo "producao: $(wc -l < "$TMP/f_prod")   cluster: $(wc -l < "$TMP/f_clu")"

if [ -s "$TMP/f_falta" ]; then
  ACHOU=1
  echo "  FALTA NO CLUSTER ($(wc -l < "$TMP/f_falta")):"
  sed 's/|/(/; s/$/)/; s/^/    - /' "$TMP/f_falta"

  LISTA=$(em_lista < "$TMP/f_falta")
  # Monta, para cada funcao: a definicao, o REVOKE total e os GRANTs do
  # proacl da producao. proacl NULO significa "default do Postgres" (PUBLIC
  # pode executar) -- nesse caso nao emitimos nada, porque a funcao recem
  # criada no cluster nasce com o mesmo default.
  prod -c "
    with f as (
      select p.oid, p.proacl,
             quote_ident(p.proname)||'('||pg_get_function_identity_arguments(p.oid)||')' as sig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f'
         and p.proname||'|'||pg_get_function_identity_arguments(p.oid) in ($LISTA)
    )
    select pg_get_functiondef(f.oid) || E';\n'
        || case when f.proacl is null then ''
           else 'REVOKE ALL ON FUNCTION public.' || f.sig
                || ' FROM PUBLIC, anon, authenticated, service_role;' || E'\n'
                || coalesce((
                     select string_agg('GRANT EXECUTE ON FUNCTION public.' || f.sig || ' TO '
                              || case when g.quem = '' then 'PUBLIC' else quote_ident(g.quem) end
                              || ';', E'\n')
                       from (select split_part(split_part(a::text,'/',1),'=',1) as quem,
                                    split_part(split_part(a::text,'/',1),'=',2) as pode
                               from unnest(f.proacl) a) g
                      where g.pode like '%X%'
                   ), '')
           end
      from f order by f.sig;" >> "$DDL"
fi

if [ -s "$TMP/f_sobra" ]; then
  ACHOU=1
  echo "  SO NO CLUSTER -- assinatura velha, a producao ja mudou ($(wc -l < "$TMP/f_sobra")):"
  sed 's/|/(/; s/$/)/; s/^/    + /' "$TMP/f_sobra"
  echo "    (serao derrubadas SEM cascade: se algo depender delas, o erro aparece)"
  # Sem CASCADE de proposito. Uma sobrecarga velha conviveria em silencio com a
  # nova e uma chamada poderia cair na errada.
  while IFS='|' read -r NOME ARGS; do
    [ -n "$NOME" ] || continue
    echo "DROP FUNCTION IF EXISTS public.\"$NOME\"($ARGS);" >> "$DDL"
  done < "$TMP/f_sobra"
fi

[ -s "$TMP/f_falta" ] || [ -s "$TMP/f_sobra" ] || echo "  identico"

# ── VIEWS ───────────────────────────────────────────────────────────────────
# View nao e replicada: ela e codigo, nao dado. E `CREATE OR REPLACE VIEW` NAO
# serve aqui -- ele recusa mudar a lista de colunas, que e justamente o que
# muda quando a tabela de baixo ganha coluna (foi o caso da
# VW_RECRUTAMENTO_CANDIDATOS, 11 colunas atras da producao). Entao: DROP +
# CREATE, sem CASCADE, e o ACL reconstruido atras.
QV="select viewname from pg_views where schemaname = 'public';"
prod -c "$QV" | sort > "$TMP/v_prod"
clu  -c "$QV" | sort > "$TMP/v_clu"

# Para as que existem nos dois lados, comparar a lista de colunas: igual em
# nome e ordem, ou a view esta velha.
QVC="select c.relname||'|'||a.attnum||'|'||a.attname||'|'||format_type(a.atttypid,a.atttypmod)
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid
      where n.nspname = 'public' and c.relkind = 'v'
        and a.attnum > 0 and not a.attisdropped;"
prod -c "$QVC" | sort > "$TMP/vc_prod"
clu  -c "$QVC" | sort > "$TMP/vc_clu"

comm -23 "$TMP/v_prod" "$TMP/v_clu" > "$TMP/v_falta"
cut -d'|' -f1 <(comm -3 "$TMP/vc_prod" "$TMP/vc_clu" | tr -d '\t') \
  | sort -u > "$TMP/v_difere" || true
# Uma view que falta inteira ja esta em v_falta; nao repetir em v_difere.
comm -12 "$TMP/v_difere" "$TMP/v_clu" > "$TMP/v_velha" || true
cat "$TMP/v_falta" "$TMP/v_velha" | sort -u > "$TMP/v_refazer"

titulo "VIEWS"
echo "producao: $(wc -l < "$TMP/v_prod")   cluster: $(wc -l < "$TMP/v_clu")"
if [ -s "$TMP/v_refazer" ]; then
  ACHOU=1
  [ -s "$TMP/v_falta" ] && { echo "  FALTA NO CLUSTER:"; sed 's/^/    - /' "$TMP/v_falta"; }
  [ -s "$TMP/v_velha" ] && { echo "  DESATUALIZADA (colunas diferem da producao):"; sed 's/^/    ~ /' "$TMP/v_velha"; }

  LISTA=$(em_lista < "$TMP/v_refazer")
  prod -c "
    with v as (
      select c.oid, c.relacl, quote_ident(c.relname) as nome
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v' and c.relname in ($LISTA)
    )
    select 'DROP VIEW IF EXISTS public.' || v.nome || ';' || E'\n'
        || 'CREATE VIEW public.' || v.nome || ' AS ' || E'\n'
        || pg_get_viewdef(v.oid, true) || E'\n'
        || case when v.relacl is null then ''
           else coalesce((
                  select string_agg('GRANT '
                           || case when g.pode like '%r%' then 'SELECT' else '' end
                           || ' ON public.' || v.nome || ' TO '
                           || case when g.quem = '' then 'PUBLIC' else quote_ident(g.quem) end
                           || ';', E'\n')
                    from (select split_part(split_part(a::text,'/',1),'=',1) as quem,
                                 split_part(split_part(a::text,'/',1),'=',2) as pode
                            from unnest(v.relacl) a) g
                   where g.pode like '%r%'
                ), '')
           end
      from v order by v.nome;" >> "$DDL"
else
  echo "  identico"
fi

# ── TRIGGERS ────────────────────────────────────────────────────────────────
# Depois das funcoes de proposito: todo trigger chama uma, e criar o trigger
# antes da funcao existir falha.
QT="select c.relname||'|'||t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal;"
prod -c "$QT" | sort > "$TMP/t_prod"
clu  -c "$QT" | sort > "$TMP/t_clu"
comm -23 "$TMP/t_prod" "$TMP/t_clu" > "$TMP/t_falta"

titulo "TRIGGERS"
echo "producao: $(wc -l < "$TMP/t_prod")   cluster: $(wc -l < "$TMP/t_clu")"
if [ -s "$TMP/t_falta" ]; then
  ACHOU=1
  echo "  FALTA NO CLUSTER ($(wc -l < "$TMP/t_falta")):"
  sed 's/|/ :: /; s/^/    - /' "$TMP/t_falta"
  LISTA=$(em_lista < "$TMP/t_falta")
  # DROP IF EXISTS antes do CREATE porque o Postgres nao tem
  # CREATE OR REPLACE TRIGGER em toda versao, e o DROP torna reexecutavel.
  prod -c "
    select 'DROP TRIGGER IF EXISTS ' || quote_ident(t.tgname)
        || ' ON public.' || quote_ident(c.relname) || ';' || E'\n'
        || pg_get_triggerdef(t.oid, true) || ';'
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal
       and c.relname||'|'||t.tgname in ($LISTA)
     order by c.relname, t.tgname;" >> "$DDL"
else
  echo "  identico"
fi

# ── RESTRICOES ──────────────────────────────────────────────────────────────
# `pg_get_constraintdef` ja carrega o NOT VALID quando existe, e isso importa:
# recriar como VALID uma restricao que na producao e NOT VALID faria o Postgres
# validar linha antiga que a producao perdoa -- a armadilha que travou
# CHAMADO_SISTEMA_AVALIACAO e SIS_CHECKLIST na carga inicial.
QR="select c.conname||'|'||t.relname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public' and c.contype in ('c','f','u','p');"
prod -c "$QR" | sort > "$TMP/r_prod"
clu  -c "$QR" | sort > "$TMP/r_clu"
comm -23 "$TMP/r_prod" "$TMP/r_clu" > "$TMP/r_falta"

titulo "RESTRICOES"
echo "producao: $(wc -l < "$TMP/r_prod")   cluster: $(wc -l < "$TMP/r_clu")"
if [ -s "$TMP/r_falta" ]; then
  ACHOU=1
  echo "  FALTA NO CLUSTER ($(wc -l < "$TMP/r_falta")):"
  sed 's/|/ em /; s/^/    - /' "$TMP/r_falta"
  LISTA=$(em_lista < "$TMP/r_falta")
  prod -c "
    select 'ALTER TABLE public.' || quote_ident(t.relname)
        || ' ADD CONSTRAINT ' || quote_ident(c.conname) || ' '
        || pg_get_constraintdef(c.oid) || ';'
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public' and c.contype in ('c','f','u','p')
       and c.conname||'|'||t.relname in ($LISTA)
     order by t.relname, c.conname;" >> "$DDL"
else
  echo "  identico"
fi

# ── NOT NULL ────────────────────────────────────────────────────────────────
# O sincronizar-colunas.sh cria a coluna com tipo e DEFAULT e perde o NOT NULL.
# Nao para a replicacao -- um NULL que chega da producao nunca existe, porque
# la a coluna e NOT NULL. Morde DEPOIS da virada, quando o cluster virar o
# banco de verdade e aceitar o NULL que a producao recusava.
QN="select c.relname||'|'||a.attname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public' and c.relkind in ('r','p')
       and a.attnum > 0 and not a.attisdropped and a.attnotnull;"
prod -c "$QN" | sort > "$TMP/n_prod"
clu  -c "$QN" | sort > "$TMP/n_clu"
# So cobra NOT NULL de coluna que existe no cluster: coluna ausente e assunto
# do sincronizar-colunas.sh, e cobrar duas vezes vira ruido.
QEX="select c.relname||'|'||a.attname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid
      where n.nspname = 'public' and c.relkind in ('r','p')
        and a.attnum > 0 and not a.attisdropped;"
clu -c "$QEX" | sort > "$TMP/cols_clu"
comm -23 "$TMP/n_prod" "$TMP/n_clu" | sort > "$TMP/n_dif"
comm -12 "$TMP/n_dif" "$TMP/cols_clu" > "$TMP/n_falta"

titulo "NOT NULL"
if [ -s "$TMP/n_falta" ]; then
  ACHOU=1
  echo "  PERDIDO NO CLUSTER ($(wc -l < "$TMP/n_falta")):"
  sed 's/|/./; s/^/    - /' "$TMP/n_falta"
  while IFS='|' read -r T C; do
    [ -n "$T" ] || continue
    echo "ALTER TABLE public.\"$T\" ALTER COLUMN \"$C\" SET NOT NULL;" >> "$DDL"
  done < "$TMP/n_falta"
else
  echo "  identico"
fi

# ── INDICES ─────────────────────────────────────────────────────────────────
# Fora os que sustentam restricao: esses vem junto com a propria restricao e
# criar os dois daria "already exists".
QI="select indexname
      from pg_indexes i
     where schemaname = 'public'
       and not exists (select 1 from pg_constraint c
                        where c.conname = i.indexname
                          and c.connamespace = 'public'::regnamespace);"
prod -c "$QI" | sort > "$TMP/i_prod"
clu  -c "$QI" | sort > "$TMP/i_clu"
comm -23 "$TMP/i_prod" "$TMP/i_clu" > "$TMP/i_falta"

titulo "INDICES"
echo "producao: $(wc -l < "$TMP/i_prod")   cluster: $(wc -l < "$TMP/i_clu")"
if [ -s "$TMP/i_falta" ]; then
  ACHOU=1
  echo "  FALTA NO CLUSTER ($(wc -l < "$TMP/i_falta")):"
  sed 's/^/    - /' "$TMP/i_falta"
  LISTA=$(em_lista < "$TMP/i_falta")
  # Sem CONCURRENTLY: ele nao roda dentro de transacao, e aqui tudo aplica
  # junto. O cluster nao atende usuario ainda, entao o lock nao incomoda
  # ninguem -- na producao a conversa seria outra.
  prod -c "select indexdef || ';' from pg_indexes
            where schemaname = 'public' and indexname in ($LISTA)
            order by indexname;" >> "$DDL"
else
  echo "  identico"
fi

# ── fecho ───────────────────────────────────────────────────────────────────
echo
if [ "$ACHOU" -eq 0 ]; then
  echo "=== SCHEMA: nada divergente. Cluster e producao batem nos 6 blocos. ==="
  exit 0
fi

if [ "$ACAO" != "--aplicar" ]; then
  # Contar linha com ';' daria um numero inutil (um corpo de funcao tem
  # dezenas), e numero inflado tira a confianca do resto do relatorio. Conta
  # objeto, que e a unidade que interessa a quem le.
  TOTAL=$(( $(wc -l < "$TMP/f_falta") + $(wc -l < "$TMP/f_sobra") \
          + $(wc -l < "$TMP/v_refazer") + $(wc -l < "$TMP/t_falta") \
          + $(wc -l < "$TMP/r_falta") + $(wc -l < "$TMP/n_falta") \
          + $(wc -l < "$TMP/i_falta") ))
  echo "=== $TOTAL objeto(s) a sincronizar, $(wc -l < "$DDL") linhas de DDL -- nada foi feito ==="
  echo "    Para inspecionar o DDL:  bash $0 --mostrar"
  [ "$ACAO" = "--mostrar" ] && { echo; cat "$DDL"; }
  exit 1
fi

echo "=== aplicando no cluster ==="
# ON_ERROR_STOP para nao aplicar meia-sincronia: se a funcao 20 falhar, as 21
# a 44 nao entram e o estado continua legivel. Em UMA transacao: ou o schema
# avanca inteiro, ou nao avanca -- schema meio aplicado e o pior dos mundos,
# porque o --conferir seguinte mostraria um resto sem explicacao.
clu -v ON_ERROR_STOP=1 --single-transaction -f "$DDL" 2>&1 | tail -30
RC=${PIPESTATUS[0]}
if [ "$RC" -ne 0 ]; then
  echo "=== FALHOU: nada foi aplicado (transacao unica, rollback completo) ==="
  exit 2
fi

# A producao concede SELECT a anon/authenticated nas views; o cluster esta com
# a escrita REVOGADA ate a virada (secao 1.9 do roteiro) e objeto novo chega
# gravavel. Reaplicar a trava e parte do conserto, nao um extra.
echo "=== reaplicando a trava de escrita (secao 1.9) ==="
clu -c "REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public
          FROM anon, authenticated;
        NOTIFY pgrst, 'reload schema';"
clu -c "select 'escrita no cluster: '||count(*)||' (tem que ser 0)'
          from information_schema.role_table_grants
         where grantee in ('anon','authenticated') and table_schema = 'public'
           and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');"

echo "=== conferindo de novo, do zero ==="
exec env SENHA_SUPABASE="$SENHA_SUPABASE" bash "$0" --conferir
