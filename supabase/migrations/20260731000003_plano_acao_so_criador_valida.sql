-- Pedido da gestão: só quem criou a ação pode marcar como
-- "Concluída — Validada" (ação legada sem criado_por registrado cai no
-- fallback do Responsável). Reforça no banco o que o frontend já passa a
-- checar (Detalhe.tsx/Kanban.tsx/Aprovacoes.tsx), mesmo padrão de defesa
-- em profundidade já usado nesta série pra responsável/setor obrigatórios.

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

  -- (F) Só quem criou a ação (ou o Responsável, em ação legada sem
  -- criado_por) pode marcar como Concluída — Validada. Só dispara na
  -- transição de UPDATE que efetivamente muda pra esse status — uma
  -- edição qualquer numa ação que já estava concluída_validada não
  -- re-checa isso.
  IF TG_OP = 'UPDATE'
     AND NEW.status_normalizado = 'concluida_validada'
     AND OLD.status_normalizado IS DISTINCT FROM 'concluida_validada' THEN
    IF auth.uid() IS DISTINCT FROM COALESCE(OLD.criado_por, OLD.responsavel_profile_id) THEN
      RAISE EXCEPTION 'somente_criador_pode_validar_conclusao'
        USING ERRCODE = '42501';
    END IF;
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
