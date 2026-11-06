-- [SEM-CHAMADO] Lucratividade de Contratos: acesso próprio à coluna "Justificativa de valor" (SIS-2026-0807)
-- ============================================================================
-- A coluna "Justificativa de valor" e o botão de cobrar na Lucratividade só dependiam do menu "Justificativas de Valor" (visualizar / incluir).
-- Em Administração, quem libera a Lucratividade não via nenhum switch de justificativa: era preciso saber que a coluna vinha de outro menu.
--
-- Agora a Lucratividade tem o seu: menu fantasma 'lucratividade-justificativas' (mesmo padrão de 'lucratividade-rubricas'), logo abaixo dela:
--   visualizar = ver a coluna (e a leitura das cobranças que a alimenta) | incluir = cobrar justificativa pela linha do contrato.
--
--   1. Menu fantasma + ações.
--   2. Carga: quem já tinha visualizar/incluir em 'justificativas-valor' (perfil ou usuário) recebe o mesmo no novo menu — ninguém perde o que já via.
--   3. Leitura (RLS) e a RPC justificativa_solicitar passam a aceitar a permissão nova OU a antiga. 'justificativas-valor' segue valendo
--      para a tela de gestão (ver todas, encerrar, reabrir, cancelar) e continua cobrando como antes.
-- Idempotente.

-- ── 1. Menu fantasma + ações ──────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'lucratividade-justificativas', 'Lucratividade — Justificativa de valor', NULL, 53, true
  FROM public.app_modulo m WHERE m.codigo = 'controladoria'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('lucratividade-justificativas', 'visualizar'),
  ('lucratividade-justificativas', 'incluir')
ON CONFLICT DO NOTHING;

-- ── 2. Carga: quem já tinha no menu de Justificativas de Valor ───────────────────────────────────────────────────────────────
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'lucratividade-justificativas', a.acao::public.app_acao, true
  FROM public.perfil_acesso pa
  CROSS JOIN (VALUES ('visualizar'), ('incluir')) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.perfil_id, 'lucratividade-justificativas', p.acao, true
  FROM public.perfil_acesso_permissao p
  JOIN public.perfil_acesso pa ON pa.id = p.perfil_id AND pa.ativo AND NOT pa.concede_tudo
 WHERE p.menu_codigo = 'justificativas-valor' AND p.acao IN ('visualizar', 'incluir') AND p.allow
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- empresa_id nulo nunca conflita no UNIQUE: o NOT EXISTS é que garante que reexecutar não duplica.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT s.user_id, 'lucratividade-justificativas', s.acao, true, s.empresa_id,
       'Lucratividade: quem já tinha Justificativas de Valor mantém a coluna e a cobrança'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'justificativas-valor' AND s.acao IN ('visualizar', 'incluir') AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'lucratividade-justificativas' AND x.acao = s.acao
                      AND x.empresa_id IS NOT DISTINCT FROM s.empresa_id);

-- ── 3. Leitura e cobrança aceitam a permissão nova ou a antiga ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS controladoria_justificativa_select ON public.controladoria_justificativa;
CREATE POLICY controladoria_justificativa_select ON public.controladoria_justificativa
  FOR SELECT TO authenticated
  USING (
    (SELECT public.can_access((SELECT auth.uid()), 'justificativas-valor', 'visualizar'))
    OR (SELECT public.can_access((SELECT auth.uid()), 'lucratividade-justificativas', 'visualizar'))
    OR (responsavel_id = (SELECT auth.uid()) AND (SELECT public.can_access((SELECT auth.uid()), 'minhas-justificativas', 'visualizar')))
  );

