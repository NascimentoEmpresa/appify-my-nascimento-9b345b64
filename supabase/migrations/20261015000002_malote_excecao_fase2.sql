-- SIS-2026-0668 (fase 2): anexos na solicitação de exceção, tela "Autorizações de Exceção" (visão geral com KPIs,
-- filtros e painel de detalhes) e "Minhas Solicitações".
--
--   1. arquivos text[] na solicitação (mesmo bucket e mesmo formato da malote_despesa.arquivos);
--   2. malote_excecao_solicitar passa a receber os caminhos dos anexos (parâmetro novo, com padrão vazio);
--   3. a leitura de TODAS as solicitações passa a ser uma permissão de tela (malote_excecao_autorizacoes), além de
--      quem pediu e de quem pode decidir. Quem só tem a tela de Solicitar continua vendo só as próprias;
--   4. dois menus novos: Autorizações de Exceção e Minhas Solicitações.
--
-- Depende da 20261015000001. Migrations não se auto-aplicam: rodar no SQL Editor, um BLOCO por vez (BLOCO 1 a 4).

-- BLOCO 1 ─ anexos
ALTER TABLE public.malote_excecao_solicitacao
  ADD COLUMN IF NOT EXISTS arquivos text[] NOT NULL DEFAULT '{}';

-- BLOCO 2 ─ solicitar com anexos (a assinatura muda: sai a antiga, entra a nova)
DROP FUNCTION IF EXISTS public.malote_excecao_solicitar(text, uuid, uuid, uuid, numeric, date, text, text);

