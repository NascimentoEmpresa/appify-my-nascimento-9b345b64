-- Setor (coluna "area") passa a ser obrigatório na criação de plano manual,
-- assim como já é o Responsável — mesma regra, mesmo padrão (só bloqueia em
-- TG_OP = 'INSERT', nunca em UPDATE, pelo mesmo motivo já documentado em
-- 20260714000002: um UPDATE que zere o campo depois (ex.: FK ON DELETE SET
-- NULL de alguma referência futura) não deve travar por uma regra pensada
-- só pro fluxo de criação manual no formulário).

CREATE OR REPLACE FUNCTION public.tg_plano_acao_valida_responsaveis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ativo boolean;
BEGIN
  -- (A) Plano manual exige responsável só na criação
  IF TG_OP = 'INSERT' AND NEW.origem = 'manual' AND NEW.responsavel_profile_id IS NULL THEN
    RAISE EXCEPTION 'responsavel_obrigatorio_em_plano_manual'
      USING ERRCODE = '23514';
  END IF;

  -- (A2) Plano manual exige setor só na criação
  IF TG_OP = 'INSERT' AND NEW.origem = 'manual' AND (NEW.area IS NULL OR NEW.area = '') THEN
    RAISE EXCEPTION 'setor_obrigatorio_em_plano_manual'
      USING ERRCODE = '23514';
  END IF;

  -- (B) Validação canônica do responsável
  IF NEW.responsavel_profile_id IS NOT NULL THEN
    SELECT ativo INTO v_ativo
      FROM public.profiles
     WHERE id = NEW.responsavel_profile_id;

    IF NOT FOUND OR v_ativo IS NOT TRUE THEN
      RAISE EXCEPTION 'responsavel_inativo_ou_inexistente'
        USING ERRCODE = '23514';
    END IF;

    IF NOT public.user_pode_atuar_empresa(NEW.responsavel_profile_id, NEW.empresa_id) THEN
      RAISE EXCEPTION 'responsavel_fora_da_empresa'
        USING ERRCODE = '23514';
    END IF;

    NEW.pendencia_responsavel := false;
  ELSE
    -- (C) Sem vínculo permanece pendente (legado/importado OU manual que
    -- perdeu o responsável, ex.: usuário excluído)
    NEW.pendencia_responsavel := true;
  END IF;

  -- (D) Líder de comitê (quando preenchido)
  IF NEW.lider_comite_profile_id IS NOT NULL THEN
    SELECT ativo INTO v_ativo
      FROM public.profiles
     WHERE id = NEW.lider_comite_profile_id;

    IF NOT FOUND OR v_ativo IS NOT TRUE THEN
      RAISE EXCEPTION 'lider_comite_inativo_ou_inexistente'
        USING ERRCODE = '23514';
    END IF;

    IF NOT public.user_pode_atuar_empresa(NEW.lider_comite_profile_id, NEW.empresa_id) THEN
      RAISE EXCEPTION 'lider_comite_fora_da_empresa'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- (E) Líder de setor (quando preenchido)
  IF NEW.lider_setor_profile_id IS NOT NULL THEN
    SELECT ativo INTO v_ativo
      FROM public.profiles
     WHERE id = NEW.lider_setor_profile_id;

    IF NOT FOUND OR v_ativo IS NOT TRUE THEN
      RAISE EXCEPTION 'lider_setor_inativo_ou_inexistente'
        USING ERRCODE = '23514';
    END IF;

    IF NOT public.user_pode_atuar_empresa(NEW.lider_setor_profile_id, NEW.empresa_id) THEN
      RAISE EXCEPTION 'lider_setor_fora_da_empresa'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_plano_acao_valida_responsaveis() FROM PUBLIC;
