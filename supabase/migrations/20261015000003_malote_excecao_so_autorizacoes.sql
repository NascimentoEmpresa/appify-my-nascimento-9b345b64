-- SIS-2026-0668 (errata): "Aprovar Exceções" e "Autorizações de Exceção" eram quase a mesma tela. Fica só a
-- Autorizações de Exceção (visão geral + Aprovar/Reprovar nas classificações em que a pessoa é N2).
--
--   1. a notificação enviada ao Aprovador N2 passa a abrir a Autorizações de Exceção;
--   2. o menu malote_excecao_aprovar (criado na 20261015000001) é removido, junto com as permissões dele.
--
-- Para o N2 abrir a tela, libere o menu "Malote — Autorizações de Exceção" (malote_excecao_autorizacoes) a ele em
-- Administração. Atenção: quem tem esse menu enxerga as solicitações de todos (leitura da 20261015000002).
--
-- Depende da 20261015000002. Migrations não se auto-aplicam: rodar no SQL Editor, um BLOCO por vez (BLOCO 1 e 2).

-- BLOCO 1 ─ notificação ao N2 aponta para a tela que fica
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
    format('%s pediu a exceção %s (R$ %s, pagamento em %s). Analise em Malote › Autorizações de Exceção.',
           COALESCE(v_nome, 'Um usuário'), v_numero, to_char(round(_valor, 2), 'FM999G999G990D00'), to_char(_data_pagamento, 'DD/MM/YYYY')),
    'malote_excecao', '/app/malote/excecao/autorizacoes'
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.malote_excecao_solicitar(text, uuid, uuid, uuid, numeric, date, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_excecao_solicitar(text, uuid, uuid, uuid, numeric, date, text, text, text[]) TO authenticated;

-- BLOCO 2 ─ remove o menu Aprovar Exceções
DELETE FROM public.screen_permission_user WHERE menu_codigo = 'malote_excecao_aprovar';
DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'malote_excecao_aprovar';
DELETE FROM public.app_menu WHERE codigo = 'malote_excecao_aprovar';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
--   SELECT m.id, 'malote_excecao_aprovar', 'Malote — Aprovar Exceções', '/app/malote/excecao/aprovar', 21
--     FROM public.app_modulo m WHERE m.codigo = 'malote' ON CONFLICT (modulo_id, codigo) DO NOTHING;
--   (reaplicar as permissões do perfil que concede tudo, como na 20261015000001, e recriar a função da 20261015000002)
--   NOTIFY pgrst, 'reload schema';
