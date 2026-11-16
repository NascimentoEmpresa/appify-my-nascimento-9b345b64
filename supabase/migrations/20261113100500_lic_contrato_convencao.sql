-- =========================================================================
-- LICITAÇÕES › CONTRATOS — CONVENÇÃO COLETIVA DO CONTRATO (13/11/2026)
--
-- PEDIDO (Pablo, com print do modal "Editar Contrato"): vincular uma
-- Convenção Coletiva ao CONTRATO. Vinculada, TODOS os benefícios dos postos
-- do contrato saem dela — no Quadro de Postos do contrato e na Solicitação
-- de Vaga (que escolhe o posto e puxa os benefícios). Mudar um valor é no
-- cadastro da convenção (/app/licitacoes/convencoes), não no posto.
--
-- Até aqui o vínculo era só por posto (LIC_POSTO_CONVENCAO, mig
-- 20261027000930 / 20261028000910), feito na Planilha de Custo. Ele
-- continua existindo para contrato SEM convenção própria; com convenção no
-- contrato, ela vence para todos os postos (o vínculo do posto fica
-- guardado, mas não é usado — tirar a do contrato faz ele voltar a valer).
--
-- Tabela à parte, e não coluna em `contratos`: a policy de escrita de
-- `contratos` é a antiga por empresa (user_empresa, mig 20260714000001),
-- que o README manda não reproduzir. Aqui quem grava é quem edita o Quadro
-- de Postos do contrato (menu fantasma contrato_quadro_postos, mig
-- 20260930000238 — é o bloco cujos benefícios a convenção passa a
-- preencher) ou quem cadastra convenção.
--
-- O VT não está na CCT (mig 20261103002350: vem do decreto municipal), por
-- isso o contrato pode levar também o decreto — vira regras.vt, igual ao
-- vínculo do posto. Sem decreto, o VT fica pendente como já ficava.
--
-- O resolvedor (lic_referencia_do_posto_interno) é o mesmo que a vaga, o
-- retrato da vaga (rec_beneficios_congelar) e a Planilha de Custo usam:
-- mudando ele, todos passam a enxergar a convenção do contrato.
-- Ele devolve `origem` ('contrato' | 'posto') para a tela dizer de onde veio.
--
-- Idempotente.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."LIC_CONTRATO_CONVENCAO" (
  contrato_id    uuid PRIMARY KEY REFERENCES public.contratos(id) ON DELETE CASCADE,
  convencao_id   uuid NOT NULL REFERENCES public."LIC_CONVENCAO_COLETIVA"(id) ON DELETE RESTRICT,
  decreto_id     uuid REFERENCES public."LIC_CONVENCAO_COLETIVA"(id) ON DELETE RESTRICT,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);
CREATE INDEX IF NOT EXISTS idx_lic_contrato_convencao_convencao ON public."LIC_CONTRATO_CONVENCAO"(convencao_id);
CREATE INDEX IF NOT EXISTS idx_lic_contrato_convencao_decreto ON public."LIC_CONTRATO_CONVENCAO"(decreto_id);

-- Carimbo + conferência do tipo: a principal tem de ser CCT (o decreto só
-- traz o VT — de principal, deixaria todo o resto pendente) e o decreto tem
-- de ser decreto.
CREATE OR REPLACE FUNCTION public.lic_contrato_convencao_conferir()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."LIC_CONVENCAO_COLETIVA" c WHERE c.id = NEW.convencao_id AND c.tipo = 'cct') THEN
    RAISE EXCEPTION 'A convenção do contrato tem de ser uma Convenção Coletiva (CCT), não um decreto.' USING ERRCODE = '23514';
  END IF;
  IF NEW.decreto_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public."LIC_CONVENCAO_COLETIVA" c WHERE c.id = NEW.decreto_id AND c.tipo = 'decreto') THEN
    RAISE EXCEPTION 'O decreto do contrato tem de ser um Decreto Municipal.' USING ERRCODE = '23514';
  END IF;
  NEW.atualizado_em := now();
  NEW.atualizado_por := auth.uid();
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.lic_contrato_convencao_conferir() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lic_contrato_convencao_conferir ON public."LIC_CONTRATO_CONVENCAO";
CREATE TRIGGER trg_lic_contrato_convencao_conferir
  BEFORE INSERT OR UPDATE ON public."LIC_CONTRATO_CONVENCAO"
  FOR EACH ROW EXECUTE FUNCTION public.lic_contrato_convencao_conferir();

-- Quem grava o vínculo do contrato.
CREATE OR REPLACE FUNCTION public.lic_contrato_convencao_pode_gravar()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (
       public.has_screen_access(auth.uid(), 'contrato_quadro_postos', 'alterar'::public.app_acao)
    OR public.has_screen_access(auth.uid(), 'contrato_quadro_postos', 'incluir'::public.app_acao)
    OR public.has_screen_access(auth.uid(), 'licitacoes_convencoes', 'alterar'::public.app_acao))
$$;
REVOKE ALL ON FUNCTION public.lic_contrato_convencao_pode_gravar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lic_contrato_convencao_pode_gravar() TO authenticated;

