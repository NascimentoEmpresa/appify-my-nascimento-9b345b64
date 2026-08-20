-- Separa duas capacidades do Suprimentos que hoje andam coladas em uma
-- permissão só, obrigando a dar poder demais pra quem só precisa de um pedaço.
-- Confirmado com o usuário: "quem faz inventário nem sempre é quem dá entrada"
-- e "quem vota na aprovação nem sempre é quem edita o pedido".
--
--   1. FAZER INVENTÁRIO
--      Hoje sup_est_inventario() exige `sup_estoque | alterar` — a MESMA
--      permissão de dar entrada, devolver e movimentar estoque. Ou seja: pra
--      alguém conferir a prateleira, precisa poder mexer no saldo.
--      Passa a exigir a flag própria `sup_estoque_inventario`.
--
--   2. VOTAR EM QUALQUER ETAPA DE APROVAÇÃO
--      Hoje sup_aprov_registrar_voto() aceita o voto se a pessoa É a
--      responsável pela etapa OU tem `suprimentos_aprovacoes | alterar`.
--      Esse segundo caso é um BYPASS (votar em etapa que não é sua), e está
--      colado com "configurar os fluxos de aprovação" — criar fluxo, adicionar
--      e remover etapas. São poderes bem diferentes.
--      O bypass passa a exigir a flag própria `suprimentos_aprovacoes_votar`;
--      `alterar` continua valendo pra configurar os fluxos.
--      O responsável designado segue votando sem precisar de flag nenhuma.
--
-- PADRÃO USADO: menu SEM ROTA como flag de capacidade — o mesmo que o ERP já
-- usa em chamados_sistemas_aprovar, sistemas_criar_solicitacao,
-- cotacoes-licitacao-nova e central_servicos_criar_reuniao. Aparece na tela
-- "Acesso por Usuário" como uma linha com seu próprio switch.
--
-- SEMEADURA OBRIGATÓRIA: menu novo sem NENHUMA regra em
-- perfil_acesso_permissao nasce ABERTO (todo autenticado enxerga). Se eu
-- criasse a flag sem semear, mais gente passaria a fazer inventário do que faz
-- hoje — o oposto do objetivo. Por isso as flags já nascem concedidas a
-- exatamente quem tem o poder equivalente hoje, preservando o comportamento
-- atual; a separação só passa a valer quando alguém revogar de propósito.
--
-- ROLLBACK:
--   Recriar as duas funções com a checagem antiga (can_access(..,'sup_estoque',
--   'alterar') e (..,'suprimentos_aprovacoes','alterar')), depois:
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('sup_estoque_inventario','suprimentos_aprovacoes_votar');
--   DELETE FROM public.screen_permission_user  WHERE menu_codigo IN ('sup_estoque_inventario','suprimentos_aprovacoes_votar');
--   DELETE FROM public.app_menu                WHERE codigo      IN ('sup_estoque_inventario','suprimentos_aprovacoes_votar');

-- ── 1. As duas flags ─────────────────────────────────────────────────────────

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT mo.id, v.codigo, v.nome, NULL,
       COALESCE((SELECT max(am.ordem) FROM public.app_menu am WHERE am.modulo_id = mo.id), 0) + 10
FROM public.app_modulo mo
JOIN (VALUES
  ('sup_estoque_inventario',        'Fazer inventário de estoque'),
  ('suprimentos_aprovacoes_votar',  'Votar em qualquer etapa de aprovação')
) AS v(codigo, nome) ON true
WHERE mo.nome = 'Suprimentos'
  AND NOT EXISTS (SELECT 1 FROM public.app_menu am WHERE am.codigo = v.codigo);

-- ── 2. Semeadura: quem pode hoje continua podendo ───────────────────────────

-- Perfis: espelha quem tem a permissão equivalente.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pap.perfil_id, v.flag, 'visualizar'::app_acao, true
FROM public.perfil_acesso_permissao pap
JOIN (VALUES
  ('sup_estoque',           'alterar', 'sup_estoque_inventario'),
  ('suprimentos_aprovacoes','alterar', 'suprimentos_aprovacoes_votar')
) AS v(menu_origem, acao_origem, flag)
  ON pap.menu_codigo = v.menu_origem AND pap.acao::text = v.acao_origem
