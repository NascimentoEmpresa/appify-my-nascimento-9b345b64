-- =====================================================================
-- SIS-2026-0208 — Uniformes e EPIs desde a admissão até a devolução
--
-- A vaga continua guardando contrato/cargo em texto como histórico, mas
-- passa a apontar também para a cascata real do catálogo de Suprimentos.
-- Toda escrita de negócio abaixo passa por RPC SECURITY DEFINER; as tabelas
-- novas têm somente policies de leitura e nunca são recortadas por empresa.
-- =====================================================================

-- 1. Ponte entre Recrutamento e o catálogo
ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS contrato_id uuid REFERENCES public.contratos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posto_id    uuid REFERENCES public.sup_posto(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS funcao_id   uuid REFERENCES public.sup_funcao(id) ON DELETE SET NULL;

-- A fila do Compras lê a view, portanto os IDs precisam ser expostos nela.
-- A lista parte da última definição (20260906000014) e só acrescenta colunas
-- ao final, condição exigida pelo CREATE OR REPLACE VIEW do PostgreSQL.
CREATE OR REPLACE VIEW public."VW_RECRUTAMENTO_CANDIDATOS" AS
  SELECT
    c.id AS candidato_id, c.vaga_id, c.nome, c.telefone, c.email,
    COALESCE(c.cpf, c.cpf_cand) AS cpf, c.origem, c.storage_path, c.mensagem,
    c.etapa_processo, c.etapa_changed_at, c.selecionado_por, c.selecionado_em,
    c.juridico_ok, c.juridico_obs, c.juridico_por, c.juridico_em,
    c.sst_ok, c.sst_obs, c.sst_por, c.sst_em,
    c.sst_data_exame, c.sst_hora_exame, c.sst_local_exame, c.sst_agendado_por, c.sst_agendado_em,
    c.compras_necessidades, c.compras_por, c.compras_em, c.compras_obs, c.compras_data_chegada,
    c.epis_informados, c.epis_informados_em,
    c.enviado_admissao_por, c.enviado_admissao_em,
    c.admitido_por, c.admitido_em, c.empregado_id, c.motivo_reprovacao,
    c.experiencia_1, c.experiencia_2, c.experiencia_3, c.favorito, c.tipo_candidatura,
    c.created_at AS candidatura_em,
    s.cargo, s.contrato, s.cidade, s.status AS vaga_status,
    s.motivo_vaga, s.nome_substituido, s.escala, s.horario, s.salario,
    s.beneficios, s.insalubridade_recebe, s.insalubridade_quanto, s.local_exato,
    s.data_inicio_prevista, s.quantidade_vagas, s.req_obrigatorios, s.req_desejaveis,
    s.exp_minima, s.exp_minima_qual, s.grau_urgencia, s.solicitante_nome,
    (b.cpf_digits IS NOT NULL) AS possui_restricao, b.motivo AS restricao_motivo,
    c.compras_ok,
    c.desistiu, c.desistencia_motivo, c.desistencia_etapa, c.desistencia_em, c.desistencia_por,
    s.contrato_id, s.posto_id, s.funcao_id
  FROM public."WA_CURRICULOS" c
  JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = c.vaga_id
  LEFT JOIN public."RECRUTAMENTO_CPF_BLACKLIST" b
    ON b.cpf_digits = regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''), '\D', '', 'g')
  WHERE c.etapa_processo IS NOT NULL;

ALTER VIEW public."VW_RECRUTAMENTO_CANDIDATOS" SET (security_invoker = true);
GRANT SELECT ON public."VW_RECRUTAMENTO_CANDIDATOS" TO authenticated;

