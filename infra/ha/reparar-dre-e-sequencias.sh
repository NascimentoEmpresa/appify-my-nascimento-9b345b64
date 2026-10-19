#!/usr/bin/env bash
# ============================================================================
#  DUAS HERANCAS SILENCIOSAS DO RESTORE: a MV do DRE e o contador dos ids
#
#  ACHADO 1 -- O DRE GERENCIAL NUNCA FOI POPULADO, E O CRON FALHA DE 6 EM 6 H
#  `public.tvg_dre_mv` e uma VIEW MATERIALIZADA sobre
#  `mz_60_view_dre_gerencial_competencia` (a contabilidade). O `pg_dump` traz a
#  DEFINICAO da materializada, nao o conteudo -- ela nasceu vazia e marcada
#  como "nao populada". O job 6 do cron tenta atualizar com:
#
#      REFRESH MATERIALIZED VIEW CONCURRENTLY public.tvg_dre_mv
#
#  e o Postgres recusa: "CONCURRENTLY cannot be used when the materialized
#  view is not populated". Falhou em todas as rodadas desde a virada e falharia
#  para sempre -- a condicao que impede o CONCURRENTLY e exatamente a que ele
#  deveria resolver. Um ovo que precisa da galinha.
#
#  POR QUE DESLIGAR, E NAO POPULAR  (decidido em 19/10/2026)
#  A primeira ideia foi popular. A conferencia derrubou a ideia, e o Eduardo
#  estava certo: HOJE NENHUMA TELA LE ESSA MATERIALIZADA.
#    - `tvg_dre_mv` nao tem GRANT nenhum -- nem para `authenticated`. Nenhuma
#      tela consegue ler direto.
#    - o frontend so chama `tvg_painel`, `tvg_responsaveis_capa` e
#      `tvg_meta_equipe_*`, e nenhuma delas alcanca a MV, nem por dentro.
#    - quem le a MV (`tvg_fonte`, `tvg_dre_contratos`, `tvg_tendencia_dre`...)
#      e infraestrutura de um DRE que ainda nao esta ligado na interface.
#  Popular seria gastar CPU de 6 em 6 horas para alimentar tela nenhuma.
#  Entao: desliga o job e deixa a MV dormindo. Quando o DRE for para a tela,
#  `--ligar-dre` faz a primeira carga e religa o job, nessa ordem.
#
#  Desligar tambem limpa o historico do cron. Uma falha que se repete a cada
#  6 horas e ruido, e ruido esconde a falha de verdade quando ela chegar.
#
#  ACHADO 2 -- CONTADOR DE id QUE DEVOLVE UM id JA USADO
#  O alerta do Comite de Etica falhou em 19/10 as 08:00 com
#  `duplicate key value violates unique constraint "fila_http_pkey"`,
#  Key (id)=(865) already exists.
#
#  A causa nao e "a sequencia esta atras do maior id" -- `last_value` era 865,
#  igual ao maior id, e parecia certo. E o `is_called`: uma sequencia com
#  `is_called=false` devolve o PROPRIO `last_value` no proximo `nextval`, nao
#  `last_value+1`. Olhar so o `last_value` nao enxerga isso, e foi por isso que
#  a conferencia de sequencias da virada passou limpa.
#
#  Este script varre TODA sequencia dona de coluna em public/auth/storage e
#  calcula o proximo id de verdade (`is_called ? last+1 : last`). Se esse id ja
#  existe na tabela, corrige com `setval(..., true)`.
#
#  O setval e SEMPRE para frente: `greatest(maior_id, last_value)`. Puxar uma
#  sequencia para tras para "arrumar" e trocar um erro que aparece na hora por
#  um que aparece daqui a seis meses.
#
#  USO
#    bash infra/ha/reparar-dre-e-sequencias.sh --conferir   # so olha
#    bash infra/ha/reparar-dre-e-sequencias.sh --aplicar    # sequencias + desliga o job do DRE
#    bash infra/ha/reparar-dre-e-sequencias.sh --ligar-dre  # so no dia em que o DRE for para a tela
# ============================================================================
set -uo pipefail

BANCO1="${BANCO1:-216.238.120.171}"
PORTA_SSH="${PORTA_SSH:-8443}"
MODO="${1:---conferir}"

case "$MODO" in --conferir|--aplicar|--ligar-dre) ;; *) sed -n '2,56p' "$0"; exit 2 ;; esac

no() { ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=25 \
         -o StrictHostKeyChecking=accept-new "root@$BANCO1" "$@"; }