WHERE pap.allow = true
ON CONFLICT DO NOTHING;

-- Exceções individuais: idem, respeitando allow=true.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id)
SELECT DISTINCT spu.user_id, v.flag, 'visualizar'::app_acao, true, NULL::uuid
FROM public.screen_permission_user spu
JOIN (VALUES
  ('sup_estoque',           'alterar', 'sup_estoque_inventario'),
  ('suprimentos_aprovacoes','alterar', 'suprimentos_aprovacoes_votar')
) AS v(menu_origem, acao_origem, flag)
  ON spu.menu_codigo = v.menu_origem AND spu.acao::text = v.acao_origem
WHERE spu.allow = true AND spu.empresa_id IS NULL
ON CONFLICT (user_id, menu_codigo, acao, empresa_id) DO UPDATE SET allow = true, updated_at = now();

-- ── 3. As duas funções passam a checar a flag ───────────────────────────────

-- sup_est_inventario: corpo idêntico ao de produção; muda SÓ o menu checado
-- no bloco de permissão.
CREATE OR REPLACE FUNCTION public.sup_est_inventario(p_item_estoque_id uuid, p_codigos text[], p_observacao text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_nome        text := public.sup_est_nome_usuario();
  v_item        record;
  v_inv         uuid;
  v_bipadas     text[];
  v_esperadas   text[];
  v_encontradas text[];
  v_faltantes   text[];
  v_estranhas   text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  -- Antes: can_access(v_uid, 'sup_estoque', 'alterar') — a mesma permissão de
  -- movimentar saldo. Agora é capacidade própria, revogável sem tirar a
  -- operação de estoque da pessoa.
  IF NOT public.can_access(v_uid, 'sup_estoque_inventario', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para registrar inventário';
  END IF;

  SELECT ei.id, ei.empresa_id, ei.sup_item_id INTO v_item
    FROM public.sup_estoque_item ei WHERE ei.id = p_item_estoque_id;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'Material de estoque não encontrado'; END IF;

  -- Normaliza o que veio da pistola: maiúsculo, sem espaço, sem vazio, sem repetido.
  SELECT COALESCE(array_agg(DISTINCT upper(btrim(c))), '{}')
    INTO v_bipadas
    FROM unnest(COALESCE(p_codigos, '{}')) AS c
   WHERE btrim(COALESCE(c, '')) <> '';

  -- O universo conferível são as etiquetas LIVRES. Etiqueta já baixada para um
  -- pedido não deveria estar na prateleira, então não entra como "faltante".
  SELECT COALESCE(array_agg(tg.codigo), '{}')
    INTO v_esperadas
    FROM public.sup_estoque_tag tg
   WHERE tg.item_estoque_id = p_item_estoque_id AND tg.usado = false;

  SELECT COALESCE(array_agg(x), '{}') INTO v_encontradas
    FROM unnest(v_esperadas) x WHERE x = ANY (v_bipadas);
  SELECT COALESCE(array_agg(x), '{}') INTO v_faltantes
    FROM unnest(v_esperadas) x WHERE NOT (x = ANY (v_bipadas));
  SELECT COALESCE(array_agg(x), '{}') INTO v_estranhas
    FROM unnest(v_bipadas) x WHERE NOT (x = ANY (v_esperadas));

  INSERT INTO public.sup_estoque_inventario
    (empresa_id, item_estoque_id, sup_item_id, esperadas, encontradas, divergencia,
     observacao, usuario_id, usuario_nome)
  VALUES (v_item.empresa_id, v_item.id, v_item.sup_item_id,
          cardinality(v_esperadas), cardinality(v_encontradas),
          cardinality(v_encontradas) - cardinality(v_esperadas),
          nullif(btrim(COALESCE(p_observacao, '')), ''), v_uid, v_nome)
  RETURNING id INTO v_inv;

  INSERT INTO public.sup_estoque_inventario_tag (inventario_id, codigo, situacao)
  SELECT v_inv, x, 'encontrada' FROM unnest(v_encontradas) x
  UNION ALL SELECT v_inv, x, 'faltante'  FROM unnest(v_faltantes) x
  UNION ALL SELECT v_inv, x, 'estranha'  FROM unnest(v_estranhas) x
  ON CONFLICT (inventario_id, codigo) DO NOTHING;

  -- Um único movimento, para o inventário aparecer na MESMA linha do tempo das
  -- entradas e saídas. `quantidade` é o que foi conferido de fato.
  INSERT INTO public.sup_estoque_movimento
    (empresa_id, item_estoque_id, sup_item_id, codigo, tipo, quantidade,
     observacao, usuario_id, usuario_nome)
  VALUES (v_item.empresa_id, v_item.id, v_item.sup_item_id, NULL, 'ajuste',
          cardinality(v_encontradas),
          format('Inventário: %s de %s etiquetas conferidas, divergência %s%s',
                 cardinality(v_encontradas), cardinality(v_esperadas),
                 cardinality(v_encontradas) - cardinality(v_esperadas),
                 CASE WHEN cardinality(v_estranhas) > 0
                      THEN format(' · %s etiqueta(s) estranha(s)', cardinality(v_estranhas))
                      ELSE '' END),
          v_uid, v_nome);

  -- NENHUM UPDATE em sup_estoque_tag. É proposital: ver o comentário do bloco 2.
  RETURN jsonb_build_object(
    'inventario_id', v_inv,
    'esperadas',     cardinality(v_esperadas),
    'encontradas',   cardinality(v_encontradas),
    'divergencia',   cardinality(v_encontradas) - cardinality(v_esperadas),
    'faltantes',     to_jsonb(v_faltantes),
    'estranhas',     to_jsonb(v_estranhas));
END $function$;

-- sup_aprov_registrar_voto: corpo idêntico; muda SÓ o menu do bypass.
CREATE OR REPLACE FUNCTION public.sup_aprov_registrar_voto(_instancia_id uuid, _etapa_id uuid, _parecer sup_aprov_parecer, _justificativa text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _resp uuid; _tipo public.sup_aprov_tipo_parecer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tipo_parecer, public.sup_aprov_responsavel_efetivo(id) INTO _tipo, _resp
    FROM public.sup_aprov_etapa WHERE id = _etapa_id AND ativo;
  IF _resp IS NULL THEN RAISE EXCEPTION 'Etapa não encontrada'; END IF;
  -- O responsável designado vota sem precisar de permissão nenhuma (inalterado).
  -- O BYPASS (votar em etapa de outro) era 'suprimentos_aprovacoes|alterar', a
  -- mesma permissão de configurar os fluxos; agora é capacidade própria.
  IF _resp <> _uid AND NOT public.can_access(_uid, 'suprimentos_aprovacoes_votar', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar esta etapa';
  END IF;
  IF _parecer = 'reprovado' AND (_justificativa IS NULL OR length(trim(_justificativa)) = 0) THEN
    RAISE EXCEPTION 'Justificativa obrigatória para reprovar';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sup_aprov_voto WHERE instancia_id=_instancia_id AND etapa_id=_etapa_id AND usuario_id=_uid) THEN
    RAISE EXCEPTION 'Voto já registrado';
  END IF;
  INSERT INTO public.sup_aprov_voto(instancia_id, etapa_id, usuario_id, parecer, justificativa)
  VALUES (_instancia_id, _etapa_id, _uid, _parecer, _justificativa);
  IF _tipo = 'bloqueante' THEN
    IF _parecer = 'reprovado' THEN
      UPDATE public.sup_aprov_instancia SET status='reprovado', etapa_atual_id=NULL, fechada_em=now() WHERE id=_instancia_id;
    ELSE
      PERFORM public.sup_aprov_avancar(_instancia_id);
    END IF;
  END IF;
END $function$;
