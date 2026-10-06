-- ===========================================================================
--  Fila de chamadas HTTP — tira o banco de dentro da rede
-- ===========================================================================
--  POR QUE ISTO EXISTE
--
--  Hoje o banco faz HTTP sozinho, com `net.http_post` (extensão pg_net). Isso
--  cria três problemas, e um deles é um bloqueador:
--
--  1) pg_net é EXCLUSIVO DA SUPABASE. Não existe em RDS, Cloud SQL, Neon nem
--     Postgres puro. Enquanto o banco depender dele, o primário não pode sair
--     da Supabase — ou seja, não há failover automático com escrita.
--
--  2) HTTP dentro de transação é entrega não confiável. Se a transação volta
--     atrás depois do disparo, a chamada JÁ FOI: o sistema externo recebe um
--     evento que, no banco, nunca aconteceu. O inverso também: hoje o erro é
--     engolido com RAISE WARNING, então uma falha de rede perde o aviso em
--     silêncio, sem nova tentativa.
--
--  3) A réplica de contingência não tem pg_net. Conferido em 05/10/2026:
--     `canal_denuncia_avisa_comite` e `chamado_concluido_gera_novidade` estão
--     lá, chamando uma função que não existe. Hoje não aparece porque a
--     réplica recusa escrita — mas promovê-la quebraria essas duas gravações.
--
--  O PADRÃO: caixa de saída (outbox). O gatilho GRAVA a intenção na mesma
--  transação do dado. Se a transação volta atrás, a intenção volta com ela —
--  atômico de graça. Quem entrega é o `worker/`, que já roda a cada 60s, com
--  nova tentativa e alerta quando desiste.
--
--  NÃO MEXE EM pg_cron. Os cinco agendamentos continuam existindo com os
--  mesmos nomes e horários; só o COMANDO deles muda, de `net.http_post` para
--  `enfileirar_http`. pg_cron existe em RDS e Cloud SQL, então não é
--  bloqueador — pg_net era.
--
--  ATENÇÃO AO APLICAR: esta migration reagenda os cinco crons que ESTÃO NO
--  REPO. Se a produção tiver cron criado à mão com outro nome chamando
--  net.http_post, ele continua lá. A conferência está em
--  docs/ha-inventario.md, seção 5.
-- ===========================================================================

-- ── 1) A fila ──────────────────────────────────────────────────────────────
-- Tabela de infraestrutura, então nome minúsculo (como app_menu, profiles).
CREATE TABLE IF NOT EXISTS public.fila_http (
  id                  bigserial PRIMARY KEY,
  -- O NOME da Edge Function, nunca a URL. A URL de hoje está fixa em 7
  -- lugares apontando para o projeto de produção: se os gatilhos disparassem
  -- na réplica, ela chamaria a produção. Guardando só o nome, quem resolve o
  -- endereço é o worker, pelo ambiente dele.
  destino             text        NOT NULL,
  corpo               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  tentativas          integer     NOT NULL DEFAULT 0,
  ultima_tentativa_em timestamptz,
  processado_em       timestamptz,
  erro                text
);

COMMENT ON TABLE public.fila_http IS
  'Caixa de saída de chamadas HTTP. O banco grava a intenção; o worker/ entrega. Substitui pg_net.';

-- Índice só do que falta fazer: a fila processada cresce e não interessa à
-- consulta do worker. Parcial para ficar pequeno mesmo com histórico grande.
CREATE INDEX IF NOT EXISTS idx_fila_http_pendente
  ON public.fila_http (id)
  WHERE processado_em IS NULL;

-- RLS ligada e NENHUMA policy, de propósito: ninguém alcança esta tabela pela
-- API. O worker usa service_role, que ignora RLS. O corpo pode conter id de
-- denúncia do Canal de Ética — não é dado para ficar legível por autenticado.
ALTER TABLE public.fila_http ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fila_http FROM anon, authenticated;

