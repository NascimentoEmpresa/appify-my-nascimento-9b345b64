-- =========================================================================
-- RESCISÕES — de volta para Recursos Humanos, com os status da planilha e
-- a linha nascendo sozinha quando o RH libera a demissão (22/10/2026)
--
-- PEDIDO (Pablo, 22/10/2026): "O sistema de rescisões tá completamente
-- diferente … tem que parecer a planilha só que melhor e integrado ao sistema
-- de demissões. Os encarregados solicitam demissões e vai pra lá; quando o RH
-- aprova a demissão entra os dados na planilha de rescisões. E não pode ter um
-- módulo só pra rescisões, tem que ficar dentro de recursos humanos."
--
-- O QUE MUDA
--   1. STATUS = a lista suspensa da coluna STATUS da PLANILHA DE RESCISÃO
--      Geral 2026 (são 10; a mig 20261021000030 tinha juntado tudo em 5 e
--      "PENDÊNCIA", "RECALCULAR", "GUIA PENDENTE", "FAZER VA" e "URGENTE"
--      viravam "Por fazer"). Concluídas são as duas que o RH usa como fim:
--      "Rescisão OK" e "Rescisão e documentos OK" (esta = nada faltando de
--      documento). Os nomes antigos são renomeados ('Por fazer' → 'Rescisão
--      por fazer', 'Feita' → 'Rescisão feita'), e a linha importada que
--      nunca foi mexida por ninguém volta ao status fino que estava no Excel
--      (planilha_original), o que a normalização de antes tinha apagado.
--   2. A LINHA NASCE NO BANCO, não na tela: o gatilho
--      trg_demissao_cria_rescisao, na solicitação, cria a RH_RESCISAO no
--      momento em que o RH libera (Pendente RH → qualquer etapa seguinte),
--      já com empresa/matrícula (EMPREGADOS), contrato, aviso, último dia,
--      tipo de desligamento e as datas de demissão/pagamento pela régua da
--      planilha (trabalhado = último dia + 7; pagamento = demissão + 5 —
--      a mesma de src/lib/demissao/rescisao.ts). Antes a linha do ERP só
--      existia na primeira vez que alguém editava; até lá a tela inventava
--      uma linha "sugerida" — e o que não estava gravado não aparecia em
--      relatório nenhum. As solicitações que já passaram do RH ganham a sua
--      linha aqui (o mesmo que a tela já mostrava como "Por fazer").
--   3. MENU: rescisoes_gestao sai do módulo próprio 'rescisoes' (que fica
--      inativo) e vai para Recursos Humanos, logo depois de Solicitações de
--      Demissão, com o nome "Rescisões". O código do menu NÃO muda — as
--      permissões de quem já usa (perfis e exceções por usuário) continuam
--      valendo e a RLS da RH_RESCISAO (mig 20261021000030) segue igual.
--
-- Os dados da planilha continuam entrando pela tela (botão "Importar
-- planilha"), nunca por migration: nome e matrícula de gente desligada não
-- vão para o git.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Status: a lista da planilha ───────────────────────────────────

-- As renomeações abaixo não são troca de status de verdade: sem os gatilhos,
-- o histórico não ganha "Por fazer → Rescisão por fazer" e status_desde não
-- zera em todo mundo.
ALTER TABLE public."RH_RESCISAO" DISABLE TRIGGER trg_rh_rescisao_historico;
ALTER TABLE public."RH_RESCISAO" DISABLE TRIGGER trg_rh_rescisao_tocar;

ALTER TABLE public."RH_RESCISAO" DROP CONSTRAINT IF EXISTS rh_rescisao_status_chk;

UPDATE public."RH_RESCISAO" SET status_rescisao = 'Rescisão por fazer' WHERE status_rescisao = 'Por fazer';
UPDATE public."RH_RESCISAO" SET status_rescisao = 'Rescisão feita'     WHERE status_rescisao = 'Feita';
UPDATE public."RH_RESCISAO_HISTORICO" SET status_de   = 'Rescisão por fazer' WHERE status_de   = 'Por fazer';
UPDATE public."RH_RESCISAO_HISTORICO" SET status_para = 'Rescisão por fazer' WHERE status_para = 'Por fazer';
UPDATE public."RH_RESCISAO_HISTORICO" SET status_de   = 'Rescisão feita'     WHERE status_de   = 'Feita';
UPDATE public."RH_RESCISAO_HISTORICO" SET status_para = 'Rescisão feita'     WHERE status_para = 'Feita';

-- O status do Excel → a lista nova. Mesma régua de normalizarStatusRescisao
-- (src/lib/demissao/rescisao.ts) — mexeu numa, mexa na outra.
CREATE OR REPLACE FUNCTION public.rh_rescisao_status_da_planilha(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  WITH t AS (
    SELECT upper(translate(coalesce(p_texto, ''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                                                  'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) AS s
  )
  SELECT CASE
    WHEN s ~ 'INSS'                    THEN 'Encaminhado ao INSS'
    WHEN s ~ 'URGENTE'                 THEN 'Rescisão urgente por fazer'
    WHEN s ~ 'POR FAZER'               THEN 'Rescisão por fazer'
    WHEN s ~ 'RECALC'                  THEN 'Recalcular'
    WHEN s ~ 'GUIA'                    THEN 'Guia pendente'
    WHEN s ~ 'PENDENC'                 THEN 'Pendência'
    WHEN s ~ '(^| )VA( |$)'            THEN 'Fazer VA'
    WHEN s ~ 'DOCUMENTOS'              THEN 'Rescisão e documentos OK'
    WHEN s ~ 'FEITA'                   THEN 'Rescisão feita'
    WHEN s ~ 'OK'                      THEN 'Rescisão OK'
    ELSE NULL
  END
  FROM t
$fn$;

-- A linha importada que ninguém moveu depois (o histórico só tem a criação)
-- volta ao status fino do Excel. O cabeçalho da coluna é "STATUS." na aba
-- RESCISÕES e na HOMOLOGAÇÃO.
UPDATE public."RH_RESCISAO" r
   SET status_rescisao = public.rh_rescisao_status_da_planilha(r.planilha_original ->> 'STATUS.')
 WHERE r.planilha_original ? 'STATUS.'
   AND public.rh_rescisao_status_da_planilha(r.planilha_original ->> 'STATUS.') IS NOT NULL
   AND r.status_rescisao IS DISTINCT FROM public.rh_rescisao_status_da_planilha(r.planilha_original ->> 'STATUS.')
   AND NOT EXISTS (SELECT 1 FROM public."RH_RESCISAO_HISTORICO" h
                    WHERE h.rescisao_id = r.id AND h.status_de IS NOT NULL);

UPDATE public."RH_RESCISAO" SET status_rescisao = 'Rescisão por fazer' WHERE status_rescisao IS NULL;

ALTER TABLE public."RH_RESCISAO" ADD CONSTRAINT rh_rescisao_status_chk CHECK (status_rescisao IN (
  'Rescisão por fazer', 'Rescisão urgente por fazer', 'Recalcular', 'Guia pendente', 'Pendência',
  'Fazer VA', 'Rescisão feita', 'Encaminhado ao INSS', 'Rescisão OK', 'Rescisão e documentos OK'));
ALTER TABLE public."RH_RESCISAO" ALTER COLUMN status_rescisao SET DEFAULT 'Rescisão por fazer';
ALTER TABLE public."RH_RESCISAO" ALTER COLUMN status_rescisao SET NOT NULL;

ALTER TABLE public."RH_RESCISAO" ENABLE TRIGGER trg_rh_rescisao_tocar;
ALTER TABLE public."RH_RESCISAO" ENABLE TRIGGER trg_rh_rescisao_historico;

COMMENT ON COLUMN public."RH_RESCISAO".status_rescisao IS
  'A coluna STATUS da planilha de rescisão (10 valores). Concluídas: Rescisão OK e Rescisão e documentos OK. Mig 20261022000400.';

-- ── 2. A linha nasce quando o RH libera ──────────────────────────────

-- Monta e grava a linha da rescisão de UMA solicitação (sem sobrescrever a
-- que já existe). Usada pelo gatilho e pelo preenchimento das antigas abaixo.
CREATE OR REPLACE FUNCTION public.rh_rescisao_criar_da_solicitacao(p_solicitacao_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  s       public."SISTEMA_SOLICITACOES_DEMISSAO"%ROWTYPE;
  v_emp   text;
  v_mat   text;
  v_tipo  text;
  v_dem   date;
BEGIN
  SELECT * INTO s FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE id = p_solicitacao_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Empresa (código → a sigla que a planilha usa) e matrícula do cadastro.
  SELECT CASE e."Empresa"::text WHEN '1' THEN 'HAGG' WHEN '2' THEN 'SN' WHEN '3' THEN 'CANAA' WHEN '5' THEN 'NH'
                                ELSE NULLIF(e."Empresa"::text, '') END,
         NULLIF(e."Cadastro"::text, '')
    INTO v_emp, v_mat
    FROM public."EMPREGADOS" e
   WHERE s.colaborador_id IS NOT NULL AND e."ID"::text = s.colaborador_id::text
   LIMIT 1;

  -- Tipo de desligamento pelo motivo + modelo do aviso (tipoPelaSolicitacao).
  v_tipo := CASE
    WHEN s.motivo_solicitacao LIKE 'Pedido de demissão%' THEN
      CASE WHEN s.modelo_aviso = 'Aviso Prévio Trabalhado' THEN 'Pedido de demissão (vai cumprir aviso)' ELSE 'Pedido de demissão' END
    WHEN s.motivo_solicitacao = 'Desligamento sem justa causa' THEN
      CASE s.modelo_aviso WHEN 'Aviso Prévio Trabalhado' THEN 'Sem justa causa - trabalhado'
                          WHEN 'Aviso Prévio Indenizado' THEN 'Sem justa causa - indenizado' END
    WHEN s.motivo_solicitacao = 'Desligamento por justa causa'       THEN 'Justa causa'
    WHEN s.motivo_solicitacao = 'Término de contrato de experiência' THEN 'Término de contrato'
    WHEN s.motivo_solicitacao = 'Abandono de emprego'                THEN 'Abandono de emprego'
  END;

  -- A régua da planilha: trabalhado = último dia + 7; os outros, o próprio último dia.
  v_dem := CASE WHEN v_tipo = 'Sem justa causa - trabalhado' THEN s.rh_ultima_data_trabalhada + 7
                ELSE s.rh_ultima_data_trabalhada END;

  INSERT INTO public."RH_RESCISAO" (
    solicitacao_id, origem, empresa, matricula, colaborador_nome, contrato,
    data_recebimento, solicitado_por, data_aviso, data_ultimo_dia, data_demissao, data_pagamento,
    tipo_desligamento, data_admissao, status_rescisao, atualizado_por
  ) VALUES (
    s.id, 'erp', v_emp, v_mat, s.colaborador_nome, s.contrato,
    COALESCE(s.data_solicitacao, (s.criado_em AT TIME ZONE 'America/Sao_Paulo')::date),
    COALESCE(NULLIF(s.solicitante_nome, ''), 'ERP NASCIMENTO'),
    s.data_aviso, s.rh_ultima_data_trabalhada, v_dem, v_dem + 5,
    v_tipo, s.colaborador_admissao, 'Rescisão por fazer', s.rh_por
  )
  ON CONFLICT (solicitacao_id) DO NOTHING;
END $fn$;
REVOKE ALL ON FUNCTION public.rh_rescisao_criar_da_solicitacao(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rh_rescisao_criar_da_solicitacao(bigint) FROM anon;
REVOKE ALL ON FUNCTION public.rh_rescisao_criar_da_solicitacao(bigint) FROM authenticated;

-- SECURITY DEFINER: quem libera é o RH da solicitação; a linha da rescisão
-- tem que nascer mesmo que essa pessoa não tenha a tela Rescisões.
CREATE OR REPLACE FUNCTION public.demissao_cria_rescisao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- "Quando o RH aprova a demissão entra na planilha": é a saída do Pendente
  -- RH para a etapa SEGUINTE. Lista positiva: devolver ao Operacional/
  -- Diretoria, reprovar ou cancelar ali não cria nada.
  IF OLD.status = 'Pendente RH'
     AND NEW.status IN ('Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida',
                        'Agendamento concluído', 'ASO válido', 'Concluída') THEN
    PERFORM public.rh_rescisao_criar_da_solicitacao(NEW.id);
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.demissao_cria_rescisao() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demissao_cria_rescisao() FROM anon;

DROP TRIGGER IF EXISTS trg_demissao_cria_rescisao ON public."SISTEMA_SOLICITACOES_DEMISSAO";
CREATE TRIGGER trg_demissao_cria_rescisao
  AFTER UPDATE OF status ON public."SISTEMA_SOLICITACOES_DEMISSAO"
  FOR EACH ROW EXECUTE FUNCTION public.demissao_cria_rescisao();

-- As que o RH já liberou e ainda não têm linha: a tela já as mostrava como
-- "Por fazer" (linha sugerida); agora a linha existe de verdade.
SELECT public.rh_rescisao_criar_da_solicitacao(s.id)
  FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
 WHERE s.status IN ('Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida',
                    'Agendamento concluído', 'ASO válido', 'Concluída')
   AND NOT EXISTS (SELECT 1 FROM public."RH_RESCISAO" r WHERE r.solicitacao_id = s.id);

-- ── 3. Menu: dentro de Recursos Humanos ──────────────────────────────
-- Mesmo código (rescisoes_gestao): permissões e RLS continuam valendo.
UPDATE public.app_menu am
   SET modulo_id = rh.id,
       nome      = 'Rescisões',
       ativo     = true,
       ordem     = COALESCE((SELECT d.ordem FROM public.app_menu d WHERE d.codigo = 'rh_demissoes' AND d.modulo_id = rh.id LIMIT 1), am.ordem)
  FROM public.app_modulo rh
 WHERE rh.codigo = 'rh' AND am.codigo = 'rescisoes_gestao';

UPDATE public.app_modulo SET ativo = false WHERE codigo = 'rescisoes';

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- UPDATE public.app_modulo SET ativo = true WHERE codigo = 'rescisoes';
-- UPDATE public.app_menu am SET modulo_id = m.id, nome = 'Gestão de Rescisões', ordem = 1
--   FROM public.app_modulo m WHERE m.codigo = 'rescisoes' AND am.codigo = 'rescisoes_gestao';
-- DROP TRIGGER IF EXISTS trg_demissao_cria_rescisao ON public."SISTEMA_SOLICITACOES_DEMISSAO";
-- DROP FUNCTION IF EXISTS public.demissao_cria_rescisao();
-- DROP FUNCTION IF EXISTS public.rh_rescisao_criar_da_solicitacao(bigint);
--   (as linhas criadas ficam; para tirar só as que ninguém mexeu:
--    DELETE FROM public."RH_RESCISAO" r WHERE r.origem = 'erp' AND r.planilha_chave IS NULL
--      AND r.status_rescisao = 'Rescisão por fazer'
--      AND NOT EXISTS (SELECT 1 FROM public."RH_RESCISAO_HISTORICO" h WHERE h.rescisao_id = r.id AND h.status_de IS NOT NULL);)
-- ALTER TABLE public."RH_RESCISAO" ALTER COLUMN status_rescisao DROP NOT NULL;
-- ALTER TABLE public."RH_RESCISAO" ALTER COLUMN status_rescisao DROP DEFAULT;
-- ALTER TABLE public."RH_RESCISAO" DROP CONSTRAINT IF EXISTS rh_rescisao_status_chk;
-- UPDATE public."RH_RESCISAO" SET status_rescisao = CASE
--   WHEN status_rescisao IN ('Rescisão por fazer', 'Rescisão urgente por fazer', 'Recalcular', 'Guia pendente', 'Pendência', 'Fazer VA') THEN 'Por fazer'
--   WHEN status_rescisao = 'Rescisão feita' THEN 'Feita' ELSE status_rescisao END;
-- ALTER TABLE public."RH_RESCISAO" ADD CONSTRAINT rh_rescisao_status_chk CHECK (status_rescisao IS NULL OR status_rescisao IN
--   ('Por fazer', 'Feita', 'Rescisão OK', 'Rescisão e documentos OK', 'Encaminhado ao INSS'));
-- DROP FUNCTION IF EXISTS public.rh_rescisao_status_da_planilha(text);
-- NOTIFY pgrst, 'reload schema';
