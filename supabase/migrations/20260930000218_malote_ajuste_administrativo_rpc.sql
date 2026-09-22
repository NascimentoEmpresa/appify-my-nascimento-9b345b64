-- [SEM-CHAMADO] (Iury): RPC + perfil dedicado pro "aprovador master"
-- fantasma — substitui o UPDATE manual no SQL Editor (já feito 2x, em
-- SD-2026-0046 e SD-2026-0862) por uma ação real do sistema, com
-- permissão própria e o mesmo rastro no histórico
-- (malote_despesa_evento.tipo_evento = 'ajuste_administrativo', que já
-- existe desde a 20260930000188).
--
-- PRÉ-REQUISITO: 20260930000217 ('ajuste_administrativo' no enum
-- app_acao) tem que estar aplicada ANTES desta — o INSERT em
-- perfil_acesso_permissao aqui usa o valor.
--
-- Escopo decidido com o Iury: só ele tem essa ação (não é um perfil
-- comum do Malote, é um complemento pontual — mesmo padrão da
-- 20260913000002, "Malote: Exclusão Permanente"); o destino é escolhido
-- na hora (qualquer status válido, a CHECK constraint de
-- malote_despesa.status já impede valor inválido); pede motivo, que o
-- front concatena com o texto fixo que já está no histórico das duas
-- despesas ajustadas por SQL.

-- ── 1. Perfil dedicado ────────────────────────────────────────────────
-- modulo_codigo fica NULL de propósito, mesmo motivo da 20260913000002:
-- 'malote' já pertence ao perfil "Malote" (acesso completo ao módulo) —
-- este é só um complemento pontual.
INSERT INTO public.perfil_acesso (nome, descricao, concede_tudo, ativo)
VALUES (
  'Malote: Ajuste Administrativo',
  'Só a ação de mover despesa direto pra outro status por decisão administrativa, fora do fluxo normal de aprovação — "aprovador master" fantasma, uso raro e atípico.',
  false,
  true
)
ON CONFLICT (nome) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'malote_despesa_visualizar', 'ajuste_administrativo', true
FROM public.perfil_acesso pa
WHERE pa.nome = 'Malote: Ajuste Administrativo'
ON CONFLICT (perfil_id, menu_codigo, acao) DO UPDATE SET allow = true;

INSERT INTO public.usuario_perfil_acesso (user_id, perfil_id)
SELECT p.id, pa.id
FROM public.profiles p
CROSS JOIN public.perfil_acesso pa
WHERE pa.nome = 'Malote: Ajuste Administrativo'
  AND p.email = 'iurysilva@haggltda.com.br' -- Iury
ON CONFLICT DO NOTHING;

-- ── 2. RPC ───────────────────────────────────────────────────────────
-- _descricao já vem composta do front (texto fixo + motivo digitado) —
-- a RPC não conhece o rótulo de cada status, só grava o que recebe.
CREATE OR REPLACE FUNCTION public.malote_despesa_ajuste_administrativo(
  _id uuid,
  _novo_status text,
  _descricao text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status_atual text;
  v_nivel smallint;
BEGIN
  IF NOT public.can_access(auth.uid(), 'malote_despesa_visualizar', 'ajuste_administrativo') THEN
    RAISE EXCEPTION 'Sem permissão para ajuste administrativo.';
  END IF;

  SELECT status, nivel_aprovacao_atual INTO v_status_atual, v_nivel
  FROM public.malote_despesa
  WHERE id = _id AND deleted_at IS NULL;

  IF v_status_atual IS NULL THEN
    RAISE EXCEPTION 'Despesa não encontrada.';
  END IF;

  IF v_status_atual = _novo_status THEN
    RAISE EXCEPTION 'Despesa já está em "%".', _novo_status;
  END IF;

  UPDATE public.malote_despesa SET status = _novo_status WHERE id = _id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, nivel, ator_user_id)
  VALUES (_id, 'ajuste_administrativo', _descricao, v_nivel, auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.malote_despesa_ajuste_administrativo(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_despesa_ajuste_administrativo(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
--   DROP FUNCTION IF EXISTS public.malote_despesa_ajuste_administrativo(uuid, text, text);
--   DELETE FROM public.usuario_perfil_acesso WHERE perfil_id = (SELECT id FROM public.perfil_acesso WHERE nome = 'Malote: Ajuste Administrativo');
--   DELETE FROM public.perfil_acesso_permissao WHERE perfil_id = (SELECT id FROM public.perfil_acesso WHERE nome = 'Malote: Ajuste Administrativo');
--   DELETE FROM public.perfil_acesso WHERE nome = 'Malote: Ajuste Administrativo';