ALTER TABLE public."LIC_CONTRATO_CONVENCAO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."LIC_CONTRATO_CONVENCAO" TO authenticated;

-- Ler: qualquer logado — é o mesmo dado que lic_referencia_do_posto já
-- entrega a quem abre vaga (benefício da CCT não é segredo).
DROP POLICY IF EXISTS lic_contrato_convencao_select ON public."LIC_CONTRATO_CONVENCAO";
CREATE POLICY lic_contrato_convencao_select ON public."LIC_CONTRATO_CONVENCAO" FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS lic_contrato_convencao_write ON public."LIC_CONTRATO_CONVENCAO";
CREATE POLICY lic_contrato_convencao_write ON public."LIC_CONTRATO_CONVENCAO" FOR ALL TO authenticated
  USING ((SELECT public.lic_contrato_convencao_pode_gravar()))
  WITH CHECK ((SELECT public.lic_contrato_convencao_pode_gravar()));

-- ── Resolvedor: a convenção do contrato vence a do posto ─────────────────
-- Mesma assinatura e mesmo formato da 20261027000930, mais `origem`.
CREATE OR REPLACE FUNCTION public.lic_referencia_do_posto_interno(p_contrato_id uuid, p_posto text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ct     public."LIC_CONTRATO_CONVENCAO"%ROWTYPE;
  v_link   public."LIC_POSTO_CONVENCAO"%ROWTYPE;
  v_ids    uuid[];
  v_princ  uuid;
  v_regras jsonb;
  v_posto  text;
  v_em     timestamptz;
  v_origem text;
BEGIN
  IF p_contrato_id IS NULL OR coalesce(btrim(p_posto), '') = '' THEN
    RETURN jsonb_build_object('status', 'sem_posto', 'contrato_id', p_contrato_id, 'posto', p_posto);
  END IF;

  SELECT * INTO v_ct FROM public."LIC_CONTRATO_CONVENCAO" WHERE contrato_id = p_contrato_id;
  IF v_ct.contrato_id IS NOT NULL THEN
    v_origem := 'contrato';
    v_princ  := v_ct.convencao_id;
    v_regras := CASE WHEN v_ct.decreto_id IS NOT NULL THEN jsonb_build_object('vt', v_ct.decreto_id) ELSE '{}'::jsonb END;
    v_posto  := btrim(p_posto);
    v_em     := v_ct.atualizado_em;
  ELSE
    SELECT * INTO v_link FROM public."LIC_POSTO_CONVENCAO"
     WHERE contrato_id = p_contrato_id AND upper(btrim(posto)) = upper(btrim(p_posto));
    IF v_link.id IS NULL THEN
      RETURN jsonb_build_object('status', 'sem_vinculo', 'contrato_id', p_contrato_id, 'posto', btrim(p_posto));
    END IF;
    v_origem := 'posto';
    v_princ  := v_link.convencao_id;
    v_regras := v_link.regras;
    v_posto  := v_link.posto;
    v_em     := v_link.atualizado_em;
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_ids
    FROM (SELECT v_princ AS x
          UNION ALL
          SELECT (r.value #>> '{}')::uuid FROM jsonb_each(v_regras) r
           WHERE (r.value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') t;
  RETURN jsonb_build_object(
    'status', 'vinculado',
    'origem', v_origem,
    'contrato_id', p_contrato_id,
    'posto', v_posto,
    'principal_id', v_princ,
    'regras', v_regras,
    'vinculado_em', v_em,
    'referencias', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'versao', c.versao, 'identificacao', c.identificacao,
               'categoria_profissional', c.categoria_profissional, 'sindicato', c.sindicato,
               'municipio', c.municipio, 'vigencia_inicio', c.vigencia_inicio, 'vigencia_fim', c.vigencia_fim,
               'cct_arquivo_path', c.cct_arquivo_path, 'decreto_numero', c.decreto_numero,
               'decreto_arquivo_path', c.decreto_arquivo_path, 'beneficios', c.beneficios,
               'contrato_nome', coalesce(ctv.nome, ct.nome), 'situacao', c.situacao))
        FROM public."LIC_CONVENCAO_COLETIVA" c
        LEFT JOIN public.contratos ct  ON ct.id = c.contrato_id
        LEFT JOIN public.contratos ctv ON ctv.id = p_contrato_id
       WHERE c.id = ANY (v_ids)), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.lic_referencia_do_posto_interno(uuid, text) FROM PUBLIC, anon, authenticated;

-- Vaga já aberta com retrato "sem vínculo" se acerta sozinha ao abrir
-- (rec_beneficios_da_vaga tenta de novo). A com retrato vinculado guarda a
-- versão que usou — o botão "Usar versão atual" troca.

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (recriar lic_referencia_do_posto_interno como na 20261027000930, sem o bloco do contrato)
-- DROP TABLE IF EXISTS public."LIC_CONTRATO_CONVENCAO";
-- DROP FUNCTION IF EXISTS public.lic_contrato_convencao_pode_gravar();
-- DROP FUNCTION IF EXISTS public.lic_contrato_convencao_conferir();
-- NOTIFY pgrst, 'reload schema';
