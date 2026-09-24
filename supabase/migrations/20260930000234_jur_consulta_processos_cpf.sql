-- =========================================================================
-- Jurídico: consultar processos de uma pessoa pelo CPF.
--
-- Pedido do Pablo (24/09/2026): "integrar no sistema uma forma de verificar
-- se alguém tem processos pelo CPF" — as duas camadas:
--
-- 1) CONTRA A EMPRESA (grátis, na hora): jur_processos_por_cpf procura o
--    CPF em JUR_PROCESSOS. Casa por
--      · reclamante_vinculado_cpf (591 linhas têm) → "pelo CPF";
--      · nome do reclamante = nome do EMPREGADOS com esse CPF, ou o nome
--        informado (candidato) → "pelo nome" (pode ser homônimo; a tela diz).
--    JUR_PROCESSOS repete o mesmo número em várias linhas (salvar recria as
--    linhas, mig 206): agrupa por numero_processo.
--
-- 2) EM TODOS OS TRIBUNAIS (pago, sob demanda): a Edge Function
--    consulta-processos-cpf chama a API do fornecedor (Escavador) e grava
--    o resultado em JUR_CONSULTA_CPF — quem consultou, quando, por quê e
--    quanto custou. A tela mostra a última consulta salva antes de oferecer
--    uma nova (não paga duas vezes pela mesma coisa sem querer).
--
-- Permissão: menu fantasma juridico_consulta_processos (Jurídico) em
-- Acesso por Usuário. 'visualizar' = ver processos contra a empresa e as
-- consultas já feitas; 'incluir' = rodar consulta paga nos tribunais.
-- Semeado para quem tem Verificação de Candidatos ou Processos Jurídicos
-- (visualizar) — consulta paga ('incluir') ninguém recebe sozinho.
--
-- Uso em contratação: vetar candidato por ter processado ex-empregador é
-- discriminatório (TST). O motivo da consulta paga é obrigatório e fica
-- registrado.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── Permissão ────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'juridico_consulta_processos', 'Consulta de processos por CPF', NULL, 45, true
  FROM public.app_modulo m
 WHERE m.codigo = 'juridico'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = 'juridico_consulta_processos');

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT p.id, 'juridico_consulta_processos', 'visualizar'::app_acao, true,
       'Semeado na criação (mig 20260930000234): já tinha Verificação de Candidatos ou Processos Jurídicos'
  FROM public.profiles p
 WHERE (public.has_screen_access(p.id, 'candidatos', 'visualizar'::app_acao)
        OR public.has_screen_access(p.id, 'juridico_candidatos', 'visualizar'::app_acao)
        OR public.has_screen_access(p.id, 'juridico_processos', 'visualizar'::app_acao))
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = p.id AND x.menu_codigo = 'juridico_consulta_processos'
                      AND x.acao = 'visualizar'::app_acao);

-- ── Registro das consultas pagas ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."JUR_CONSULTA_CPF" (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cpf_digits          text NOT NULL CHECK (cpf_digits ~ '^\d{11}$'),
  nome                text,
  fornecedor          text NOT NULL,
  motivo              text NOT NULL,
  -- [{numero, tribunal, classe, assunto, polo_ativo, polo_passivo, papel, data_inicio, ultima_movimentacao, status}]
  processos           jsonb NOT NULL DEFAULT '[]'::jsonb,
  total               integer NOT NULL DEFAULT 0,
  mais_paginas        boolean NOT NULL DEFAULT false,
  custo_centavos      integer,
  erro                text,
  consultado_por      uuid DEFAULT auth.uid(),
  consultado_por_nome text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jur_consulta_cpf ON public."JUR_CONSULTA_CPF"(cpf_digits, created_at DESC);

ALTER TABLE public."JUR_CONSULTA_CPF" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."JUR_CONSULTA_CPF" FROM PUBLIC, anon;
GRANT SELECT ON public."JUR_CONSULTA_CPF" TO authenticated;
-- Só leitura pelo app; quem grava é a Edge Function (service_role).
DROP POLICY IF EXISTS jur_consulta_cpf_select ON public."JUR_CONSULTA_CPF";
CREATE POLICY jur_consulta_cpf_select ON public."JUR_CONSULTA_CPF" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'juridico_consulta_processos', 'visualizar'::app_acao));

-- ── Processos contra a empresa ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.jur_processos_por_cpf(p_cpf text, p_nome text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cpf   text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_nomes text[];
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'juridico_consulta_processos', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para consultar processos.' USING ERRCODE = '42501';
  END IF;
  IF length(v_cpf) <> 11 THEN
    RAISE EXCEPTION 'Informe um CPF com 11 dígitos.';
  END IF;

  -- Nomes que valem para este CPF: cadastros do EMPREGADOS + o nome informado.
  v_nomes := ARRAY(
    SELECT DISTINCT upper(btrim(n)) FROM (
      SELECT e."Nome" AS n FROM public."EMPREGADOS" e
       WHERE regexp_replace(coalesce(e."CPF", ''), '\D', '', 'g') = v_cpf
      UNION ALL SELECT p_nome
    ) x WHERE length(btrim(coalesce(n, ''))) >= 8);

  RETURN (
    WITH achados AS (
      SELECT j.*,
             (regexp_replace(coalesce(j.reclamante_vinculado_cpf, ''), '\D', '', 'g') = v_cpf) AS pelo_cpf
        FROM public."JUR_PROCESSOS" j
       WHERE regexp_replace(coalesce(j.reclamante_vinculado_cpf, ''), '\D', '', 'g') = v_cpf
          OR upper(btrim(coalesce(j.reclamante, ''))) = ANY (v_nomes)
    ), um_por_numero AS (
      SELECT DISTINCT ON (coalesce(numero_processo, id::text)) *
        FROM achados
       ORDER BY coalesce(numero_processo, id::text), pelo_cpf DESC, updated_at DESC NULLS LAST
    )
    SELECT jsonb_build_object(
      'nomes_usados', to_jsonb(v_nomes),
      'processos', coalesce(jsonb_agg(jsonb_build_object(
          'id', id, 'numero', numero_processo, 'reclamante', reclamante, 'reclamada', reclamada,
          'tipo', tipo_processo, 'status', status, 'comarca', comarca, 'contrato', contrato,
          'ano', ano_processo, 'data_entrada', data_entrada_reclamatoria, 'encerramento', data_encerramento,
          'casou_por', CASE WHEN pelo_cpf THEN 'cpf' ELSE 'nome' END
        ) ORDER BY ano_processo DESC NULLS LAST, numero_processo), '[]'::jsonb))
      FROM um_por_numero);
END $fn$;

REVOKE ALL ON FUNCTION public.jur_processos_por_cpf(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jur_processos_por_cpf(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.jur_processos_por_cpf(text, text);
-- DROP TABLE IF EXISTS public."JUR_CONSULTA_CPF";
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'juridico_consulta_processos';
-- DELETE FROM public.app_menu WHERE codigo = 'juridico_consulta_processos';
-- NOTIFY pgrst, 'reload schema';