# O corpo SQL vai por stdin: nada e gravado no no.
gerar_sql() {

  if [ "$MODO" = "--ligar-dre" ]; then
    cat <<'SQL'
\set ON_ERROR_STOP on
\pset format unaligned
\pset fieldsep '|'
\echo == LIGANDO O DRE  (primeira carga SEM concurrently, depois o job)
BEGIN;
SET LOCAL lock_timeout = '5s';
REFRESH MATERIALIZED VIEW public.tvg_dre_mv;
COMMIT;
select count(*) as linhas, count(distinct contrato) as contratos,
       min(competencia) as de, max(competencia) as ate
  from public.tvg_dre_mv;
\echo -- agora o CONCURRENTLY do cron funciona (e o mesmo comando do job 6):
select public.tvg_dre_atualizar() is null as cron_ok;
update cron.job set active = true where command ilike '%tvg_dre_atualizar%';
select jobid, schedule, active from cron.job where command ilike '%tvg_dre_atualizar%';
\echo
\echo -- FALTA UMA COISA que este script nao faz por voce: a MV nao tem GRANT
\echo -- nenhum. Enquanto `authenticated` nao puder ler (direto ou por uma
\echo -- funcao SECURITY DEFINER), a tela continua vazia mesmo com dado dentro.
SQL
    return 0
  fi

  cat <<'SQL'
\set ON_ERROR_STOP on
\pset format unaligned
\pset fieldsep '|'
\echo == 1. a materializada do DRE
-- Sem `count(*)` aqui: ler uma materializada nao populada e ERRO
-- ("has not been populated"), nao lista vazia. A propria conferencia morreria.
select relname, relispopulated as populada,
       pg_size_pretty(pg_total_relation_size(oid)) as tamanho
  from pg_class where relname = 'tvg_dre_mv';
\echo -- quem consegue ler a MV hoje (vazio = nenhuma tela alcanca):
select coalesce(string_agg(distinct grantee, ', '), '(ninguem)') as com_grant
  from information_schema.role_table_grants where table_name = 'tvg_dre_mv';
\echo -- o job do cron:
select jobid, schedule, active from cron.job where command ilike '%tvg_dre_atualizar%';
\echo -- falhas dele:
select count(*) as rodadas_falhadas from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
 where j.command ilike '%tvg_dre_atualizar%' and d.status <> 'succeeded';
\echo
\echo == 2. sequencias cujo proximo id JA existe na tabela
create temp table achados(sequencia text, origem text, maior_id bigint, last_value bigint, is_called boolean, proximo bigint);
do $$
declare r record; mx bigint; lv bigint; chamado boolean; prox bigint;
begin
  for r in
    select n.nspname as esq, c.relname as tab, a.attname as col,
           pg_get_serial_sequence(quote_ident(n.nspname)||'.'||quote_ident(c.relname), a.attname) as seq
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where c.relkind = 'r' and n.nspname in ('public','auth','storage')
       and pg_get_serial_sequence(quote_ident(n.nspname)||'.'||quote_ident(c.relname), a.attname) is not null
  loop
    execute format('select max(%I) from %I.%I', r.col, r.esq, r.tab) into mx;
    if mx is null then continue; end if;
    execute format('select last_value, is_called from %s', r.seq) into lv, chamado;
    prox := case when chamado then lv + 1 else lv end;
    if prox <= mx then
      insert into achados values (r.seq, r.esq||'.'||r.tab||'.'||r.col, mx, lv, chamado, prox);
    end if;
  end loop;
end $$;
select * from achados order by maior_id - proximo desc;
select count(*) as total_a_corrigir from achados;
SQL

  [ "$MODO" = "--aplicar" ] || return 0

  cat <<'SQL'
\echo
\echo == APLICANDO
\echo -- 1. desligando o job do DRE (nenhuma tela le a MV hoje -- ver cabecalho)
update cron.job set active = false where command ilike '%tvg_dre_atualizar%';
select jobid, schedule, active as ainda_ativo from cron.job where command ilike '%tvg_dre_atualizar%';
\echo -- 2. empurrando as sequencias para frente
do $$
declare a record;
begin
  for a in select * from achados loop
    execute format('select setval(%L, %s, true)', a.sequencia, greatest(a.maior_id, a.last_value));
    raise notice '% : proximo id era % (ja existia), agora e %',
      a.origem, a.proximo, greatest(a.maior_id, a.last_value) + 1;
  end loop;
end $$;
\echo
\echo == CONFERINDO DE NOVO (tem que vir zero)
truncate achados;
do $$
declare r record; mx bigint; lv bigint; chamado boolean; prox bigint;
begin
  for r in
    select n.nspname as esq, c.relname as tab, a.attname as col,
           pg_get_serial_sequence(quote_ident(n.nspname)||'.'||quote_ident(c.relname), a.attname) as seq
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where c.relkind = 'r' and n.nspname in ('public','auth','storage')
       and pg_get_serial_sequence(quote_ident(n.nspname)||'.'||quote_ident(c.relname), a.attname) is not null
  loop
    execute format('select max(%I) from %I.%I', r.col, r.esq, r.tab) into mx;
    if mx is null then continue; end if;
    execute format('select last_value, is_called from %s', r.seq) into lv, chamado;
    prox := case when chamado then lv + 1 else lv end;
    if prox <= mx then insert into achados values (r.seq, r.esq||'.'||r.tab||'.'||r.col, mx, lv, chamado, prox); end if;
  end loop;
end $$;
select count(*) as ainda_colidindo from achados;
SQL
}

echo "== $MODO  no banco1 ($BANCO1), pelo HAProxy (sempre o lider)"
echo
gerar_sql | no "SUP=\$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-)
  PGPASSWORD=\"\$SUP\" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -f -" 2>&1
RC=${PIPESTATUS[1]}

echo
case "$MODO" in
  --conferir)
    echo "   Nada foi alterado. Para corrigir:"
    echo "      bash infra/ha/reparar-dre-e-sequencias.sh --aplicar" ;;
  --aplicar)
    [ "$RC" -eq 0 ] && echo "   Feito. O job do DRE para de falhar de 6 em 6 horas." \
                    || echo "   FALHOU -- veja o erro acima." >&2 ;;
  --ligar-dre)
    [ "$RC" -eq 0 ] && echo "   DRE populado e job religado. Falta dar GRANT para a tela ler." \
                    || echo "   FALHOU -- veja o erro acima." >&2 ;;
esac
exit "$RC"
