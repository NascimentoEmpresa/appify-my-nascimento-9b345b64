-- =========================================================================
-- Ficha do ASO admissional: endereço / local exato da vaga (30/10/2026)
--
-- Pedido do Pablo: "pro SST tá indo o nome do posto, mas precisa ir o local
-- também tipo aquele campus vale a.v". Vaga #1418 (UFRGS MOTORISTAS): a
-- ficha mostrava "D1 - MOTORISTA CAT. D PORTO ALEGRE" (posto do catálogo,
-- certo) e "Porto Alegre" — o endereço digitado na vaga ("Campus vale
-- .av,bento gonçalves 9500 porto alegre", coluna local_exato) não chegava.
--
-- O QUE MUDA: rec_ficha_aso devolve também 'local_exato' (cru, da vaga). A
-- tela (FichaAso.tsx + lib/recrutamento/postoDaVaga) só mostra quando diz
-- algo além do nome do posto — vaga do encarregado grava ali o próprio nome
-- do posto. Não entra em `faltando`: vaga sem endereço não trava o SST.
-- O resto do corpo é o da mig 191, sem mudança.
--
-- Idempotente. ROLLBACK no fim (recriar a da 191).
-- =========================================================================

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
    'local_exato', nullif(btrim(coalesce(v.local_exato, '')), ''),
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
-- Reaplicar o CREATE OR REPLACE FUNCTION public.rec_ficha_aso de
-- 20260930000191_ficha_aso_admissional_para_o_sst.sql (sem 'local_exato').
-- NOTIFY pgrst, 'reload schema';