CREATE OR REPLACE FUNCTION public.malote_excecao_solicitar(
  _tipo text,
  _classificacao_id uuid,
  _contrato_id uuid,
  _empresa_id uuid,
  _valor numeric,
  _data_pagamento date,
  _descricao text,
  _justificativa text,
  _arquivos text[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_numero text;
  v_aprovadores uuid[];
  v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão ausente.'; END IF;
  IF NOT public.can_access(auth.uid(), 'malote_excecao_solicitar', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para solicitar exceção.';
  END IF;
  IF _classificacao_id IS NULL OR _empresa_id IS NULL OR _data_pagamento IS NULL OR COALESCE(_valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Preencha classificação, empresa, valor e data prevista do pagamento.';
  END IF;
  IF btrim(COALESCE(_descricao, '')) = '' OR btrim(COALESCE(_justificativa, '')) = '' THEN
    RAISE EXCEPTION 'Informe a descrição da despesa e a justificativa da exceção.';
  END IF;
  -- Mesma regra do piso absoluto da despesa: data no passado nunca, nem como exceção (SIS-2026-0361).
  IF _data_pagamento < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'A data prevista do pagamento é anterior a hoje — não é permitido, nem como exceção.';
  END IF;

  SELECT c.aprovador2_user_ids INTO v_aprovadores
    FROM public.planejamento_orcamentario_classificacao c WHERE c.id = _classificacao_id;
  IF COALESCE(array_length(v_aprovadores, 1), 0) = 0 THEN
    RAISE EXCEPTION 'A classificação escolhida não tem Aprovador Nível 2 configurado — ajuste em Classificações Malote antes de pedir a exceção.';
  END IF;

  v_numero := 'EXC-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY') || '-' || lpad(nextval('public.malote_excecao_solicitacao_seq')::text, 4, '0');

  INSERT INTO public.malote_excecao_solicitacao
    (numero, solicitante_id, tipo, classificacao_id, contrato_id, empresa_id, valor, data_pagamento, descricao, justificativa, arquivos)
  VALUES
    (v_numero, auth.uid(), _tipo, _classificacao_id, _contrato_id, _empresa_id, round(_valor, 2), _data_pagamento, btrim(_descricao), btrim(_justificativa), COALESCE(_arquivos, '{}'))
  RETURNING id INTO v_id;

  INSERT INTO public.malote_excecao_solicitacao_evento (solicitacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (v_id, 'solicitada', auth.uid(),
          CASE WHEN COALESCE(array_length(_arquivos, 1), 0) > 0
               THEN format('Exceção solicitada, com %s anexo(s).', array_length(_arquivos, 1))
               ELSE 'Exceção solicitada.' END);

  SELECT COALESCE(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  PERFORM public.malote_notificar_usuarios(
    v_aprovadores, _empresa_id,
    'Nova solicitação de exceção no Malote',
    format('%s pediu a exceção %s (R$ %s, pagamento em %s). Analise em Malote › Aprovar Exceções.',
           COALESCE(v_nome, 'Um usuário'), v_numero, to_char(round(_valor, 2), 'FM999G999G990D00'), to_char(_data_pagamento, 'DD/MM/YYYY')),
    'malote_excecao', '/app/malote/excecao/aprovar'
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.malote_excecao_solicitar(text, uuid, uuid, uuid, numeric, date, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_excecao_solicitar(text, uuid, uuid, uuid, numeric, date, text, text, text[]) TO authenticated;

-- BLOCO 3 ─ quem lê todas as solicitações (a tela Autorizações de Exceção)
DROP POLICY IF EXISTS malote_excecao_sol_select ON public.malote_excecao_solicitacao;
CREATE POLICY malote_excecao_sol_select ON public.malote_excecao_solicitacao
  FOR SELECT TO authenticated
  USING (
    solicitante_id = auth.uid()
    OR (SELECT public.malote_excecao_pode_decidir(classificacao_id, auth.uid()))
    OR (SELECT public.can_access(auth.uid(), 'malote_excecao_autorizacoes', 'visualizar'))
  );

-- Classificações que o usuário pode decidir: a tela Aprovar Exceções só lista essas e a Autorizações só mostra
-- Aprovar/Reprovar nelas (a leitura ampla do BLOCO 3 não pode virar botão para quem não decide).
CREATE OR REPLACE FUNCTION public.malote_excecao_classificacoes_que_decido()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id FROM public.planejamento_orcamentario_classificacao c
   WHERE public.malote_excecao_pode_decidir(c.id, auth.uid());
$$;

REVOKE ALL ON FUNCTION public.malote_excecao_classificacoes_que_decido() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_excecao_classificacoes_que_decido() TO authenticated;

-- BLOCO 4 ─ menus
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'malote_excecao_autorizacoes', 'Malote — Autorizações de Exceção', '/app/malote/excecao/autorizacoes', 22
  FROM public.app_modulo m WHERE m.codigo = 'malote'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'malote_excecao_minhas', 'Malote — Minhas Solicitações de Exceção', '/app/malote/excecao/minhas', 23
  FROM public.app_modulo m WHERE m.codigo = 'malote'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, mc.menu_codigo, a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('malote_excecao_autorizacoes'), ('malote_excecao_minhas')) AS mc(menu_codigo)
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('incluir'::public.app_acao), ('alterar'::public.app_acao), ('excluir'::public.app_acao)) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.malote_excecao_classificacoes_que_decido();
--   DROP FUNCTION IF EXISTS public.malote_excecao_solicitar(text, uuid, uuid, uuid, numeric, date, text, text, text[]);
--   (recriar a função da 20261015000001 — assinatura sem _arquivos)
--   DROP POLICY IF EXISTS malote_excecao_sol_select ON public.malote_excecao_solicitacao;
--   (recriar a policy da 20261015000001 — sem o ramo malote_excecao_autorizacoes)
--   ALTER TABLE public.malote_excecao_solicitacao DROP COLUMN IF EXISTS arquivos;
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('malote_excecao_autorizacoes', 'malote_excecao_minhas');
--   DELETE FROM public.app_menu WHERE codigo IN ('malote_excecao_autorizacoes', 'malote_excecao_minhas');
--   NOTIFY pgrst, 'reload schema';
