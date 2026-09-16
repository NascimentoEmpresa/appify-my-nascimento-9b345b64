-- =========================================================================
-- NASCIMENTO FORMULÁRIOS — diagnóstico por IA em TODOS os formulários
--
-- Pedido do Pablo em 15/09/2026: "diagnóstico por IA igual o dos feedbacks
-- em todos os outros formulários".
--
-- A Edge Function diagnostico-formulario-ia agrega TODAS as perguntas de um
-- formulário (sem os eixos liderados/líder do feedback guiado) e grava o
-- resultado na mesma CS_FORM_DIAGNOSTICOS. Duas coisas mudam na tabela:
--
--   1. `tipo` ('feedback' | 'formulario') — o conteúdo tem formato diferente
--      e a tela precisa saber qual é. Tudo o que já existe é 'feedback'.
--   2. setor_norm = '' passa a significar "todas as respostas do formulário".
--      As policies conferiam qtd_respostas contra as respostas DO SETOR;
--      com setor vazio a conta era contra respostas sem setor e o diagnóstico
--      geral nunca passaria. Agora: setor vazio → conta todas as respostas
--      visíveis do formulário. A garantia continua a mesma — só lê o
--      diagnóstico quem enxerga, pela RLS, ao menos as respostas usadas nele.
--
-- Capacidade: a mesma `diagnostico_feedback` (CS_FORM_ACESSOS.papel) — sem
-- gerenciamento de acesso novo.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."CS_FORM_DIAGNOSTICOS"
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'feedback';

ALTER TABLE public."CS_FORM_DIAGNOSTICOS" DROP CONSTRAINT IF EXISTS cs_form_diag_tipo_chk;
ALTER TABLE public."CS_FORM_DIAGNOSTICOS"
  ADD CONSTRAINT cs_form_diag_tipo_chk CHECK (tipo IN ('feedback', 'formulario'));

CREATE INDEX IF NOT EXISTS cs_form_diag_tipo_idx
  ON public."CS_FORM_DIAGNOSTICOS" (formulario_id, tipo, setor_norm, gerado_em DESC);

-- Quantas respostas o usuário atual enxerga do formulário, no recorte pedido
-- (setor_norm vazio = todas). SECURITY INVOKER de propósito: a contagem tem
-- que respeitar a RLS de CS_FORM_RESPOSTAS de quem está lendo.
CREATE OR REPLACE FUNCTION public.cs_form_diag_respostas_visiveis(_formulario_id uuid, _setor_norm text)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT count(*)
    FROM public."CS_FORM_RESPOSTAS" r
   WHERE r.formulario_id = _formulario_id
     AND (coalesce(_setor_norm, '') = ''
          OR regexp_replace(
               translate(upper(btrim(coalesce(r.setor, ''))),
                 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                 'AAAAAEEEEIIIIOOOOOUUUUC'),
               '\s+', ' ', 'g') = _setor_norm);
$fn$;

REVOKE ALL ON FUNCTION public.cs_form_diag_respostas_visiveis(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_diag_respostas_visiveis(uuid, text) TO authenticated;

DROP POLICY IF EXISTS cs_form_diag_select ON public."CS_FORM_DIAGNOSTICOS";
CREATE POLICY cs_form_diag_select ON public."CS_FORM_DIAGNOSTICOS"
  FOR SELECT TO authenticated
  USING (
    public.cs_form_cap('diagnostico_feedback')
    AND qtd_respostas <= public.cs_form_diag_respostas_visiveis(formulario_id, setor_norm)
  );

DROP POLICY IF EXISTS cs_form_diag_insert ON public."CS_FORM_DIAGNOSTICOS";
CREATE POLICY cs_form_diag_insert ON public."CS_FORM_DIAGNOSTICOS"
  FOR INSERT TO authenticated
  WITH CHECK (
    public.cs_form_cap('diagnostico_feedback')
    AND gerado_por = auth.uid()
    AND qtd_respostas <= public.cs_form_diag_respostas_visiveis(formulario_id, setor_norm)
  );

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   Recriar as policies da 20260930000038 (conta por setor) e:
--   DROP FUNCTION IF EXISTS public.cs_form_diag_respostas_visiveis(uuid, text);
--   DROP INDEX IF EXISTS public.cs_form_diag_tipo_idx;
--   ALTER TABLE public."CS_FORM_DIAGNOSTICOS" DROP CONSTRAINT IF EXISTS cs_form_diag_tipo_chk;
--   ALTER TABLE public."CS_FORM_DIAGNOSTICOS" DROP COLUMN IF EXISTS tipo;
-- =========================================================================