-- ── 2) Quem enfileira ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enfileirar_http(_destino text, _corpo jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF coalesce(_destino, '') = '' THEN
    RAISE EXCEPTION 'enfileirar_http: destino vazio';
  END IF;
  INSERT INTO public.fila_http (destino, corpo)
  VALUES (_destino, coalesce(_corpo, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Só os gatilhos (SECURITY DEFINER, dono postgres) e o cron chamam. Nenhuma
-- tela precisa disso, então nenhum papel de aplicação recebe EXECUTE.
REVOKE ALL ON FUNCTION public.enfileirar_http(text, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 3) Gatilho de chamado concluído → fila ────────────────────────────────
-- O corpo abaixo é o que está NO BANCO hoje (conferido por md5 em 05/10/2026:
-- repo e banco batem, 892 caracteres), com net.http_post trocado pela fila.
-- A URL e a chave anon literais saem junto: quem resolve é o worker.
CREATE OR REPLACE FUNCTION public.chamado_concluido_gera_novidade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM public.enfileirar_http('novidade-ia-chamado', jsonb_build_object('chamado_id', NEW.id));
  EXCEPTION WHEN OTHERS THEN
    -- Mesmo cuidado de antes: avisar nunca pode impedir o usuário de concluir
    -- o chamado. Só que agora a falha é quase impossível - é um INSERT local,
    -- não uma chamada de rede.
    RAISE WARNING 'novidade-ia-chamado não foi enfileirada para %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;  -- AFTER trigger: o retorno é ignorado
END $$;

REVOKE ALL ON FUNCTION public.chamado_concluido_gera_novidade() FROM PUBLIC, anon, authenticated;

-- ── 4) Gatilho do Canal de Ética → fila ───────────────────────────────────
-- ATENÇÃO: o corpo aqui NÃO foi copiado do repo. A versão versionada em
-- 20260925000002 tem 1289 caracteres e a que está no banco tem 779 — alguém
-- editou à mão no SQL Editor, e a do banco é a que vale. Conferido em
-- 05/10/2026. A versão real lia anon_key e functions_url de
-- public.app_config_runtime; com a fila, nenhuma das duas é necessária.
CREATE OR REPLACE FUNCTION public.canal_denuncia_avisa_comite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM public.enfileirar_http('comite-etica-nova-denuncia', jsonb_build_object('denuncia_id', NEW.id));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso do Comite de Etica nao foi enfileirado para %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.canal_denuncia_avisa_comite() FROM PUBLIC, anon, authenticated;

-- ── 5) Os cinco agendamentos passam a enfileirar ──────────────────────────
-- Mesmos nomes e mesmos horários de antes — só o comando muda. Os horários
-- vieram das migrations que os criaram; conferir contra cron.job na produção
-- (docs/ha-inventario.md, seção 5) antes de considerar a lista completa.
DO $$
DECLARE
  v_agenda text[][] := ARRAY[
    ['sla-escalonamento-tick',      '0 * * * *',    'sla-escalonamento-tick'],
    ['regua-cobranca-tick',         '0 * * * *',    'regua-cobranca-tick'],
    ['plano-acao-marcar-atrasadas', '0 6 * * *',    'plano-acao-marcar-atrasadas'],
    ['whatsapp-retomada-tick',      '*/5 * * * *',  'whatsapp-retomada-tick'],
    ['comite-etica-alertas',        '0 8 * * 1-5',  'comite-etica-alertas-tick']
  ];
  v_i int;
BEGIN
  -- Sem pg_cron não há o que reagendar. Acontece na réplica, que não tem a
  -- extensão: a migration precisa rodar lá também, sem explodir.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente - nenhum agendamento alterado (esperado na replica)';
    RETURN;
  END IF;

  FOR v_i IN 1 .. array_length(v_agenda, 1) LOOP
    BEGIN
      PERFORM cron.unschedule(v_agenda[v_i][1]);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'agendamento % nao existia', v_agenda[v_i][1];
    END;

    PERFORM cron.schedule(
      v_agenda[v_i][1],
      v_agenda[v_i][2],
      format(
        $cmd$SELECT public.enfileirar_http(%L, jsonb_build_object('tick_at', now()))$cmd$,
        v_agenda[v_i][3]
      )
    );
  END LOOP;
END $$;

-- ── 6) Conferência ────────────────────────────────────────────────────────
-- Depois de aplicar, nenhuma destas duas deve devolver linha:
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prosrc LIKE '%net.http_post%';
--   SELECT jobname FROM cron.job WHERE command LIKE '%net.http_post%';
-- Quando as duas vierem vazias, pg_net pode ser removida — mas só depois de
-- o worker estar entregando (ver worker/src/filaHttp.js).

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- ROLLBACK
--   -- Os gatilhos voltam a chamar net.http_post: reaplicar
--   --   20260914000001_novidades_ia_chamados.sql  (secao da funcao)
--   --   e a versao DO BANCO de canal_denuncia_avisa_comite (779 ch, usa
--   --   app_config_runtime) - a do repo divergia.
--   -- Os cinco agendamentos voltam reaplicando as migrations que os criaram:
--   --   20260520143839_*, 20260710000004_*, 20260730000001_*,
--   --   20260819000001_*, 20260914000004_*
--   DROP FUNCTION IF EXISTS public.enfileirar_http(text, jsonb);
--   DROP TABLE IF EXISTS public.fila_http;
-- ===========================================================================