-- 2. Pré-cadastro do enxoval
CREATE TABLE IF NOT EXISTS public.sup_admissao_enxoval (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id     bigint NOT NULL REFERENCES public."WA_CURRICULOS"(id) ON DELETE CASCADE,
  vaga_id          bigint,
  contrato_id      uuid REFERENCES public.contratos(id) ON DELETE SET NULL,
  posto_id         uuid REFERENCES public.sup_posto(id) ON DELETE SET NULL,
  funcao_id        uuid REFERENCES public.sup_funcao(id) ON DELETE SET NULL,
  token            text UNIQUE,
  expira_em        timestamptz,
  preenchido_em    timestamptz,
  foto_cracha_path text,
  pedido_id        uuid REFERENCES public.sup_pedido(id) ON DELETE SET NULL,
  observacoes      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sup_admissao_enxoval_cand
  ON public.sup_admissao_enxoval(candidato_id);

CREATE TABLE IF NOT EXISTS public.sup_admissao_enxoval_item (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enxoval_id  uuid NOT NULL REFERENCES public.sup_admissao_enxoval(id) ON DELETE CASCADE,
  sup_item_id uuid NOT NULL REFERENCES public.sup_item(id) ON DELETE CASCADE,
  nome_item   text NOT NULL,
  tipo_item   text,
  tamanho     text,
  quantidade  integer NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  ordem       integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sup_adm_item_enxoval
  ON public.sup_admissao_enxoval_item(enxoval_id, ordem);

-- 3. Histórico imutável de tamanho
CREATE TABLE IF NOT EXISTS public.sup_admissao_tamanho_hist (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enxoval_item_id   uuid NOT NULL REFERENCES public.sup_admissao_enxoval_item(id) ON DELETE CASCADE,
  tamanho_anterior  text,
  tamanho_novo      text,
  motivo            text NOT NULL,
  alterado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  alterado_por_nome text,
  alterado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sup_adm_tamanho_hist_item
  ON public.sup_admissao_tamanho_hist(enxoval_item_id, alterado_em DESC);

CREATE OR REPLACE FUNCTION public.sup_adm_registrar_tamanho_hist()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_motivo text := NULLIF(btrim(current_setting('app.sup_admissao_motivo', true)), '');
BEGIN
  IF NEW.tamanho IS DISTINCT FROM OLD.tamanho THEN
    INSERT INTO public.sup_admissao_tamanho_hist (
      enxoval_item_id, tamanho_anterior, tamanho_novo, motivo,
      alterado_por, alterado_por_nome
    ) VALUES (
      NEW.id, OLD.tamanho, NEW.tamanho, COALESCE(v_motivo, 'Não informado'),
      auth.uid(), COALESCE(public.sup_malote_nome_ator(), 'Candidato (link público)')
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sup_adm_tamanho_hist ON public.sup_admissao_enxoval_item;
CREATE TRIGGER trg_sup_adm_tamanho_hist
  AFTER UPDATE OF tamanho ON public.sup_admissao_enxoval_item
  FOR EACH ROW EXECUTE FUNCTION public.sup_adm_registrar_tamanho_hist();

-- 4. RPCs
DROP FUNCTION IF EXISTS public.sup_adm_gerar_enxoval(bigint, uuid, uuid, uuid, integer);
CREATE FUNCTION public.sup_adm_gerar_enxoval(
  p_candidato_id bigint,
  p_contrato_id  uuid,
  p_posto_id     uuid,
  p_funcao_id    uuid,
  p_dias         integer DEFAULT 15
)
RETURNS public.sup_admissao_enxoval
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_enxoval_id uuid;
  v_vaga_id    bigint;
  v_resultado  public.sup_admissao_enxoval;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT (
    public.can_access(v_uid, 'sup_epis_admissao', 'alterar') OR
    public.can_access(v_uid, 'recrutamento_gestao', 'alterar')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para gerar o enxoval da admissão';
  END IF;

  -- Evita que um duplo clique gere dois links e invalide silenciosamente o
  -- primeiro que já foi copiado para o candidato.
  PERFORM pg_advisory_xact_lock(p_candidato_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.sup_funcao f
     WHERE f.id = p_funcao_id AND f.posto_id = p_posto_id
  ) THEN
    RAISE EXCEPTION 'Função não pertence ao posto informado';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sup_posto p
     WHERE p.id = p_posto_id AND p.contrato_id = p_contrato_id
  ) THEN
    RAISE EXCEPTION 'Posto não pertence ao contrato informado';
  END IF;

  SELECT c.vaga_id INTO v_vaga_id
    FROM public."WA_CURRICULOS" c WHERE c.id = p_candidato_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidato não encontrado'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.sup_admissao_enxoval e
     WHERE e.candidato_id = p_candidato_id AND e.pedido_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Este candidato já tem pedido de materiais';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sup_admissao_enxoval e
     WHERE e.candidato_id = p_candidato_id AND e.preenchido_em IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'O candidato já informou os tamanhos';
  END IF;

  -- Depois da primeira escolha o trigger já criou auditoria. Regerar apagaria
  -- os itens por cascata e, junto deles, um histórico que deve ser permanente.
  IF EXISTS (
    SELECT 1
      FROM public.sup_admissao_enxoval e
      JOIN public.sup_admissao_enxoval_item ai ON ai.enxoval_id = e.id
      JOIN public.sup_admissao_tamanho_hist h ON h.enxoval_item_id = ai.id
     WHERE e.candidato_id = p_candidato_id
  ) THEN
    RAISE EXCEPTION 'O enxoval já possui histórico de tamanhos e não pode ser recriado';
  END IF;

  INSERT INTO public.sup_admissao_enxoval (
    candidato_id, vaga_id, contrato_id, posto_id, funcao_id,
    token, expira_em, preenchido_em, foto_cracha_path, created_by
  ) VALUES (
    p_candidato_id, v_vaga_id, p_contrato_id, p_posto_id, p_funcao_id,
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    now() + make_interval(days => GREATEST(COALESCE(p_dias, 15), 1)),
    NULL, NULL, v_uid
  )
  ON CONFLICT (candidato_id) DO UPDATE SET
    vaga_id = EXCLUDED.vaga_id,
    contrato_id = EXCLUDED.contrato_id,
    posto_id = EXCLUDED.posto_id,
    funcao_id = EXCLUDED.funcao_id,
    token = EXCLUDED.token,
    expira_em = EXCLUDED.expira_em,
    preenchido_em = NULL,
    foto_cracha_path = NULL,
    created_by = v_uid
  RETURNING id INTO v_enxoval_id;

  DELETE FROM public.sup_admissao_enxoval_item WHERE enxoval_id = v_enxoval_id;
  INSERT INTO public.sup_admissao_enxoval_item (
    enxoval_id, sup_item_id, nome_item, tipo_item, quantidade, ordem
  )
  SELECT v_enxoval_id, i.id, i.nome, i.tipo, 1, fi.ordem
    FROM public.sup_funcao_item fi
    JOIN public.sup_item i ON i.id = fi.item_id
   WHERE fi.funcao_id = p_funcao_id
     AND fi.ativo AND fi.aprovado
     AND i.ativo AND i.aprovado
   ORDER BY fi.ordem, fi.created_at;

  -- Vagas antigas passam a herdar a escolha nas próximas admissões. Valores
  -- já cadastrados nunca são sobrescritos por esta correção retroativa.
  UPDATE public."SISTEMA_RECRUTAMENTO" s SET
    contrato_id = COALESCE(s.contrato_id, p_contrato_id),
    posto_id = COALESCE(s.posto_id, p_posto_id),
    funcao_id = COALESCE(s.funcao_id, p_funcao_id)
  WHERE s.id = v_vaga_id;

  SELECT * INTO v_resultado
    FROM public.sup_admissao_enxoval e WHERE e.id = v_enxoval_id;
  RETURN v_resultado;
END $$;

DROP FUNCTION IF EXISTS public.sup_adm_enxoval_publico(text);
CREATE FUNCTION public.sup_adm_enxoval_publico(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_enxoval public.sup_admissao_enxoval;
  v_itens   jsonb;
  v_contrato_nome text;
  v_funcao_nome   text;
BEGIN
  SELECT * INTO v_enxoval
    FROM public.sup_admissao_enxoval e WHERE e.token = p_token;

  IF v_enxoval.id IS NULL THEN
    RETURN jsonb_build_object('valido', false, 'motivo', 'inexistente');
  END IF;
  IF v_enxoval.preenchido_em IS NOT NULL THEN
    RETURN jsonb_build_object('valido', false, 'motivo', 'ja_usado');
  END IF;
  -- O dia de expiração é inclusivo: um link que expira hoje ainda vale.
  IF v_enxoval.expira_em < (
    date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
      AT TIME ZONE 'America/Sao_Paulo'
  ) THEN
    RETURN jsonb_build_object('valido', false, 'motivo', 'expirado');
  END IF;

  SELECT c.nome INTO v_contrato_nome
    FROM public.contratos c WHERE c.id = v_enxoval.contrato_id;
  SELECT f.nome INTO v_funcao_nome
    FROM public.sup_funcao f WHERE f.id = v_enxoval.funcao_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ai.id,
      'nome_item', ai.nome_item,
      'tipo_item', ai.tipo_item,
      'tamanhos_disponiveis', COALESCE((
        SELECT to_jsonb(io.opcoes)
          FROM public.sup_item_opcao io
         WHERE io.item_id = ai.sup_item_id AND io.tipo = 'tamanho'
         LIMIT 1
      ), '[]'::jsonb)
    ) ORDER BY ai.ordem, ai.id
  ), '[]'::jsonb)
  INTO v_itens
  FROM public.sup_admissao_enxoval_item ai
  WHERE ai.enxoval_id = v_enxoval.id;

  RETURN jsonb_build_object(
    'valido', true,
    'motivo', NULL,
    'contrato_nome', v_contrato_nome,
    'funcao_nome', v_funcao_nome,
    'itens', v_itens
  );
END $$;

DROP FUNCTION IF EXISTS public.sup_adm_enxoval_responder(text, jsonb, text);
CREATE FUNCTION public.sup_adm_enxoval_responder(
  p_token text,
  p_itens jsonb,
  p_foto_path text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_enxoval public.sup_admissao_enxoval;
BEGIN
  SELECT * INTO v_enxoval
    FROM public.sup_admissao_enxoval e
   WHERE e.token = p_token
   FOR UPDATE;

  IF v_enxoval.id IS NULL THEN RAISE EXCEPTION 'Link inválido'; END IF;
  IF v_enxoval.preenchido_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este link já foi utilizado';
  END IF;
  IF v_enxoval.expira_em < (
    date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
      AT TIME ZONE 'America/Sao_Paulo'
  ) THEN
    RAISE EXCEPTION 'Este link expirou';
  END IF;
  IF jsonb_typeof(COALESCE(p_itens, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Itens inválidos';
  END IF;
  IF NULLIF(btrim(p_foto_path), '') IS NULL THEN
    RAISE EXCEPTION 'Envie a foto para o crachá';
  END IF;

  UPDATE public.sup_admissao_enxoval_item ai
     SET tamanho = NULLIF(btrim(escolha->>'tamanho'), '')
    FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) escolha
   WHERE ai.enxoval_id = v_enxoval.id
     AND ai.id::text = escolha->>'id';

  IF EXISTS (
    SELECT 1
      FROM public.sup_admissao_enxoval_item ai
     WHERE ai.enxoval_id = v_enxoval.id
       AND NULLIF(btrim(ai.tamanho), '') IS NULL
       AND EXISTS (
         SELECT 1 FROM public.sup_item_opcao io
          WHERE io.item_id = ai.sup_item_id
            AND io.tipo = 'tamanho'
            AND cardinality(io.opcoes) > 0
       )
  ) THEN
    RAISE EXCEPTION 'Informe o tamanho de todos os itens';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.sup_admissao_enxoval_item ai
      JOIN public.sup_item_opcao io
        ON io.item_id = ai.sup_item_id AND io.tipo = 'tamanho'
     WHERE ai.enxoval_id = v_enxoval.id
       AND cardinality(io.opcoes) > 0
       AND NOT (ai.tamanho = ANY(io.opcoes))
  ) THEN
    RAISE EXCEPTION 'Foi informado um tamanho que não existe no catálogo';
  END IF;

  UPDATE public.sup_admissao_enxoval
     SET preenchido_em = now(), foto_cracha_path = NULLIF(btrim(p_foto_path), '')
   WHERE id = v_enxoval.id;

  RETURN jsonb_build_object('ok', true);
END $$;

-- A RPC reaproveitada para criar pedidos tinha um recorte antigo por empresa.
-- A última definição era 20260819000003. Esta versão preserva
-- a sessão externa e passa a seguir a regra atual do módulo: autorização por
-- tela, sem filtro de empresa, incluindo a fila de EPIs da admissão.
DROP FUNCTION IF EXISTS public.sup_ext_pode_ver_contrato(uuid);
CREATE FUNCTION public.sup_ext_pode_ver_contrato(p_contrato_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_contrato_id IS NULL THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM public.sup_ext_sessao s
     WHERE s.user_id = v_uid AND s.contrato_id = p_contrato_id
  ) THEN
    RETURN true;
  END IF;
  RETURN public.can_access(v_uid, 'encarregados_solicitar_materiais', 'visualizar')
      OR public.can_access(v_uid, 'sup_epis_admissao', 'alterar');
END $$;

DROP FUNCTION IF EXISTS public.sup_adm_criar_pedido(uuid);
CREATE FUNCTION public.sup_adm_criar_pedido(p_enxoval_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_enxoval   public.sup_admissao_enxoval;
  v_candidato record;
  v_itens     jsonb;
  v_payload   jsonb;
  v_pedido_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_epis_admissao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para gerar o pedido de materiais';
  END IF;

  SELECT * INTO v_enxoval
    FROM public.sup_admissao_enxoval e
   WHERE e.id = p_enxoval_id
   FOR UPDATE;
  IF v_enxoval.id IS NULL THEN RAISE EXCEPTION 'Enxoval não encontrado'; END IF;
  IF v_enxoval.pedido_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este candidato já tem pedido de materiais';
  END IF;
  IF v_enxoval.preenchido_em IS NULL THEN
    RAISE EXCEPTION 'O candidato ainda não informou os tamanhos';
  END IF;

  SELECT c.nome, c.empregado_id INTO v_candidato
    FROM public."WA_CURRICULOS" c WHERE c.id = v_enxoval.candidato_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'item_id', ai.sup_item_id,
      'tamanho', ai.tamanho,
      'quantidade', ai.quantidade
    ) ORDER BY ai.ordem, ai.id
  ), '[]'::jsonb)
  INTO v_itens
  FROM public.sup_admissao_enxoval_item ai
  WHERE ai.enxoval_id = v_enxoval.id;

  v_payload := jsonb_build_object(
    'contrato_id', v_enxoval.contrato_id,
    'posto_id', v_enxoval.posto_id,
    'funcao_id', v_enxoval.funcao_id,
    'tipo_pedido', 'ambos',
    'admissao', true,
    'nome_colaborador', v_candidato.nome,
    'colaborador_empregado_id', v_candidato.empregado_id,
    'imagem_cracha_path', v_enxoval.foto_cracha_path,
    'observacoes_solicitante', v_enxoval.observacoes,
    'itens', v_itens
  );

  -- A criação e os itens permanecem centralizados na RPC oficial do pedido.
  SELECT (public.sup_ext_criar_pedido(v_payload)).id INTO v_pedido_id;

  UPDATE public.sup_admissao_enxoval
     SET pedido_id = v_pedido_id
   WHERE id = v_enxoval.id;

  RETURN v_pedido_id;
END $$;

DROP FUNCTION IF EXISTS public.sup_adm_historico_colaborador(text);
CREATE FUNCTION public.sup_adm_historico_colaborador(p_matricula text)
RETURNS TABLE (
  material text,
  tamanho text,
  quantidade integer,
  codigo text,
  entregue_em timestamptz,
  devolvido boolean,
  contrato text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT (
    public.can_access(v_uid, 'sup_colaborador_historico', 'visualizar') OR
    public.can_access(v_uid, 'sup_estoque', 'visualizar')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para consultar o histórico do colaborador';
  END IF;

  RETURN QUERY
  WITH tags_atuais AS (
    -- A etiqueta única permanece ligada diretamente ao pedido enquanto está
    -- com o colaborador. Para massa, o ledger contém a quantidade consumida.
    SELECT pi.nome_item AS material,
           COALESCE(t.tamanho, pi.tamanho) AS tamanho,
           CASE WHEN t.tipo = 'massa' THEN COALESCE(cs.quantidade, 1) ELSE 1 END::integer AS quantidade,
           t.codigo,
           COALESCE(t.usado_em, cs.consumido_em, t.created_at) AS entregue_em,
           p.id AS pedido_id,
           pi.id AS pedido_item_id,
           p.contrato_nome AS contrato
      FROM public.sup_estoque_tag t
      JOIN public.sup_pedido p ON p.id = t.pedido_id
      JOIN public.sup_pedido_item pi ON pi.id = t.pedido_item_id
      LEFT JOIN public.sup_estoque_consumo cs
        ON cs.codigo = t.codigo AND cs.pedido_item_id = t.pedido_item_id
     WHERE t.usado
       AND btrim(COALESCE(p.matricula_colaborador, '')) = btrim(COALESCE(p_matricula, ''))
       AND btrim(COALESCE(p_matricula, '')) <> ''
  ),
  movimentos_historicos AS (
    -- Na devolução a tag perde pedido_id; o livro-razão preserva esse vínculo.
    SELECT pi.nome_item AS material,
           COALESCE(m.tamanho, pi.tamanho) AS tamanho,
           m.quantidade,
           m.codigo,
           m.created_at AS entregue_em,
           p.id AS pedido_id,
           pi.id AS pedido_item_id,
           p.contrato_nome AS contrato
      FROM public.sup_estoque_movimento m
      JOIN public.sup_pedido p ON p.id = m.pedido_id
      JOIN public.sup_pedido_item pi ON pi.id = m.pedido_item_id
     WHERE m.tipo = 'saida'
       AND btrim(COALESCE(p.matricula_colaborador, '')) = btrim(COALESCE(p_matricula, ''))
       AND btrim(COALESCE(p_matricula, '')) <> ''
       AND NOT EXISTS (
         SELECT 1 FROM tags_atuais ta
          WHERE ta.pedido_id = m.pedido_id
            AND ta.pedido_item_id = m.pedido_item_id
            AND ta.codigo IS NOT DISTINCT FROM m.codigo
       )
  ),
  entregas AS (
    SELECT * FROM tags_atuais
    UNION ALL
    SELECT * FROM movimentos_historicos
  )
  SELECT e.material, e.tamanho, e.quantidade, e.codigo, e.entregue_em,
         EXISTS (
           SELECT 1
             FROM public.sup_estoque_movimento d
            WHERE d.tipo = 'devolucao'
              AND d.pedido_id = e.pedido_id
              AND d.pedido_item_id = e.pedido_item_id
              AND d.codigo IS NOT DISTINCT FROM e.codigo
              AND d.created_at >= e.entregue_em
         ) AS devolvido,
         e.contrato
    FROM entregas e
   ORDER BY e.entregue_em DESC;
END $$;

-- 5. RLS: leitura por capacidade; escrita exclusivamente pelas RPCs/trigger.
ALTER TABLE public.sup_admissao_enxoval ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_admissao_enxoval_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_admissao_tamanho_hist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sup_admissao_enxoval_select ON public.sup_admissao_enxoval;
CREATE POLICY sup_admissao_enxoval_select ON public.sup_admissao_enxoval
  FOR SELECT TO authenticated USING (
    public.can_access(auth.uid(), 'sup_epis_admissao', 'visualizar') OR
    public.can_access(auth.uid(), 'recrutamento_gestao', 'visualizar') OR
    public.can_access(auth.uid(), 'sup_pedidos_materiais', 'visualizar')
  );

DROP POLICY IF EXISTS sup_admissao_enxoval_item_select ON public.sup_admissao_enxoval_item;
CREATE POLICY sup_admissao_enxoval_item_select ON public.sup_admissao_enxoval_item
  FOR SELECT TO authenticated USING (
    public.can_access(auth.uid(), 'sup_epis_admissao', 'visualizar') OR
    public.can_access(auth.uid(), 'recrutamento_gestao', 'visualizar') OR
    public.can_access(auth.uid(), 'sup_pedidos_materiais', 'visualizar')
  );

DROP POLICY IF EXISTS sup_admissao_tamanho_hist_select ON public.sup_admissao_tamanho_hist;
CREATE POLICY sup_admissao_tamanho_hist_select ON public.sup_admissao_tamanho_hist
  FOR SELECT TO authenticated USING (
    public.can_access(auth.uid(), 'sup_epis_admissao', 'visualizar') OR
    public.can_access(auth.uid(), 'recrutamento_gestao', 'visualizar') OR
    public.can_access(auth.uid(), 'sup_pedidos_materiais', 'visualizar')
  );

GRANT SELECT ON public.sup_admissao_enxoval,
                public.sup_admissao_enxoval_item,
                public.sup_admissao_tamanho_hist TO authenticated;

-- O formulário público envia somente para a pasta própria da admissão. A
-- leitura do bucket continua privada e não é aberta ao candidato.
DROP POLICY IF EXISTS sup_crachas_admissao_anon_insert ON storage.objects;
CREATE POLICY sup_crachas_admissao_anon_insert ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'sup-crachas'
    AND (storage.foldername(name))[1] = 'admissoes'
    AND COALESCE(
      (public.sup_adm_enxoval_publico((storage.foldername(name))[2])->>'valido')::boolean,
      false
    )
  );

-- 6. Menu, já configurado apenas no perfil concede_tudo (deny-by-default).
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sup_colaborador_historico', 'Histórico do Colaborador',
       '/app/suprimentos/colaborador', 65, true
  FROM public.app_modulo m
 WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO UPDATE
   SET nome = EXCLUDED.nome, rota = EXCLUDED.rota,
       ordem = EXCLUDED.ordem, ativo = true;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'sup_colaborador_historico', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
   ('visualizar'::public.app_acao), ('incluir'::public.app_acao),
   ('alterar'::public.app_acao), ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- Privilégios das funções: nada nasce executável por PUBLIC.
REVOKE ALL ON FUNCTION public.sup_adm_registrar_tamanho_hist() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_adm_gerar_enxoval(bigint, uuid, uuid, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_adm_enxoval_publico(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_adm_enxoval_responder(text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_ext_pode_ver_contrato(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_adm_criar_pedido(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_adm_historico_colaborador(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sup_adm_gerar_enxoval(bigint, uuid, uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_adm_enxoval_publico(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sup_adm_enxoval_responder(text, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sup_ext_pode_ver_contrato(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_adm_criar_pedido(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_adm_historico_colaborador(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sup_colaborador_historico';
--   DELETE FROM public.app_menu WHERE codigo = 'sup_colaborador_historico';
--   DROP POLICY IF EXISTS sup_crachas_admissao_anon_insert ON storage.objects;
--   DROP FUNCTION IF EXISTS public.sup_adm_historico_colaborador(text);
--   DROP FUNCTION IF EXISTS public.sup_adm_criar_pedido(uuid);
--   DROP FUNCTION IF EXISTS public.sup_adm_enxoval_responder(text, jsonb, text);
--   DROP FUNCTION IF EXISTS public.sup_adm_enxoval_publico(text);
--   DROP FUNCTION IF EXISTS public.sup_adm_gerar_enxoval(bigint, uuid, uuid, uuid, integer);
--   DROP TRIGGER IF EXISTS trg_sup_adm_tamanho_hist ON public.sup_admissao_enxoval_item;
--   DROP FUNCTION IF EXISTS public.sup_adm_registrar_tamanho_hist();
--   DROP TABLE IF EXISTS public.sup_admissao_tamanho_hist;
--   DROP TABLE IF EXISTS public.sup_admissao_enxoval_item;
--   DROP TABLE IF EXISTS public.sup_admissao_enxoval;
--   ALTER TABLE public."SISTEMA_RECRUTAMENTO"
--     DROP COLUMN IF EXISTS funcao_id, DROP COLUMN IF EXISTS posto_id,
--     DROP COLUMN IF EXISTS contrato_id;
--   -- Recriar VW_RECRUTAMENTO_CANDIDATOS sem os três IDs finais.
--   -- Recriar sup_ext_pode_ver_contrato pela definição anterior, se necessário.
-- =====================================================================
