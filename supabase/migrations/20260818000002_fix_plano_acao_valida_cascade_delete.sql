-- Corrige tg_plano_acao_valida_responsaveis: revalidava responsavel/lider_comite/
-- lider_setor em QUALQUER UPDATE da linha, mesmo quando o campo em questão não
-- mudou. Isso quebra a exclusão de usuários (admin-delete-user): DELETE FROM
-- profiles cascateia um UPDATE por coluna (ON DELETE SET NULL) em plano_acao;
-- se a mesma pessoa está em 2 colunas na mesma linha (comum — ex.: é
-- responsável E líder de setor da mesma ação), o cascade que zera a 1ª coluna
-- já dispara a revalidação e encontra a 2ª coluna ainda apontando pro usuário
-- que acabou de deixar de existir → "..._inativo_ou_inexistente", bloqueando
-- o DELETE inteiro.
--
-- Fix: só (re)valida cada campo quando ELE PRÓPRIO muda (INSERT ou valor
-- distinto do OLD) — mesmo padrão que o bloco (F) desta função já usa pra
-- "conclusão validada".
--
-- ROLLBACK:
-- (reaplicar a versão anterior da função, sem os guards TG_OP='INSERT' OR ... IS DISTINCT FROM OLD...)

CREATE OR REPLACE FUNCTION public.tg_plano_acao_valida_responsaveis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- (B) Validação canônica do responsável — só quando o campo muda de fato
  -- (evita revalidar contra um cascade de exclusão de outra coluna da mesma linha).
  IF NEW.responsavel_profile_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR NEW.responsavel_profile_id IS DISTINCT FROM OLD.responsavel_profile_id THEN
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
    END IF;

    NEW.pendencia_responsavel := false;
  ELSE
    -- (C) Sem vínculo permanece pendente (legado/importado OU manual que
    -- perdeu o responsável, ex.: usuário excluído)
    NEW.pendencia_responsavel := true;
  END IF;

  -- (D) Líder de comitê (quando preenchido) — só revalida se este campo mudou.
  IF NEW.lider_comite_profile_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.lider_comite_profile_id IS DISTINCT FROM OLD.lider_comite_profile_id) THEN
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

  -- (E) Líder de setor (quando preenchido) — só revalida se este campo mudou.
  IF NEW.lider_setor_profile_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.lider_setor_profile_id IS DISTINCT FROM OLD.lider_setor_profile_id) THEN
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
$function$;