-- Mesma função de 20261105001000; a única mudança é o teste de permissão (nova OU antiga).
CREATE OR REPLACE FUNCTION public.justificativa_solicitar(
  _contrato_id uuid, _mes date, _coluna text, _coluna_rotulo text, _valor_referencia numeric, _base text,
  _pergunta text, _responsavel_id uuid, _prazo date DEFAULT NULL, _lancamentos jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_contrato text;
  v_numero text;
BEGIN
  IF NOT (public.can_access(auth.uid(), 'justificativas-valor', 'incluir')
          OR public.can_access(auth.uid(), 'lucratividade-justificativas', 'incluir')) THEN
    RAISE EXCEPTION 'Sem permissão para cobrar justificativa.';
  END IF;
  IF COALESCE(btrim(_pergunta), '') = '' OR length(btrim(_pergunta)) < 5 THEN
    RAISE EXCEPTION 'Escreva o que precisa ser justificado.';
  END IF;
  IF _mes IS NULL OR _mes <> date_trunc('month', _mes)::date THEN
    RAISE EXCEPTION 'Mês inválido (use o primeiro dia do mês).';
  END IF;
  IF COALESCE(btrim(_coluna), '') = '' OR COALESCE(btrim(_coluna_rotulo), '') = '' THEN
    RAISE EXCEPTION 'Informe a coluna a justificar.';
  END IF;
  IF _prazo IS NOT NULL AND _prazo < current_date THEN
    RAISE EXCEPTION 'O prazo não pode ser anterior a hoje.';
  END IF;
  SELECT nome INTO v_contrato FROM public.contratos WHERE id = _contrato_id;
  IF v_contrato IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _responsavel_id AND ativo = true) THEN
    RAISE EXCEPTION 'O responsável precisa ser um usuário ativo.';
  END IF;
  IF jsonb_typeof(COALESCE(_lancamentos, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(_lancamentos, '[]'::jsonb)) > 300 THEN
    RAISE EXCEPTION 'Informe no máximo 300 lançamentos.';
  END IF;

  INSERT INTO public.controladoria_justificativa (
    numero, contrato_id, mes, coluna, coluna_rotulo, valor_referencia, base_leitura, pergunta, responsavel_id, prazo, created_by
  ) VALUES (
    '', _contrato_id, _mes, _coluna, _coluna_rotulo, _valor_referencia,
    CASE WHEN _base IN ('competencia', 'pagamento') THEN _base END,
    btrim(_pergunta), _responsavel_id, _prazo, auth.uid()
  ) RETURNING id, numero INTO v_id, v_numero;

  INSERT INTO public.controladoria_justificativa_lancamento (justificativa_id, id_lancamento, descricao, classificacao, data_pagamento, valor)
  SELECT v_id, NULLIF(x->>'id_lancamento', ''), NULLIF(x->>'descricao', ''), NULLIF(x->>'classificacao', ''),
         NULLIF(x->>'data_pagamento', '')::date, COALESCE((x->>'valor')::numeric, 0)
    FROM jsonb_array_elements(COALESCE(_lancamentos, '[]'::jsonb)) AS x;

  INSERT INTO public.controladoria_justificativa_evento (justificativa_id, tipo, ator_id, texto)
  VALUES (v_id, 'solicitada', auth.uid(), btrim(_pergunta));

  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  SELECT _responsavel_id,
         'Justificativa solicitada: ' || v_numero,
         v_contrato || ' · ' || _coluna_rotulo || ' · ' || to_char(_mes, 'MM/YYYY') || CASE WHEN _prazo IS NOT NULL THEN ' · responder até ' || to_char(_prazo, 'DD/MM/YYYY') ELSE '' END,
         'justificativa_valor',
         '/app/controladoria/minhas-justificativas?id=' || v_id
   WHERE _responsavel_id IS DISTINCT FROM auth.uid();

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.justificativa_solicitar(uuid, date, text, text, numeric, text, text, uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.justificativa_solicitar(uuid, date, text, text, numeric, text, text, uuid, date, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'lucratividade-justificativas';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'lucratividade-justificativas';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'lucratividade-justificativas';
-- DELETE FROM public.app_menu WHERE codigo = 'lucratividade-justificativas';
-- -- recriar a policy controladoria_justificativa_select e justificativa_solicitar com o corpo de 20261105001000.
