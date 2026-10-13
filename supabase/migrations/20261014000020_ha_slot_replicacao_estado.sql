-- ===========================================================================
--  SIS-2026-0276 — vigia do slot de replicação do corte para o cluster próprio
--
--  POR QUE ISTO EXISTE
--
--  Na fase do corte (ver docs/ha-corte-roteiro.md) a produção passa a ter um
--  slot de replicação lógica alimentando o cluster de alta disponibilidade.
--  Slot é o único objeto deste banco que pode derrubar a produção sozinho:
--  enquanto ele não é consumido, o Postgres **não pode apagar o WAL** que o
--  assinante ainda não leu. Assinatura travada = disco enchendo = banco fora.
--
--  O painel da Supabase mostra o disco, mas painel só avisa quem está
--  olhando — foi exatamente a lição de 23/09/2026, quando o banco ficou mais
--  de 20 minutos inalcançável e a equipe soube porque um usuário ligou.
--  Por isso o vigia é o worker (worker/src/saudeBanco.js), que manda DM, e
--  não uma tela.
--
--  POR QUE UM RPC, E NÃO LEITURA DIRETA
--
--  `pg_replication_slots` não é tabela: é view sobre uma função de sistema, e
--  o PostgREST não a expõe. O worker fala REST com a chave `service_role`,
--  então a leitura precisa de um RPC. SECURITY DEFINER porque o dono
--  (`postgres`) é quem tem o privilégio — conferido em 13/10/2026: ele não é
--  superusuário, mas `has_function_privilege('pg_get_replication_slots()')`
--  devolve true.
--
--  Só `service_role` executa. Isto é informação de infraestrutura: `anon` e
--  `authenticated` não têm o que fazer com ela.
-- ===========================================================================

create or replace function public.ha_slot_replicacao_estado()
returns table (
  slot           text,
  tipo           text,
  ativo          boolean,
  atraso_bytes   bigint,
  atraso_legivel text,
  wal_atual      text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- coalesce porque slot físico não tem confirmed_flush_lsn; o restart_lsn
  -- cumpre o mesmo papel de "até onde ele já leu".
  select s.slot_name::text,
         s.slot_type::text,
         s.active,
         pg_wal_lsn_diff(pg_current_wal_lsn(), coalesce(s.confirmed_flush_lsn, s.restart_lsn))::bigint,
         pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), coalesce(s.confirmed_flush_lsn, s.restart_lsn))),
         pg_current_wal_lsn()::text
    from pg_replication_slots s
   order by 4 desc nulls last;
$$;

revoke all on function public.ha_slot_replicacao_estado() from public;
revoke all on function public.ha_slot_replicacao_estado() from anon, authenticated;
grant execute on function public.ha_slot_replicacao_estado() to service_role;

comment on function public.ha_slot_replicacao_estado() is
  'SIS-2026-0276: atraso de cada slot de replicação, em bytes. Lido pelo worker '
  'para avisar por DM antes do WAL encher. Só service_role executa.';

notify pgrst, 'reload schema';

-- ROLLBACK
-- drop function if exists public.ha_slot_replicacao_estado();
-- notify pgrst, 'reload schema';
