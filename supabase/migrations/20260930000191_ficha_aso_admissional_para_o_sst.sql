-- =========================================================================
-- Recrutamento → SST: ficha do ASO admissional com SÓ o que o SST precisa
--
-- CHAMADO (SST, 18/09/2026): "algumas informações encaminhadas pelo
-- Recrutamento são além do necessário. Seguem os dados necessários para a
-- abertura do exame: Tipo de ASO, Nome, Data de Nascimento, Nome da Mãe,
-- Função, CPF, RG, PIS, Setor/Posto, Local/Cidade, Celular, E-mail, Empresa,
-- Contrato, Encarregado Responsável."
--
-- O QUE MUDA
--   1. WA_CURRICULOS ganha o PIS (não existia) e três campos de preenchimento
--      do Recrutamento pra quando o automático não acha: aso_posto,
--      aso_empresa, aso_encarregado.
--   2. rec_ficha_aso(candidato_id) monta a ficha inteira, automático:
--        • candidato: nome, nascimento, mãe, CPF, RG, PIS, celular, e-mail
--          (WA_CURRICULOS);
--        • função = cargo da vaga; contrato = contrato da vaga; local/cidade
--          = cidade da vaga;
--        • setor/posto = aso_posto → sup_posto (posto_id) → local_exato;
--        • empresa = aso_empresa → empresas via contratos (contrato_id) →
--          CONTRATOS."NOME EMPRESA" pelo nome do contrato;
--        • encarregado = aso_encarregado → RH_CONTRATO_ENCARREGADO →
--          quem abriu a vaga (solicitante, traduzido por EMPREGADOS).
--      Devolve também `faltando`: o que ficou vazio, pro Recrutamento
--      preencher no kanban antes de o SST agendar.
--   Quem lê: quem enxerga o candidato (mesma régua da wa_curriculos_gate).
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."WA_CURRICULOS"
  ADD COLUMN IF NOT EXISTS pis             text,
  ADD COLUMN IF NOT EXISTS aso_posto       text,
  ADD COLUMN IF NOT EXISTS aso_empresa     text,
  ADD COLUMN IF NOT EXISTS aso_encarregado text;
COMMENT ON COLUMN public."WA_CURRICULOS".aso_encarregado IS
  'Encarregado responsável informado pelo Recrutamento pra ficha do ASO, quando o automático (RH_CONTRATO_ENCARREGADO / solicitante da vaga) não resolve. 18/09/2026.';

CREATE OR REPLACE FUNCTION public.rec_ficha_aso(_candidato_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c   record;
  v   record;
  f   jsonb;
  v_posto text; v_empresa text; v_enc text; v_falta text[] := '{}';
BEGIN
  IF NOT (has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
       OR has_screen_access(auth.uid(), 'sst_aso', 'visualizar'::app_acao)
       OR has_screen_access(auth.uid(), 'candidatos', 'visualizar'::app_acao)
       OR has_screen_access(auth.uid(), 'sup_epis_admissao', 'visualizar'::app_acao)
       OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'::app_acao)) THEN
    RAISE EXCEPTION 'Sem acesso à ficha do candidato.';
  END IF;

  SELECT * INTO c FROM public."WA_CURRICULOS" WHERE id = _candidato_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Candidato #% não existe.', _candidato_id; END IF;
  SELECT * INTO v FROM public."SISTEMA_RECRUTAMENTO" WHERE id = c.vaga_id;

  -- Setor/Posto
  v_posto := nullif(btrim(coalesce(c.aso_posto, '')), '');
  IF v_posto IS NULL AND v.posto_id IS NOT NULL THEN SELECT p.nome INTO v_posto FROM public.sup_posto p WHERE p.id = v.posto_id; END IF;
  IF v_posto IS NULL THEN v_posto := nullif(btrim(coalesce(v.local_exato, '')), ''); END IF;

  -- Empresa
  v_empresa := nullif(btrim(coalesce(c.aso_empresa, '')), '');
  IF v_empresa IS NULL AND v.contrato_id IS NOT NULL THEN
    SELECT coalesce(e.nome_fantasia, e.razao_social) INTO v_empresa
      FROM public.contratos ct JOIN public.empresas e ON e.id = ct.empresa_id WHERE ct.id = v.contrato_id;
  END IF;
  IF v_empresa IS NULL AND v.contrato IS NOT NULL THEN
    SELECT k."NOME EMPRESA" INTO v_empresa FROM public."CONTRATOS" k
     WHERE k."ATIVO" = 'SIM' AND v.contrato ILIKE '%' || k."NOME CONTRATO" || '%' ORDER BY length(k."NOME CONTRATO") DESC LIMIT 1;
  END IF;

  -- Encarregado responsável
  v_enc := nullif(btrim(coalesce(c.aso_encarregado, '')), '');
  IF v_enc IS NULL AND v.contrato IS NOT NULL THEN
    SELECT r.encarregado_nome INTO v_enc FROM public."RH_CONTRATO_ENCARREGADO" r WHERE r.contrato = v.contrato LIMIT 1;
  END IF;
  IF v_enc IS NULL AND v.solicitante_nome IS NOT NULL THEN
    -- Quem abriu a vaga é o encarregado do posto; gravado às vezes só pelo e-mail.
    IF v.solicitante_nome LIKE '%@%' THEN
      SELECT e."Nome" INTO v_enc FROM public."EMPREGADOS" e WHERE lower(e.email) = lower(v.solicitante_nome) LIMIT 1;
      v_enc := coalesce(v_enc, v.solicitante_nome);
    ELSE
      v_enc := v.solicitante_nome;
    END IF;
  END IF;

  f := jsonb_build_object(
    'candidato_id', c.id,
    'vaga_id', v.id,
    'tipo_aso', 'Admissional',
    'nome', c.nome,
    'nascimento', c.data_nascimento,
    'nome_mae', c.nome_mae,
    'funcao', v.cargo,
    'cpf', c.cpf,
    'rg', c.rg,
    'pis', c.pis,
    'posto', v_posto,
    'local_cidade', v.cidade,
    'celular', c.telefone,
    'email', c.email,
    'empresa', v_empresa,
    'contrato', v.contrato,
    'encarregado', v_enc,
    -- o que o Recrutamento gravou à mão (pra tela editar sem confundir com o automático)
    'aso_posto', c.aso_posto, 'aso_empresa', c.aso_empresa, 'aso_encarregado', c.aso_encarregado
  );
  SELECT coalesce(array_agg(k), '{}') INTO v_falta
    FROM unnest(ARRAY['nome','nascimento','nome_mae','funcao','cpf','rg','pis','posto','local_cidade','celular','email','empresa','contrato','encarregado']) k
   WHERE nullif(btrim(coalesce(f->>k, '')), '') IS NULL;
  RETURN f || jsonb_build_object('faltando', to_jsonb(v_falta));
END $fn$;
REVOKE ALL ON FUNCTION public.rec_ficha_aso(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_ficha_aso(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.rec_ficha_aso(bigint);
-- ALTER TABLE public."WA_CURRICULOS" DROP COLUMN IF EXISTS pis, DROP COLUMN IF EXISTS aso_posto, DROP COLUMN IF EXISTS aso_empresa, DROP COLUMN IF EXISTS aso_encarregado;
-- NOTIFY pgrst, 'reload schema';
