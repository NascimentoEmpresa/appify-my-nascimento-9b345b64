-- =====================================================================
-- SUPPLY / COMPRAS — Fase 1, parte 3 de 3: RPCs DA CASCATA E DO PEDIDO
--
-- Por que RPC e não policy `anon` direto nas tabelas: public.contratos
-- carrega valor_mensal, valor_global e cnpj_cliente. Abrir SELECT nela
-- para o usuário externo vazaria tudo isso. Cada função aqui devolve o
-- mínimo necessário para desenhar a cascata.
--
-- Todas são SECURITY DEFINER — ou seja, RODAM POR FORA DA RLS. Logo, cada
-- uma refaz a autorização à mão, via sup_ext_pode_ver_contrato().
--
-- As mesmas funções servem o usuário INTERNO com a tela de solicitação:
--   • externo  → preso ao contrato gravado em sup_ext_sessao;
--   • interno  → qualquer contrato das empresas dele, se tiver o menu.
-- Um caminho só, para o wizard não ter dois modos.
--
-- ROLLBACK: DROP FUNCTION de cada uma das sup_ext_* abaixo.
-- =====================================================================

-- ── Guarda de autorização, compartilhada por todas ───────────────────

CREATE OR REPLACE FUNCTION public.sup_ext_pode_ver_contrato(p_contrato_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_contrato_id IS NULL THEN RETURN false; END IF;

  -- Externo: exatamente o contrato que ele escolheu ao entrar.
  IF EXISTS (
    SELECT 1 FROM public.sup_ext_sessao s
     WHERE s.user_id = v_uid AND s.contrato_id = p_contrato_id
  ) THEN
    RETURN true;
  END IF;

  -- Interno: precisa da tela E do contrato estar numa empresa dele.
  RETURN public.can_access(v_uid, 'encarregados_solicitar_materiais', 'visualizar')
     AND EXISTS (
       SELECT 1 FROM public.contratos c
         JOIN public.user_empresa ue ON ue.empresa_id = c.empresa_id
        WHERE c.id = p_contrato_id AND ue.user_id = v_uid
     );
END $$;

-- ── 1. Contratos disponíveis (única concedida a anon) ────────────────
--
-- Alimenta o select de contrato da aba "Externo" do login, ANTES de haver
-- sessão. Devolve só id + nome, e só de contrato que já tenha posto
-- aprovado — contrato sem catálogo não serve para pedir nada mesmo.
CREATE OR REPLACE FUNCTION public.sup_ext_contratos()
RETURNS TABLE (id uuid, nome text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.nome
    FROM public.contratos c
   WHERE c.status = 'ativo'
     AND EXISTS (
       SELECT 1 FROM public.sup_posto p
        WHERE p.contrato_id = c.id AND p.aprovado AND p.ativo
     )
   ORDER BY c.nome;
$$;

-- ── 2. Abrir a sessão externa ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_ext_entrar(p_login text, p_contrato_id uuid)
RETURNS public.sup_ext_sessao
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.sup_ext_sessao;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF coalesce(trim(p_login), '') = '' THEN
    RAISE EXCEPTION 'Informe sua identificação';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contratos c WHERE c.id = p_contrato_id AND c.status = 'ativo') THEN
    RAISE EXCEPTION 'Contrato inválido ou inativo';
  END IF;

  INSERT INTO public.sup_ext_sessao (user_id, login_informado, contrato_id)
  VALUES (v_uid, upper(trim(p_login)), p_contrato_id)
  ON CONFLICT (user_id) DO UPDATE
    SET login_informado = excluded.login_informado,
        contrato_id     = excluded.contrato_id,
        last_seen_at    = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

-- ── 3. Cascata ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sup_ext_postos(p_contrato_id uuid)
RETURNS TABLE (id uuid, nome text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.sup_ext_pode_ver_contrato(p_contrato_id) THEN
    RAISE EXCEPTION 'Sem acesso a este contrato';
  END IF;
  RETURN QUERY
    SELECT p.id, p.nome
      FROM public.sup_posto p
     WHERE p.contrato_id = p_contrato_id AND p.aprovado AND p.ativo
     ORDER BY p.nome;
END $$;

CREATE OR REPLACE FUNCTION public.sup_ext_funcoes(p_posto_id uuid)
RETURNS TABLE (id uuid, nome text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_contrato uuid;
BEGIN
  SELECT p.contrato_id INTO v_contrato FROM public.sup_posto p WHERE p.id = p_posto_id;
  IF NOT public.sup_ext_pode_ver_contrato(v_contrato) THEN
    RAISE EXCEPTION 'Sem acesso a este posto';
  END IF;
  RETURN QUERY
    SELECT f.id, f.nome
      FROM public.sup_funcao f
     WHERE f.posto_id = p_posto_id AND f.aprovado AND f.ativo
     ORDER BY f.nome;
END $$;

-- Enxoval da função: item + as opções dele já agregadas por tipo, para o
-- front montar os selects Tamanho/Qtd/Litros sem uma chamada por item
-- (no legado era um GET por item — §8.1).
CREATE OR REPLACE FUNCTION public.sup_ext_itens(p_funcao_id uuid)
RETURNS TABLE (
  id uuid, nome text, tipo text,
  opcao_tamanho text[], opcao_quantidade text[], opcao_litros text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_contrato uuid;
BEGIN
  SELECT p.contrato_id INTO v_contrato
    FROM public.sup_funcao f JOIN public.sup_posto p ON p.id = f.posto_id
   WHERE f.id = p_funcao_id;
  IF NOT public.sup_ext_pode_ver_contrato(v_contrato) THEN
    RAISE EXCEPTION 'Sem acesso a esta função';
  END IF;

  RETURN QUERY
    SELECT i.id, i.nome, i.tipo,
           (SELECT o.opcoes FROM public.sup_item_opcao o
             WHERE o.item_id = i.id AND o.tipo = 'tamanho'),
           (SELECT o.opcoes FROM public.sup_item_opcao o
             WHERE o.item_id = i.id AND o.tipo = 'quantidade'),
           (SELECT o.opcoes FROM public.sup_item_opcao o
             WHERE o.item_id = i.id AND o.tipo = 'litros')
      FROM public.sup_funcao_item fi
      JOIN public.sup_item i ON i.id = fi.item_id
     WHERE fi.funcao_id = p_funcao_id
       AND fi.aprovado AND fi.ativo
       AND i.aprovado  AND i.ativo
     ORDER BY fi.ordem, i.tipo, i.nome;
END $$;

-- ── 4. Criar pedido ──────────────────────────────────────────────────
--
-- Pedido + itens + evento de criação numa transação só. As validações são
-- as mesmas do legado (§5.9 / §8.2), acrescidas da checagem de que cada
-- item pedido pertence de fato ao enxoval daquela função — no legado o
-- payload vinha pronto de fora e ninguém conferia.
CREATE OR REPLACE FUNCTION public.sup_ext_criar_pedido(p_payload jsonb)
RETURNS public.sup_pedido
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_contrato  uuid := (p_payload->>'contrato_id')::uuid;
  v_posto     uuid := (p_payload->>'posto_id')::uuid;
  v_funcao    uuid := (p_payload->>'funcao_id')::uuid;
  v_tipo      text := coalesce(p_payload->>'tipo_pedido', 'uniforme');
  v_login     text;
  v_nome      text;
  v_origem    text;
  v_empresa   uuid;
  v_cnome     text;
  v_pnome     text;
  v_fnome     text;
  v_itens     jsonb := coalesce(p_payload->'itens', '[]'::jsonb);
  v_ped       public.sup_pedido;
  it          jsonb;
  v_idx       int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.sup_ext_pode_ver_contrato(v_contrato) THEN
    RAISE EXCEPTION 'Sem acesso a este contrato';
  END IF;
  IF jsonb_array_length(v_itens) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um item';
  END IF;

  -- A cascata precisa ser coerente: posto do contrato, função do posto.
  SELECT c.empresa_id, c.nome, p.nome, f.nome
    INTO v_empresa, v_cnome, v_pnome, v_fnome
    FROM public.contratos c
    JOIN public.sup_posto  p ON p.id = v_posto  AND p.contrato_id = c.id
    JOIN public.sup_funcao f ON f.id = v_funcao AND f.posto_id    = p.id
   WHERE c.id = v_contrato
     AND p.aprovado AND p.ativo AND f.aprovado AND f.ativo;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Posto ou função não pertence a este contrato (ou não está aprovado)';
  END IF;

  -- Identidade: externo usa o login digitado; interno usa o próprio nome.
  SELECT s.login_informado INTO v_login
    FROM public.sup_ext_sessao s WHERE s.user_id = v_uid;
  IF v_login IS NOT NULL THEN
    v_origem := 'externo';
    v_nome   := coalesce(nullif(trim(p_payload->>'solicitante_nome'), ''), v_login);
  ELSE
    v_origem := 'interno';
    SELECT pr.display_name INTO v_nome FROM public.profiles pr WHERE pr.id = v_uid;
    v_login  := upper(coalesce(v_nome, 'INTERNO'));
  END IF;

  -- Colaborador é obrigatório, exceto em pedido só de insumos (§8.2).
  IF v_tipo <> 'insumos' THEN
    IF coalesce(trim(p_payload->>'nome_colaborador'), '') = ''
       OR coalesce(trim(p_payload->>'matricula_colaborador'), '') = '' THEN
      RAISE EXCEPTION 'Informe o nome e a matrícula do colaborador';
    END IF;
  END IF;

  INSERT INTO public.sup_pedido (
    empresa_id, contrato_id, posto_id, funcao_id,
    contrato_nome, posto_nome, funcao_nome,
    criado_por, solicitante_login, solicitante_nome, origem,
    nome_colaborador, matricula_colaborador,
    admissao, tipo_admissao, data_admissao, imagem_cracha_path,
    tipo_pedido, observacoes_solicitante
  ) VALUES (
    v_empresa, v_contrato, v_posto, v_funcao,
    v_cnome, v_pnome, v_fnome,
    v_uid, v_login, v_nome, v_origem,
    coalesce(trim(p_payload->>'nome_colaborador'), ''),
    coalesce(trim(p_payload->>'matricula_colaborador'), ''),
    coalesce((p_payload->>'admissao')::boolean, false),
    nullif(p_payload->>'tipo_admissao', ''),
    nullif(p_payload->>'data_admissao', '')::date,
    nullif(p_payload->>'imagem_cracha_path', ''),
    v_tipo,
    nullif(p_payload->>'observacoes_solicitante', '')
  ) RETURNING * INTO v_ped;

  FOR it IN SELECT * FROM jsonb_array_elements(v_itens) LOOP
    v_idx := v_idx + 1;
    -- Só aceita item que realmente está no enxoval daquela função.
    IF NOT EXISTS (
      SELECT 1 FROM public.sup_funcao_item fi
       WHERE fi.funcao_id = v_funcao
         AND fi.item_id   = (it->>'item_id')::uuid
         AND fi.aprovado AND fi.ativo
    ) THEN
      RAISE EXCEPTION 'Item % não pertence a esta função', coalesce(it->>'nome_item', it->>'item_id');
    END IF;

    INSERT INTO public.sup_pedido_item
      (pedido_id, item_id, nome_item, tipo_item, tamanho, quantidade, litros, ordem)
    SELECT v_ped.id, i.id, i.nome, i.tipo,
           nullif(it->>'tamanho', ''),
           greatest(coalesce((it->>'quantidade')::int, 1), 1),
           nullif(it->>'litros', ''),
           v_idx
      FROM public.sup_item i
     WHERE i.id = (it->>'item_id')::uuid;
  END LOOP;

  INSERT INTO public.sup_pedido_historico
    (pedido_id, acao, status_novo, observacao, alterado_por, alterado_por_nome)
  VALUES (v_ped.id, 'CRIADO', v_ped.status, 'Pedido criado', v_uid, v_nome);

  RETURN v_ped;
END $$;

-- ── 5. Meus pedidos (acompanhamento do solicitante) ──────────────────
--
-- É o que dá "ele vê os pedidos que já criou" mesmo em outro aparelho:
-- casa por (contrato, identificação) além do auth.uid() da sessão atual.
CREATE OR REPLACE FUNCTION public.sup_ext_meus_pedidos()
RETURNS TABLE (
  id uuid, pedido_id text, status text, data_solicitacao date,
  contrato_nome text, posto_nome text, funcao_nome text,
  nome_colaborador text, matricula_colaborador text,
  tipo_pedido text, observacoes_solicitante text, observacao text,
  data_despachado timestamptz, created_at timestamptz,
  itens jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.pedido_id, p.status, p.data_solicitacao,
         p.contrato_nome, p.posto_nome, p.funcao_nome,
         p.nome_colaborador, p.matricula_colaborador,
         p.tipo_pedido, p.observacoes_solicitante, p.observacao,
         p.data_despachado, p.created_at,
         coalesce((
           SELECT jsonb_agg(jsonb_build_object(
                    'nome', pi.nome_item, 'tipo', pi.tipo_item,
                    'tamanho', pi.tamanho, 'quantidade', pi.quantidade,
                    'litros', pi.litros) ORDER BY pi.ordem)
             FROM public.sup_pedido_item pi WHERE pi.pedido_id = p.id
         ), '[]'::jsonb)
    FROM public.sup_pedido p
   WHERE auth.uid() IS NOT NULL
     AND (
       p.criado_por = auth.uid()
       OR EXISTS (
         SELECT 1 FROM public.sup_ext_sessao s
          WHERE s.user_id         = auth.uid()
            AND s.contrato_id     = p.contrato_id
            AND s.login_informado = p.solicitante_login
       )
     )
   ORDER BY p.created_at DESC;
$$;

-- ── 6. Grants ────────────────────────────────────────────────────────
--
-- anon só enxerga a lista de contratos (necessária antes de existir sessão).
-- Todo o resto exige um JWT — inclusive o anônimo, que no Supabase recebe
-- o papel `authenticated` com a claim is_anonymous = true.

REVOKE EXECUTE ON FUNCTION public.sup_ext_pode_ver_contrato(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sup_ext_entrar(text, uuid)      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sup_ext_postos(uuid)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sup_ext_funcoes(uuid)           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sup_ext_itens(uuid)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sup_ext_criar_pedido(jsonb)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sup_ext_meus_pedidos()          FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sup_ext_pode_ver_contrato(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_ext_entrar(text, uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_ext_postos(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_ext_funcoes(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_ext_itens(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_ext_criar_pedido(jsonb)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_ext_meus_pedidos()          TO authenticated;

GRANT EXECUTE ON FUNCTION public.sup_ext_contratos()             TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
